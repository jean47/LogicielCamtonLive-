import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// makensis est fourni par NSIS : natif sous Windows, binaire Linux/macOS dans le
// cache d'electron-builder. Aucun Wine n'est nécessaire, contrairement à la
// cible `nsis` d'electron-builder qui modifie l'icône du setup via rcedit.
function findMakensis() {
  const envBin = process.env.MAKENSIS;
  if (envBin && existsSync(envBin)) return envBin;

  const cacheRoot = path.join(os.homedir(), '.cache', 'electron-builder');
  if (existsSync(cacheRoot)) {
    for (const folder of readdirSync(cacheRoot).filter((name) => name.startsWith('nsis-3'))) {
      const nsisRoot = path.join(cacheRoot, folder);
      for (const inner of readdirSync(nsisRoot)) {
        const candidate = path.join(nsisRoot, inner, process.platform === 'win32' ? 'makensis.exe' : 'linux', process.platform === 'win32' ? '' : 'makensis');
        if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
      }
    }
  }

  const windowsDefault = 'C:\\Program Files (x86)\\NSIS\\makensis.exe';
  if (process.platform === 'win32' && existsSync(windowsDefault)) return windowsDefault;
  return null;
}

let makensis = findMakensis();
if (!makensis && process.platform !== 'win32') {
  // La cible `nsis` d'electron-builder échoue sans Wine, mais elle télécharge
  // d'abord la boîte à outils NSIS : on s'en sert uniquement pour cela.
  console.log('Boîte à outils NSIS absente, téléchargement via electron-builder…');
  try {
    execFileSync('npx', ['electron-builder', '--win', 'nsis', '--x64'], { cwd: ROOT, stdio: 'ignore' });
  } catch {
    // Échec attendu à l'étape Wine : les gabarits sont déjà extraits.
  }
  makensis = findMakensis();
}
if (!makensis) {
  console.error('makensis introuvable. Installe NSIS, ou définis MAKENSIS=/chemin/vers/makensis.');
  process.exit(1);
}

const { version } = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const unpacked = path.join(ROOT, 'release', 'win-unpacked');
if (!existsSync(path.join(unpacked, 'Camton Live.exe'))) {
  console.error('release/win-unpacked introuvable : lance d’abord `npm run build && npx electron-builder --win zip --x64`.');
  process.exit(1);
}

const output = path.join(ROOT, 'release', `Camton-Live-Setup-${version}-x64.exe`);
// Le binaire Linux cherche ses gabarits à côté de lui : NSISDIR doit désigner la
// racine de la distribution (Stubs/, Include/, Plugins/, Contrib/).
const env = process.platform === 'win32' ? process.env : { ...process.env, NSISDIR: path.dirname(path.dirname(makensis)) };

console.log(`Compilation de l’installateur ${version} avec ${makensis}…`);
execFileSync(makensis, ['-V2', `-DVERSION=${version}`, `-DOUT=${output}`, 'installer/setup.nsi'], { cwd: ROOT, stdio: 'inherit', env });

const megaBytes = (statSync(output).size / 1024 / 1024).toFixed(1);
console.log(`Installateur prêt : ${path.relative(ROOT, output)} (${megaBytes} Mo)`);
