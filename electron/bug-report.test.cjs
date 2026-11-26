const test = require('node:test');
const assert = require('node:assert/strict');
const { redactIngestUrls, buildReport, issueUrl } = require('./bug-report.cjs');

test('stream keys never leave the machine, even inside a pasted URL', () => {
  const youtube = 'rtmps://a.rtmps.youtube.com:443/live2/abcd-1234-efgh';
  assert.equal(redactIngestUrls(`échec sur ${youtube}`), 'échec sur rtmps://a.rtmps.youtube.com:443/live2/<clé masquée>');
  const twitch = 'rtmp://live.twitch.tv/app/live_123456_secret';
  assert.equal(redactIngestUrls(twitch), 'rtmp://live.twitch.tv/app/<clé masquée>');
  assert.equal(redactIngestUrls('aucune adresse ici'), 'aucune adresse ici');
});

test('the report carries version, system and encoder without any key', () => {
  const report = buildReport({
    version: '0.5.2',
    platform: 'win32',
    arch: 'x64',
    encoder: 'nvenc (NVENC)',
    activeOutputs: 'twitch',
    description: 'la sortie s’arrête au bout de deux minutes',
    stderr: ['Output #0, flv, to \'rtmps://live.twitch.tv/app/live_abcdef\':'],
    createdAt: '2026-11-26T20:00:00.000Z',
  });
  assert.match(report, /Version : 0\.5\.2/);
  assert.match(report, /Système : win32 x64/);
  assert.match(report, /nvenc/);
  assert.match(report, /deux minutes/);
  assert.match(report, /<clé masquée>/);
  assert.equal(report.includes('live_abcdef'), false);
});

test('a very long description is truncated instead of bloating the file', () => {
  const report = buildReport({ description: 'a'.repeat(5000) });
  assert.equal(report.includes('a'.repeat(2001)), false);
});

test('the prefilled issue stays a URL and points at the repository', () => {
  const url = issueUrl({ version: '0.5.2', description: 'plantage au démarrage' });
  assert.match(url, /^https:\/\/github\.com\/jean47\/LogicielCamtonLive-\/issues\/new\?/);
  const body = new URL(url).searchParams.get('body');
  assert.match(body, /Version : 0\.5\.2/);
  assert.equal(body.includes('live_'), false);
});
