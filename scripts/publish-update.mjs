// Prépare une mise à jour publiable : manifeste à jour, empreinte vérifiée,
// dossier prêt à téléverser. N'envoie rien sans --execute.
//
//   PUBLISH_URL_BASE=https://exemple.com/updates npm run publish:update
//   PUBLISH_CMD="rclone copy {dir} remote:camton-live/updates" npm run publish:update -- --execute
//
// Variables :
//   PUBLISH_URL_BASE  dossier public où vivra le Setup.exe (obligatoire pour fixer downloadUrl)
//   PUBLISH_CMD       commande de téléversement, {dir} remplacé par le dossier absolu

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseNotes } from '../src/whats-new.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const execute = process.argv.includes('--execute');
const { version } = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const setup = path.join(ROOT, 'release', `Camton-Live-Setup-${version}-x64.exe`);
const portable = path.join(ROOT, 'release', `Camton-Live-Portable-${version}-x64.zip`);

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

if (!existsSync(setup)) fail(`installateur absent : ${path.relative(ROOT, setup)}. Lance \`npm run desktop:win\`.`);

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

const notesFile = path.join(ROOT, 'src', 'release-notes.json');
const notes = JSON.parse(readFileSync(notesFile, 'utf8'));
if (notes.version !== version) {
  fail(`src/release-notes.json porte la version ${notes.version} alors que package.json est en ${version}.`);
}
const bullets = parseNotes(notes.notes.map((note) => `- ${note}`).join('\n'));
if (!bullets.length) fail('src/release-notes.json ne contient aucune nouveauté exploitable.');

const sha256Setup = await sha256(setup);
const manifestPath = path.join(ROOT, 'updates', 'latest.json');
const previous = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
const urlBase = (process.env.PUBLISH_URL_BASE || '').replace(/\/+$/, '');
const fileName = path.basename(setup);
const downloadUrl = urlBase ? `${urlBase}/${fileName}` : previous.downloadUrl;

if (!downloadUrl) fail('Aucune adresse de téléchargement : définis PUBLISH_URL_BASE ou renseigne downloadUrl dans updates/latest.json.');

const manifest = {
  version,
  downloadUrl,
  sha256: sha256Setup,
  releaseNotes: bullets.map((bullet) => `- ${bullet}`).join('\n'),
};

const outDir = path.join(ROOT, 'dist-update');
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
copyFileSync(setup, path.join(outDir, fileName));
if (existsSync(portable)) copyFileSync(portable, path.join(outDir, path.basename(portable)));
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
copyFileSync(manifestPath, path.join(outDir, 'latest.json'));

const portableSha = existsSync(portable) ? await sha256(portable) : null;
writeFileSync(
  path.join(outDir, 'SHA256.txt'),
  [`${sha256Setup}  ${fileName}`, ...(portableSha ? [`${portableSha}  ${path.basename(portable)}`] : [])].join('\n') + '\n',
  'utf8',
);

console.log(`Version        : ${version}`);
console.log(`Installateur   : ${fileName} (${(statSync(setup).size / 1024 / 1024).toFixed(1)} Mo)`);
console.log(`SHA-256        : ${sha256Setup}`);
console.log(`downloadUrl    : ${downloadUrl}`);
console.log(`Nouveautés     : ${bullets.length} puces`);
console.log(`Dossier prêt   : ${path.relative(ROOT, outDir)}/ (installateur${portableSha ? ', ZIP portable' : ''}, latest.json, SHA256.txt)`);

const publishCmd = process.env.PUBLISH_CMD;
if (!publishCmd) {
  console.log('\nÀ téléverser sur l’hébergement du manifeste :');
  console.log(`  ${path.join(outDir, 'latest.json')}  →  ${downloadUrl.replace(/\/[^/]+$/, '/latest.json')}`);
  console.log(`  ${path.join(outDir, fileName)}  →  ${downloadUrl}`);
  console.log('\nOu relance avec PUBLISH_CMD="rclone copy {dir} remote:dossier" --execute pour automatiser l’envoi.');
  process.exit(0);
}

const command = publishCmd.replaceAll('{dir}', outDir);
if (!execute) {
  console.log(`\nCommande préparée (ajoute --execute pour l’exécuter) :\n  ${command}`);
  process.exit(0);
}

console.log(`\nTéléversement : ${command}`);
execFileSync(command, { shell: true, stdio: 'inherit', cwd: ROOT });
console.log('✓ Téléversement terminé. Vérifie que latest.json en ligne annonce bien la version ' + version + '.');
