/**
 * Découpe un texte de notes de version en puces affichables.
 * Accepte les listes séparées par des retours à la ligne et les puces déjà présentes.
 */
export function parseNotes(text, limit = 12) {
  if (typeof text !== 'string' || !text.trim()) return [];
  return text
    .split(/\r?\n+/)
    .map((line) => line.replace(/^\s*[-–—•*·]\s*/, '').trim())
    .filter((line) => line.length > 2)
    .slice(0, limit);
}

function numericParts(version) {
  return String(version || '')
    .trim()
    .replace(/^v/i, '')
    .split('-')[0]
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0);
}

/** Compare deux versions « majeure.mineure.correctif ». Renvoie -1, 0 ou 1. */
export function compareVersions(left, right) {
  const a = numericParts(left);
  const b = numericParts(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const diff = (a[index] || 0) - (b[index] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

/** Faut-il annoncer les nouveautés de la version installée ? */
export function shouldAnnounce({ currentVersion, lastSeenVersion } = {}) {
  if (!currentVersion) return false;
  if (!lastSeenVersion) return true;
  return compareVersions(currentVersion, lastSeenVersion) > 0;
}
