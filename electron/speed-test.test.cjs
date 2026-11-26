const test = require('node:test');
const assert = require('node:assert/strict');
const { computeMbps, measureUpload, SPEED_ENDPOINT } = require('./speed-test.cjs');

test('throughput is computed from real bytes and elapsed time', () => {
  assert.equal(computeMbps(4 * 1024 * 1024, 4000), 8.4);
  assert.equal(computeMbps(1_000_000, 1000), 8);
});

test('impossible measurements return zero instead of Infinity', () => {
  assert.equal(computeMbps(0, 1000), 0);
  assert.equal(computeMbps(1000, 0), 0);
  assert.equal(computeMbps(Number.NaN, 1000), 0);
});

test('a successful upload reports the measured throughput', async () => {
  let calls = 0;
  let body = null;
  const fetchImpl = async (url, options) => {
    calls += 1;
    assert.equal(url, SPEED_ENDPOINT);
    body = options.body;
    return { ok: true };
  };
  const clock = [0, 2000];
  const result = await measureUpload({ fetchImpl, bytes: 1_000_000, now: () => clock.shift() });
  assert.equal(calls, 1);
  assert.equal(body.length, 1_000_000);
  assert.equal(result.mbps, 4);
  assert.equal(result.seconds, 2);
});

test('a refused or unreachable endpoint produces a readable French error', async () => {
  await assert.rejects(
    measureUpload({ fetchImpl: async () => ({ ok: false }) }),
    /Mesure impossible/,
  );
  await assert.rejects(
    measureUpload({ fetchImpl: async () => { throw new Error('ENOTFOUND'); } }),
    /Mesure impossible/,
  );
});
