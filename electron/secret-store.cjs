const fs = require('node:fs/promises');
const path = require('node:path');

const SUPPORTED = new Set(['twitch', 'youtube', 'tiktok']);
const PLATFORM_LABELS = Object.freeze({ twitch: 'Twitch', youtube: 'YouTube', tiktok: 'TikTok' });
const MAX_SECRET_LENGTH = 512;

function assertSecret(value, label) {
  if (typeof value !== 'string' || value.length < 4 || value.length > MAX_SECRET_LENGTH) {
    throw new Error(`${label} doit contenir entre 4 et ${MAX_SECRET_LENGTH} caractères.`);
  }
  if (/[\u0000-\u0020\u007f]/.test(value)) {
    throw new Error(`${label} contient des caractères interdits.`);
  }
  return value;
}

// TikTok change d’hôte d’ingestion selon les régions : seule la forme RTMP(S)
// est vérifiée, pas le domaine. YouTube, lui, n’a qu’un hôte officiel.
function validateIngestEndpoint(value, platform, { hostPattern = null, hint }) {
  const label = PLATFORM_LABELS[platform];
  const invalid = new Error(`Adresse d’ingestion ${label} invalide.`);
  if (typeof value !== 'string' || value.length > 512 || /\s/.test(value)) throw invalid;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw invalid;
  }
  if (!['rtmp:', 'rtmps:'].includes(parsed.protocol)
      || (hostPattern && !hostPattern.test(parsed.hostname))
      || parsed.username || parsed.password || parsed.search || parsed.hash
      || parsed.pathname === '/' || parsed.pathname.length < 2) {
    throw new Error(hint);
  }
  return `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/+$/, '')}`;
}

function validateYoutubeEndpoint(value) {
  return validateIngestEndpoint(value, 'youtube', {
    hostPattern: /(^|\.)youtube\.com$/i,
    hint: 'Utilise l’adresse RTMP(S) fournie dans YouTube Studio.',
  });
}

function validateTiktokEndpoint(value) {
  return validateIngestEndpoint(value, 'tiktok', {
    hint: 'Utilise l’adresse RTMP(S) fournie par l’application TikTok.',
  });
}

function endpointValidator(platform) {
  return platform === 'tiktok' ? validateTiktokEndpoint : validateYoutubeEndpoint;
}

function createSecretStore({ app, safeStorage }) {
  const filePath = path.join(app.getPath('userData'), 'platform-secrets.enc');

  function encryptionAvailable() {
    return process.platform === 'win32' && safeStorage.isEncryptionAvailable();
  }

  async function readAll() {
    if (!encryptionAvailable()) throw new Error('Le stockage chiffré du système Windows est indisponible.');
    let encrypted;
    try {
      encrypted = await fs.readFile(filePath);
    } catch (error) {
      if (error.code === 'ENOENT') return {};
      throw new Error('Impossible de lire la configuration locale chiffrée.');
    }
    if (encrypted.length > 65536) throw new Error('Le fichier de configuration chiffré est invalide.');
    try {
      const parsed = JSON.parse(safeStorage.decryptString(encrypted));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      throw new Error('La configuration chiffrée ne peut pas être déverrouillée.');
    }
  }

  async function writeAll(data) {
    const directory = path.dirname(filePath);
    await fs.mkdir(directory, { recursive: true });
    const encrypted = safeStorage.encryptString(JSON.stringify(data));
    const tempPath = `${filePath}.${process.pid}.tmp`;
    await fs.writeFile(tempPath, encrypted, { mode: 0o600 });
    await fs.rename(tempPath, filePath);
  }

  async function getStatus() {
    if (!encryptionAvailable()) {
      return { available: false, twitch: false, youtube: false, tiktok: false };
    }
    try {
      const data = await readAll();
      return {
        available: true,
        twitch: typeof data.twitch?.key === 'string' && data.twitch.key.length > 3,
        youtube: typeof data.youtube?.key === 'string' && typeof data.youtube?.endpoint === 'string',
        tiktok: typeof data.tiktok?.key === 'string' && typeof data.tiktok?.endpoint === 'string',
      };
    } catch {
      return { available: true, twitch: false, youtube: false, tiktok: false, damaged: true };
    }
  }

  async function save(platform, input) {
    if (!SUPPORTED.has(platform)) throw new Error('Cette plateforme n’est pas prise en charge.');
    if (!encryptionAvailable()) throw new Error('Utilise l’application Windows pour enregistrer des clés chiffrées.');
    const data = await readAll();
    if (platform === 'twitch') {
      data.twitch = { key: assertSecret(input?.key, 'Clé Twitch') };
    } else {
      data[platform] = {
        endpoint: endpointValidator(platform)(input?.endpoint),
        key: assertSecret(input?.key, `Clé ${PLATFORM_LABELS[platform]}`),
      };
    }
    await writeAll(data);
    return getStatus();
  }

  async function clear(platform) {
    if (!SUPPORTED.has(platform)) throw new Error('Cette plateforme n’est pas prise en charge.');
    if (!encryptionAvailable()) throw new Error('Utilise l’application Windows pour gérer les clés chiffrées.');
    const data = await readAll();
    delete data[platform];
    if (Object.keys(data).length) await writeAll(data);
    else await fs.rm(filePath, { force: true });
    return getStatus();
  }

  async function reset() {
    if (!encryptionAvailable()) throw new Error('Utilise l’application Windows pour réinitialiser les clés chiffrées.');
    await fs.rm(filePath, { force: true });
    return getStatus();
  }

  async function getForStreaming(platforms) {
    if (!encryptionAvailable()) throw new Error('Le stockage chiffré Windows est indisponible.');
    const data = await readAll();
    const result = {};
    for (const platform of platforms) {
      if (!SUPPORTED.has(platform)) throw new Error('Cette plateforme n’est pas prise en charge.');
      const value = data[platform];
      if (platform === 'twitch' && value?.key) result.twitch = { key: value.key };
      else if (value?.key && value?.endpoint) result[platform] = { key: value.key, endpoint: value.endpoint };
      else throw new Error(`Configure d’abord ${PLATFORM_LABELS[platform] || platform}.`);
    }
    return result;
  }

  return Object.freeze({ getStatus, save, clear, reset, getForStreaming });
}

module.exports = { createSecretStore };
