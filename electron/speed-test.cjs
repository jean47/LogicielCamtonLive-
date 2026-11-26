// Aucun serveur Camton Live n'existe : la mesure passe par le point d'envoi public
// de Cloudflare, qui accepte un corps POST et ne conserve rien. Seuls des octets
// neutres partent, jamais une clé ni un nom de fichier.
const SPEED_ENDPOINT = 'https://speed.cloudflare.com/__up';
const DEFAULT_BYTES = 4 * 1024 * 1024;
const TIMEOUT_MS = 20000;

function computeMbps(bytes, elapsedMs) {
  if (!Number.isFinite(bytes) || !Number.isFinite(elapsedMs) || bytes <= 0 || elapsedMs <= 0) return 0;
  const mbps = (bytes * 8) / (elapsedMs / 1000) / 1e6;
  return Math.round(mbps * 10) / 10;
}

async function measureUpload({ fetchImpl = fetch, bytes = DEFAULT_BYTES, now = Date.now } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const payload = Buffer.alloc(bytes, 0x20);
  const started = now();
  try {
    const response = await fetchImpl(SPEED_ENDPOINT, {
      method: 'POST',
      body: payload,
      signal: controller.signal,
      headers: { 'content-type': 'application/octet-stream' },
    });
    if (!response?.ok) throw new Error('Le service de mesure a refusé la requête.');
    const elapsed = Math.max(now() - started, 1);
    return { mbps: computeMbps(bytes, elapsed), megabytes: Math.round((bytes / 1048576) * 10) / 10, seconds: Math.round(elapsed / 100) / 10 };
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('La mesure a dépassé vingt secondes. Réessaie sur une connexion plus stable.');
    throw new Error('Mesure impossible : le service de test est injoignable. Vérifie ta connexion, ou estime ton débit avec ton fournisseur.');
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { SPEED_ENDPOINT, DEFAULT_BYTES, computeMbps, measureUpload };
