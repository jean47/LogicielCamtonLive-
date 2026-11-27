const test = require('node:test');
const assert = require('node:assert/strict');
const { compareVersions, parseManifest, parseVersion } = require('./update-service.cjs');

test('compare stable semantic versions numerically', () => {
  assert.equal(compareVersions('0.10.0', '0.9.9'), 1);
  assert.equal(compareVersions('0.4.1', '0.4.0'), 1);
  assert.equal(compareVersions('0.4.3', '0.4.2'), 1);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
});

test('stable releases sort after prereleases and prerelease identifiers follow semver order', () => {
  assert.equal(compareVersions('1.0.0', '1.0.0-rc.1'), 1);
  assert.equal(compareVersions('1.0.0-beta.2', '1.0.0-beta.10'), -1);
  assert.equal(compareVersions('1.0.0-alpha', '1.0.0-beta'), -1);
});

test('reject invalid or noncanonical versions', () => {
  assert.equal(parseVersion('01.2.3'), null);
  assert.equal(parseVersion('1.2'), null);
  assert.throws(() => compareVersions('bad', '1.0.0'), /invalide/);
});

test('parse manifest release metadata and normalize SHA-256', () => {
  const manifest = parseManifest({
    version: '0.4.2',
    downloadUrl: 'https://updates.example.test/Camton.exe',
    sha256: 'A'.repeat(64),
    releaseNotes: 'Corrections et améliorations.',
  });
  assert.equal(manifest.version, '0.4.2');
  assert.equal(manifest.sha256, 'a'.repeat(64));
  assert.equal(manifest.downloadUrl, 'https://updates.example.test/Camton.exe');
  assert.equal(manifest.releaseNotes, 'Corrections et améliorations.');
});

test('reject unsafe URLs, malformed checksums and invalid version metadata', () => {
  assert.throws(() => parseManifest({ version: '0.4.2', downloadUrl: 'http://updates.example.test/a.exe' }), /HTTPS/);
  assert.throws(() => parseManifest({ version: '0.4.2', sha256: 'not-a-hash' }), /invalide/);
  assert.throws(() => parseManifest({ version: 'latest' }), /version.*invalide/i);
});

test('refuse d’installer hors Windows ou sans fichier téléchargé', async () => {
  const { createUpdateService } = require('./update-service.cjs');
  const service = createUpdateService({
    app: { getVersion: () => '0.5.0', isPackaged: true, getPath: (name) => (name === 'userData' ? require('node:os').tmpdir() : '/tmp') },
    emit: () => {},
    getIsStreaming: () => false,
  });
  if (process.platform !== 'win32') {
    await assert.rejects(() => service.install(), /Windows/);
  }
  await assert.rejects(() => service.install(), /Télécharge d’abord|Windows/);
});

test('révéler le fichier de mise à jour exige une mise à jour en attente', async () => {
  const { createUpdateService } = require('./update-service.cjs');
  const service = createUpdateService({
    app: { getVersion: () => '0.5.0', isPackaged: true, getPath: () => require('node:os').tmpdir() },
    emit: () => {},
    getIsStreaming: () => false,
    revealInFolder: () => {},
  });
  await assert.rejects(() => service.revealInstaller(), /Aucune mise à jour/);
});
