import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Horodatage RFC 3161 : sans lui, la signature expire avec le certificat.
const TIMESTAMP_URL = 'http://timestamp.digicert.com';
const DESCRIPTION = 'Camton Live';

// Le certificat vit hors du dépôt. Deux formes acceptées : un chemin vers un .pfx
// (CI, fichier préparé en amont) ou le .pfx encodé en base64 (secret unique).
export function signingConfigured() {
  return Boolean(process.env.WINDOWS_CERT_PFX_PATH || process.env.WINDOWS_CERT_PFX_BASE64);
}

function resolvePfx() {
  const direct = process.env.WINDOWS_CERT_PFX_PATH;
  if (direct && existsSync(direct)) return direct;
  const base64 = process.env.WINDOWS_CERT_PFX_BASE64;
  if (!base64) return '';
  const folder = mkdtempSync(path.join(os.tmpdir(), 'camton-certificat-'));
  const target = path.join(folder, 'certificat.pfx');
  writeFileSync(target, Buffer.from(base64, 'base64'), { mode: 0o600 });
  return target;
}

function resolveSigntool() {
  const explicit = process.env.SIGNTOOL;
  if (explicit && existsSync(explicit)) return explicit;

  const roots = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles]
    .filter(Boolean)
    .map((root) => path.join(root, 'Windows Kits', '10', 'bin'));

  for (const root of roots) {
    if (!existsSync(root)) continue;
    const versions = readdirSync(root).sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));
    for (const version of versions) {
      for (const arch of ['x64', 'x86']) {
        const candidate = path.join(root, version, arch, 'signtool.exe');
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return '';
}

export function signFiles(files) {
  const targets = files.filter((file) => existsSync(file));
  if (!targets.length) return { signed: [], reason: 'aucun fichier' };
  if (!signingConfigured()) {
    console.log('Signature ignorée : aucun certificat configuré, la sortie reste non signée.');
    return { signed: [], reason: 'sans certificat' };
  }

  const signtool = resolveSigntool();
  if (!signtool) {
    throw new Error('signtool.exe introuvable : installe le SDK Windows ou définis SIGNTOOL.');
  }
  const certificate = resolvePfx();
  const password = process.env.WINDOWS_CERT_PASSWORD || '';

  for (const file of targets) {
    const args = ['sign', '/fd', 'sha256', '/f', certificate, '/tr', TIMESTAMP_URL, '/td', 'sha256', '/d', DESCRIPTION];
    if (password) args.push('/p', password);
    args.push(file);
    execFileSync(signtool, args, { stdio: 'inherit' });
    console.log(`Signé : ${path.relative(process.cwd(), file) || file}`);
  }
  return { signed: targets, reason: '' };
}

export function verifyFiles(files) {
  const targets = files.filter((file) => existsSync(file));
  if (!targets.length) throw new Error('Aucun fichier à vérifier.');
  if (!signingConfigured()) {
    console.log('Vérification ignorée : aucun certificat configuré.');
    return [];
  }
  const signtool = resolveSigntool();
  if (!signtool) throw new Error('signtool.exe introuvable : impossible de vérifier les signatures.');

  for (const file of targets) {
    execFileSync(signtool, ['verify', '/pa', '/q', file], { stdio: 'inherit' });
    console.log(`Signature valide : ${path.relative(process.cwd(), file) || file}`);
  }
  return targets;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const args = process.argv.slice(2);
  const verify = args.includes('--verify');
  const files = args.filter((arg) => arg !== '--verify');
  try {
    if (verify) verifyFiles(files);
    else signFiles(files);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
