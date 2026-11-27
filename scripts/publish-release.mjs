import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { signingConfigured, verifyFiles } from './sign-windows.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RELEASE = path.join(ROOT, 'release');

// Publier depuis le poste : la seule voie possible quand la clé de signature vit sur
// un token. Le tag est créé par la release elle-même, donc aucune poussée de tag :
// la CI ne reconstruit pas par-dessus des binaires déjà signés.
const { version } = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const notes = JSON.parse(readFileSync(path.join(ROOT, 'src', 'release-notes.json'), 'utf8'));
const tag = `v${version}`;

const setup = path.join(RELEASE, `Camton-Live-Setup-${version}-x64.exe`);
const portable = path.join(RELEASE, `Camton-Live-Portable-${version}-x64.zip`);
const manifest = path.join(ROOT, 'dist-update', 'latest.json');
const checksums = path.join(ROOT, 'dist-update', 'SHA256.txt');

for (const file of [setup, portable, manifest, checksums]) {
  if (!existsSync(file)) {
    console.error(`Fichier manquant : ${path.relative(ROOT, file)}. Lance \`npm run desktop:win\` d’abord.`);
    process.exit(1);
  }
}

if (signingConfigured()) {
  console.log('Vérification des signatures avant publication…');
  verifyFiles([setup, path.join(RELEASE, 'win-unpacked', 'Camton Live.exe')]);
} else {
  console.warn('Attention : aucun certificat configuré, publication de binaires non signés.');
}

if (JSON.parse(readFileSync(manifest, 'utf8')).version !== version) {
  console.error('Le manifeste ne correspond pas à la version du paquet : relance `npm run publish:update`.');
  process.exit(1);
}

const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
const status = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).trim();
if (status) {
  console.error('Le dépôt contient des modifications non validées : commite avant de publier.');
  process.exit(1);
}

const body = [
  'Bêta de Camton Live. Le direct est encodé sur ton PC puis envoyé aux destinations configurées.',
  '',
  ...(Array.isArray(notes.notes) ? notes.notes.map((item) => `- ${item}`) : []),
  '',
  `Empreintes SHA-256 : voir \`SHA256.txt\` joint.`,
].join('\n');

const folder = mkdtempSync(path.join(os.tmpdir(), 'camton-notes-'));
const notesFile = path.join(folder, 'notes.md');
writeFileSync(notesFile, body, 'utf8');

console.log(`Publication de ${tag} sur ${sha}…`);
execFileSync('gh', [
  'release', 'create', tag,
  '--target', sha,
  '--title', `Camton Live ${tag} — bêta`,
  '--notes-file', notesFile,
  setup, portable, manifest, checksums,
], { cwd: ROOT, stdio: 'inherit' });

console.log(`Release ${tag} publiée : https://github.com/${execFileSync('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], { cwd: ROOT, encoding: 'utf8' }).trim()}/releases/tag/${tag}`);
