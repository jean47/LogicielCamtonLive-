function decimal(value) {
  return String(value).replace('.', ',');
}

export function describeMeasurement({ mbps, profileKbps, label }) {
  if (!Number.isFinite(mbps) || mbps <= 0) {
    return { level: 'error', text: 'Mesure inexploitable. Réessaie quand la connexion sera stable.' };
  }
  const required = profileKbps / 1000;
  const measured = `≈ ${decimal(mbps)} Mb/s montants`;
  if (mbps >= required * 1.5) {
    return { level: 'ok', text: `${measured} : « ${label} » (${decimal(required)} Mb/s) passe avec de la marge.` };
  }
  if (mbps >= required) {
    return { level: 'tight', text: `${measured} : c’est juste pour « ${label} » (${decimal(required)} Mb/s). Ferme les autres usages du réseau.` };
  }
  return { level: 'short', text: `${measured} : insuffisant pour « ${label} » (${decimal(required)} Mb/s). Choisis un préréglage plus léger.` };
}
