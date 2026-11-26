const fs = require('node:fs/promises');
const path = require('node:path');

const MAX_DESCRIPTION = 2000;
const MAX_LOG_LINES = 30;
const ISSUE_BASE = 'https://github.com/jean47/LogicielCamtonLive-/issues/new';

// Une adresse d'ingestion contient la clé de diffusion dans son dernier segment :
// elle ne doit jamais sortir de la machine, même dans un rapport que l'utilisateur
// relit avant de l'envoyer.
function redactIngestUrls(text) {
  return String(text || '').replace(/rtmps?:\/\/[^\s'"]+/gi, (url) => {
    const cut = url.lastIndexOf('/');
    return cut > 'rtmps://'.length ? `${url.slice(0, cut)}/<clé masquée>` : url;
  });
}

function buildReport(input = {}) {
  const description = redactIngestUrls(String(input.description || '').slice(0, MAX_DESCRIPTION)).trim();
  const logs = Array.isArray(input.stderr) ? input.stderr.slice(-MAX_LOG_LINES).map((line) => redactIngestUrls(line)) : [];
  const lines = [
    'Rapport Camton Live',
    `Date : ${input.createdAt || new Date().toISOString()}`,
    `Version : ${input.version || 'inconnue'}`,
    `Système : ${input.platform || 'inconnu'} ${input.arch || ''}`.trim(),
    `Encodeur : ${input.encoder || 'inconnu'}`,
    `Sorties actives : ${input.activeOutputs || 'aucune'}`,
    '',
    'Ce que tu décris :',
    description || '(vide)',
    '',
    'Dernières lignes de l’encodeur (clés masquées) :',
    ...(logs.length ? logs : ['(aucune)']),
    '',
  ];
  return lines.join('\n');
}

function issueUrl({ version, description }) {
  const body = [
    'Signale ici ce qui ne va pas. Le rapport généré par l’application contient la version, le système et les dernières lignes de l’encodeur : joins-le à ce message.',
    '',
    `Version : ${version || 'inconnue'}`,
    '',
    'Ce que j’ai fait :',
    redactIngestUrls(String(description || '').slice(0, 600)).trim() || '(à compléter)',
  ].join('\n');
  const params = new URLSearchParams({
    title: `[${version || 'Camton Live'}] `,
    body,
    labels: 'bug',
  });
  return `${ISSUE_BASE}?${params.toString()}`;
}

function createBugReporter({ app, openExternal, now = () => new Date().toISOString() }) {
  async function save(input = {}) {
    const createdAt = now();
    const report = buildReport({ ...input, createdAt });
    const stamp = createdAt.replace(/[:.]/g, '-');
    const target = path.join(app.getPath('desktop'), `Camton-Live-rapport-${stamp}.txt`);
    await fs.writeFile(target, report, 'utf8');
    return { path: target, report };
  }

  async function openIssue(input = {}) {
    await openExternal(issueUrl(input));
    return true;
  }

  return Object.freeze({ save, openIssue });
}

module.exports = { MAX_DESCRIPTION, redactIngestUrls, buildReport, issueUrl, createBugReporter };
