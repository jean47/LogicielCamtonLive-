import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { access, copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { inflateRawSync } from 'node:zlib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSET = 'ffmpeg-n9.0.2-58-g8c7ef49002-win64-lgpl-shared-9.0.zip';
const URL = `https://github.com/FFmpeg-Builds/FFmpeg-Builds/releases/download/autobuild-2026-11-19-12-39/${ASSET}`;
const SHA256 = '1fdb837def412ad7cc019874b6310156f40179bd30df58d041a82413f800a331';
const SOURCE_COMMIT = 'g8c7ef49002';
const DESTINATION = path.join(ROOT, 'vendor', 'ffmpeg', 'win-x64');
const ZIP = path.join(tmpdir(), ASSET);
const INFO = `Camton Live uses FFmpeg n9.0.2-58-g8c7ef49002, Windows x86_64 LGPL shared build.\nAsset: ${URL}\nSHA-256: ${SHA256}\nFFmpeg source: https://github.com/FFmpeg/FFmpeg/tree/${SOURCE_COMMIT}\nBuild recipes: https://github.com/FFmpeg-Builds/FFmpeg-Builds/tree/7f2a6b1050d302144de8366afa37a75e46f326aa\nEncoder selected by Camton Live: h264_mf (Windows Media Foundation), plus FFmpeg native AAC.\nThe separately distributed FFmpeg components are covered by their own license; see LICENSE.txt and ThirdPartyNotices.txt.\n`;

async function hashFile(file) {
  const hash = createHash('sha256');
  const bytes = await readFile(file);
  hash.update(bytes);
  return hash.digest('hex');
}

function findEndOfCentralDirectory(buffer) {
  const stop = Math.max(0, buffer.length - 66_000);
  for (let offset = buffer.length - 22; offset >= stop; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error('Archive ZIP invalide : fin du répertoire introuvable.');
}

// Extraction en Node pur : aucun `unzip`/`tar` système requis, sur Windows comme sur Linux.
async function extractZip(archive, destination) {
  const buffer = await readFile(archive);
  const end = findEndOfCentralDirectory(buffer);
  const entries = buffer.readUInt16LE(end + 10);
  const root = path.resolve(destination) + path.sep;
  let cursor = buffer.readUInt32LE(end + 16);

  for (let index = 0; index < entries; index += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Archive ZIP invalide : entrée inattendue.');
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    cursor += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith('/')) continue;

    const target = path.resolve(destination, name);
    if (!target.startsWith(root)) throw new Error(`Chemin ZIP inattendu : ${name}`);
    const dataStart = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    const data = buffer.subarray(dataStart, dataStart + compressedSize);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, method === 0 ? data : inflateRawSync(data));
  }
}

async function main() {
  try {
    await access(path.join(DESTINATION, 'bin', 'ffmpeg.exe'));
    const existingInfo = await readFile(path.join(DESTINATION, 'BUILD-INFO.txt'), 'utf8');
    if (existingInfo.includes(SHA256)) {
      console.log('FFmpeg Windows x64 est déjà présent et correspond au build épinglé.');
      return;
    }
  } catch {
    // Download and replace a missing or different build.
  }

  console.log(`Téléchargement de ${ASSET}…`);
  const response = await fetch(URL, { redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`Téléchargement FFmpeg impossible (HTTP ${response.status}).`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(ZIP));
  const actualHash = await hashFile(ZIP);
  if (actualHash !== SHA256) {
    await rm(ZIP, { force: true });
    throw new Error(`Checksum FFmpeg incorrect : ${actualHash}`);
  }

  const stage = await mkdtemp(path.join(tmpdir(), 'camton-live-ffmpeg-'));
  try {
    await extractZip(ZIP, stage);

    const roots = await readdir(stage, { withFileTypes: true });
    let bundle = null;
    for (const entry of roots) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(stage, entry.name);
      try {
        await access(path.join(candidate, 'bin', 'ffmpeg.exe'));
        bundle = candidate;
        break;
      } catch {
        // Continue until the top-level FFmpeg folder is found.
      }
    }
    if (!bundle) throw new Error('Le ZIP FFmpeg ne contient pas ffmpeg.exe au chemin attendu.');

    const sourceBin = path.join(bundle, 'bin');
    const targetBin = path.join(DESTINATION, 'bin');
    await rm(DESTINATION, { recursive: true, force: true });
    await mkdir(targetBin, { recursive: true });
    const binaries = await readdir(sourceBin, { withFileTypes: true });
    let copiedExe = false;
    let dllCount = 0;
    for (const entry of binaries) {
      if (!entry.isFile()) continue;
      const lower = entry.name.toLowerCase();
      if (lower === 'ffmpeg.exe' || lower.endsWith('.dll')) {
        await copyFile(path.join(sourceBin, entry.name), path.join(targetBin, entry.name));
        if (lower === 'ffmpeg.exe') copiedExe = true;
        if (lower.endsWith('.dll')) dllCount += 1;
      }
    }
    if (!copiedExe || dllCount < 5) throw new Error('L’archive FFmpeg est incomplète.');
    await copyFile(path.join(bundle, 'LICENSE.txt'), path.join(DESTINATION, 'LICENSE.txt'));
    await writeFile(path.join(DESTINATION, 'BUILD-INFO.txt'), INFO, 'utf8');

    const names = await readdir(targetBin);
    console.log(`FFmpeg vérifié et préparé : ${names.length} fichiers binaires, ${dllCount} DLL.`);
  } finally {
    await rm(stage, { recursive: true, force: true });
    await rm(ZIP, { force: true });
  }
}

main().catch((error) => {
  console.error(`Préparation FFmpeg impossible : ${error.message}`);
  process.exitCode = 1;
});
