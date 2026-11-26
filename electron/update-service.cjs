const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const https = require('node:https');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { URL } = require('node:url');

// Le manifeste est un asset de la dernière release GitHub, déposé par
// .github/workflows/release.yml : aucun hébergement tiers à maintenir.
const UPDATE_MANIFEST_URLS = Object.freeze([
  'https://github.com/jean47/LogicielCamtonLive-/releases/latest/download/latest.json',
]);
const UPDATE_MANIFEST_URL = UPDATE_MANIFEST_URLS[0];
const MANIFEST_MAX_BYTES = 256 * 1024;
const INSTALLER_MAX_BYTES = 1024 * 1024 * 1024;
const REDIRECT_LIMIT = 4;
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/;

function parseVersion(value) {
  if (typeof value !== 'string') return null;
  const match = VERSION_PATTERN.exec(value);
  if (!match) return null;
  const prerelease = match[4] ? match[4].split('.') : [];
  if (prerelease.some((part) => !part || (/^\d+$/.test(part) && part.length > 1 && part.startsWith('0')))) return null;
  return { core: match.slice(1, 4).map(Number), prerelease };
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) throw new Error('Une version de Camton Live est invalide.');
  for (let i = 0; i < 3; i += 1) {
    if (a.core[i] !== b.core[i]) return a.core[i] > b.core[i] ? 1 : -1;
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    if (a.prerelease.length === b.prerelease.length) return 0;
    return a.prerelease.length === 0 ? 1 : -1;
  }
  const count = Math.max(a.prerelease.length, b.prerelease.length);
  for (let i = 0; i < count; i += 1) {
    if (a.prerelease[i] === undefined) return -1;
    if (b.prerelease[i] === undefined) return 1;
    if (a.prerelease[i] === b.prerelease[i]) continue;
    const an = /^\d+$/.test(a.prerelease[i]);
    const bn = /^\d+$/.test(b.prerelease[i]);
    if (an && bn) return Number(a.prerelease[i]) > Number(b.prerelease[i]) ? 1 : -1;
    if (an !== bn) return an ? -1 : 1;
    return a.prerelease[i] > b.prerelease[i] ? 1 : -1;
  }
  return 0;
}

function parseManifest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Le manifeste de mise à jour n’est pas valide.');
  }
  if (!parseVersion(input.version)) throw new Error('La version publiée dans le manifeste est invalide.');
  const releaseNotes = typeof input.releaseNotes === 'string' ? input.releaseNotes.slice(0, 4000) : '';
  const update = { version: input.version, releaseNotes };
  if (typeof input.downloadUrl === 'string' && input.downloadUrl.length <= 2048) {
    let parsedUrl;
    try { parsedUrl = new URL(input.downloadUrl); } catch { throw new Error('Le lien de mise à jour est invalide.'); }
    if (parsedUrl.protocol !== 'https:' || parsedUrl.username || parsedUrl.password) {
      throw new Error('Le lien de mise à jour doit être une adresse HTTPS sécurisée.');
    }
    update.downloadUrl = parsedUrl.toString();
  }
  if (input.sha256 !== undefined) {
    if (typeof input.sha256 !== 'string' || !/^[a-fA-F0-9]{64}$/.test(input.sha256)) {
      throw new Error('L’empreinte SHA-256 du manifeste est invalide.');
    }
    update.sha256 = input.sha256.toLowerCase();
  }
  return update;
}

function validateHttpsUrl(value, label) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${label} invalide.`); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error(`${label} doit utiliser HTTPS.`);
  return url;
}

function openHttpsResponse(rawUrl, { accept, timeoutMs }, redirects = 0) {
  const url = validateHttpsUrl(rawUrl, 'Adresse du serveur de mise à jour');
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: { Accept: accept, 'Cache-Control': 'no-cache', 'User-Agent': 'Camton-Live-Updater' },
    }, (response) => {
      const status = response.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(status)) {
        const location = response.headers.location;
        response.resume();
        if (!location || redirects >= REDIRECT_LIMIT) {
          reject(new Error('Le serveur de mise à jour a renvoyé une redirection invalide.'));
          return;
        }
        let redirected;
        try { redirected = new URL(location, url).toString(); } catch {
          reject(new Error('Le serveur de mise à jour a renvoyé un lien invalide.'));
          return;
        }
        try { validateHttpsUrl(redirected, 'Adresse redirigée'); } catch (error) { reject(error); return; }
        openHttpsResponse(redirected, { accept, timeoutMs }, redirects + 1).then(resolve, reject);
        return;
      }
      if (status !== 200) {
        response.resume();
        reject(new Error(`Le serveur de mise à jour a répondu ${status}.`));
        return;
      }
      resolve(response);
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error('Délai de connexion au serveur de mise à jour dépassé.')));
    request.on('error', reject);
  });
}

async function readFirstManifest(urls) {
  let lastError = null;
  for (const url of urls) {
    try {
      return await readManifest(url);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Aucun serveur de mise à jour n’a répondu.');
}

async function readManifest(url) {
  const response = await openHttpsResponse(url, { accept: 'application/json', timeoutMs: 12000 });
  const chunks = [];
  let size = 0;
  for await (const chunk of response) {
    size += chunk.length;
    if (size > MANIFEST_MAX_BYTES) {
      response.destroy();
      throw new Error('Le manifeste de mise à jour est trop volumineux.');
    }
    chunks.push(chunk);
  }
  let json;
  try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {
    throw new Error('Le manifeste de mise à jour ne contient pas de JSON valide.');
  }
  return parseManifest(json);
}

async function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

function createUpdateService({ app, emit, getIsStreaming, manifestUrl = UPDATE_MANIFEST_URL, manifestUrls = UPDATE_MANIFEST_URLS }) {
  let state = { status: 'idle', currentVersion: app.getVersion(), latestVersion: null, releaseNotes: '', progress: 0 };
  let latestManifest = null;
  let checkPromise = null;
  let downloadPromise = null;

  function snapshot() { return { ...state }; }
  function setState(status, fields = {}) {
    state = { ...state, ...fields, status };
    emit(snapshot());
    return snapshot();
  }
  function installerPath(version) {
    const safeVersion = version.replace(/[^0-9A-Za-z.-]/g, '_');
    return path.join(app.getPath('userData'), 'updates', `camton-live-setup-${safeVersion}.exe`);
  }

  async function check() {
    if (checkPromise) return checkPromise;
    if (!app.isPackaged) return setState('disabled');
    checkPromise = (async () => {
      try {
        const manifest = await readFirstManifest(manifestUrl ? [manifestUrl] : manifestUrls);
        latestManifest = manifest;
        const currentVersion = app.getVersion();
        if (compareVersions(manifest.version, currentVersion) <= 0) {
          return setState('up-to-date', { currentVersion, latestVersion: manifest.version, releaseNotes: manifest.releaseNotes, progress: 0 });
        }
        if (!manifest.downloadUrl || !manifest.sha256) throw new Error('La nouvelle version est annoncée sans lien ou empreinte de téléchargement.');
        const destination = installerPath(manifest.version);
        try {
          if ((await hashFile(destination)) === manifest.sha256) {
            return setState('downloaded', { currentVersion, latestVersion: manifest.version, releaseNotes: manifest.releaseNotes, progress: 100 });
          }
          await fsp.rm(destination, { force: true });
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
        return setState('available', { currentVersion, latestVersion: manifest.version, releaseNotes: manifest.releaseNotes, progress: 0 });
      } catch (error) {
        console.warn(`[Camton Live] Vérification des mises à jour ignorée : ${error.message}`);
        return setState('unavailable', { currentVersion: app.getVersion(), latestVersion: null, releaseNotes: '', progress: 0 });
      } finally {
        checkPromise = null;
      }
    })();
    return checkPromise;
  }

  async function download() {
    if (downloadPromise) return downloadPromise;
    if (!latestManifest || compareVersions(latestManifest.version, app.getVersion()) <= 0) {
      const result = await check();
      if (result.status === 'unavailable' || result.status === 'up-to-date' || result.status === 'disabled') return result;
    }
    if (!latestManifest?.downloadUrl || !latestManifest?.sha256) {
      return setState('error', { errorMessage: 'Le fichier de mise à jour n’est pas configuré.', latestVersion: latestManifest?.version || null });
    }
    downloadPromise = (async () => {
      const manifest = latestManifest;
      const folder = path.join(app.getPath('userData'), 'updates');
      const destination = installerPath(manifest.version);
      const partial = `${destination}.partial`;
      await fsp.mkdir(folder, { recursive: true });
      setState('downloading', { latestVersion: manifest.version, releaseNotes: manifest.releaseNotes, progress: 0, errorMessage: '' });
      try {
        const response = await openHttpsResponse(manifest.downloadUrl, { accept: 'application/octet-stream', timeoutMs: 45000 });
        const lengthHeader = Number(response.headers['content-length']);
        if (Number.isFinite(lengthHeader) && lengthHeader > INSTALLER_MAX_BYTES) {
          response.destroy();
          throw new Error('Le fichier de mise à jour dépasse la taille autorisée.');
        }
        const hash = crypto.createHash('sha256');
        let received = 0;
        let lastProgressAt = 0;
        const meter = new Transform({
          transform(chunk, _encoding, callback) {
            received += chunk.length;
            if (received > INSTALLER_MAX_BYTES) return callback(new Error('Le fichier de mise à jour dépasse la taille autorisée.'));
            hash.update(chunk);
            const now = Date.now();
            if (now - lastProgressAt > 180) {
              lastProgressAt = now;
              setState('downloading', { progress: Number.isFinite(lengthHeader) && lengthHeader > 0 ? Math.min(99, Math.floor(received / lengthHeader * 100)) : null });
            }
            callback(null, chunk);
          },
        });
        await pipeline(response, meter, fs.createWriteStream(partial, { flags: 'w', mode: 0o600 }));
        if (hash.digest('hex') !== manifest.sha256) throw new Error('La vérification d’intégrité du fichier a échoué; aucun fichier n’a été installé.');
        await fsp.rename(partial, destination);
        return setState('downloaded', { latestVersion: manifest.version, releaseNotes: manifest.releaseNotes, progress: 100, errorMessage: '' });
      } catch (error) {
        await fsp.rm(partial, { force: true }).catch(() => {});
        return setState('error', { latestVersion: manifest.version, releaseNotes: manifest.releaseNotes, progress: 0, errorMessage: error.message || 'Le téléchargement de la mise à jour a échoué.' });
      } finally {
        downloadPromise = null;
      }
    })();
    return downloadPromise;
  }

  async function install() {
    if (process.platform !== 'win32' || !app.isPackaged) throw new Error('L’installation de mise à jour est disponible uniquement dans la version Windows installée.');
    if (getIsStreaming()) throw new Error('Arrête le direct avant d’installer la mise à jour.');
    if (state.status !== 'downloaded' || !latestManifest) throw new Error('Télécharge d’abord la mise à jour.');
    const filePath = installerPath(latestManifest.version);
    if ((await hashFile(filePath)) !== latestManifest.sha256) {
      await fsp.rm(filePath, { force: true });
      latestManifest = null;
      setState('error', { errorMessage: 'Le fichier enregistré ne correspond plus à l’empreinte officielle. Relance le téléchargement.' });
      return snapshot();
    }
    return new Promise((resolve, reject) => {
      const child = spawn(filePath, ['/S'], { detached: true, stdio: 'ignore', windowsHide: true });
      child.once('error', (error) => reject(new Error(`Impossible de lancer l’installation : ${error.message}`)));
      child.once('spawn', () => {
        child.unref();
        setState('installing', { progress: 100 });
        setTimeout(() => app.quit(), 500);
        resolve(snapshot());
      });
    });
  }

  return Object.freeze({ check, download, install, getState: snapshot });
}

module.exports = { UPDATE_MANIFEST_URL, UPDATE_MANIFEST_URLS, compareVersions, createUpdateService, parseManifest, parseVersion };
