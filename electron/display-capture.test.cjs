const test = require('node:test');
const assert = require('node:assert/strict');
const { createDisplayCaptureService } = require('./display-capture.cjs');

function createHarness({ trusted = true, sourceIds = ['screen:1'] } = {}) {
  let handler;
  const requests = [];
  const sources = sourceIds.map((id) => ({ id, name: id, thumbnail: { isEmpty: () => true } }));
  const service = createDisplayCaptureService({
    desktopCapturer: {
      async getSources(options) {
        requests.push(options);
        return sources;
      },
    },
    session: { setDisplayMediaRequestHandler(callback) { handler = callback; } },
    isTrustedRequest: () => trusted,
  });
  return { service, requests, run: (request) => new Promise((resolve) => handler(request, resolve)) };
}

test('selected source is revalidated and returned only to the trusted display-media request', async () => {
  const harness = createHarness();
  assert.equal(await harness.service.selectSource('screen:1'), true);
  const request = await harness.run({ videoRequested: true, audioRequested: true });
  assert.equal(request.video.id, 'screen:1');
  if (process.platform === 'win32') assert.equal(request.audio, 'loopback');
  assert.equal(harness.requests.length, 2);
});

test('a selected source is consumed once and cannot be reused for a second request', async () => {
  const harness = createHarness();
  await harness.service.selectSource('screen:1');
  assert.ok((await harness.run({ videoRequested: true })).video);
  assert.equal(await harness.run({ videoRequested: true }), null);
});

test('untrusted, audio-only, and unselected requests are denied', async () => {
  const harness = createHarness({ trusted: false });
  await harness.service.selectSource('screen:1');
  assert.equal(await harness.run({ videoRequested: true }), null);
  const trusted = createHarness();
  assert.equal(await trusted.run({ videoRequested: false, audioRequested: true }), null);
});

test('unknown or stale capture source identifiers are rejected', async () => {
  const harness = createHarness();
  await assert.rejects(harness.service.selectSource('window:missing'), /n’est plus disponible/);
  await assert.rejects(harness.service.selectSource(''), /invalide/);
});
