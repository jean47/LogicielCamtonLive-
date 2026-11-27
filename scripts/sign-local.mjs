import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { signFiles, signingConfigured, verifyFiles } from './sign-windows.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RELEASE = path.join(ROOT, 'release');

// Signature sur le poste, pour un certificat posé sur token : la clé privée ne peut
// pas sortir du matériel, donc la CI ne peut pas signer à notre place.
function artifacts() {
  const files = [
    path.join(RELEASE, 'win-unpacked', 'Camton Live.exe'),
    path.join(RELEASE, 'win-unpacked', 'resources', 'ffmpeg', 'bin', 'ffmpeg.exe'),
  ];
  try {
    for (const name of readdirSync(RELEASE)) {
      if (/^Camton-Live-Setup-.*-x64\.exe$/.test(name)) files.push(path.join(RELEASE, name));
    }
  } catch {
    // release/ absent : signFiles dira qu'il n'y a rien à faire.
  }
  return files;
}

if (process.platform !== 'win32') {
  console.error('La signature Windows ne fonctionne que sous Windows.');
  process.exit(1);
}
if (!signingConfigured()) {
  console.error('Aucun certificat configuré. Définis WINDOWS_CERT_SHA1 (empreinte du certificat) ou WINDOWS_CERT_PFX_PATH.');
  process.exit(1);
}

const verify = process.argv.includes('--verify');
const files = artifacts();
if (verify) verifyFiles(files);
else {
  const result = signFiles(files);
  if (!result.signed.length) {
    console.error('Rien à signer : lance d’abord `npm run desktop:win`.');
    process.exit(1);
  }
}
