import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { access, copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

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

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} a échoué (${result.status ?? 'signal'}).`);
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
    if (process.platform === 'win32') run('tar', ['-xf', ZIP, '-C', stage]);
    else run('unzip', ['-q', ZIP, '-d', stage]);

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
