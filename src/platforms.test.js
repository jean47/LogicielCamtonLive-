import test from 'node:test';
import assert from 'node:assert/strict';

import { CAPTURE_LIMITS, LIVE_PROFILES, captureConstraints } from './platforms.js';

test('la capture suit la cadence du profil', () => {
  assert.equal(captureConstraints(60).video.frameRate.ideal, 60);
  assert.equal(captureConstraints(60).video.frameRate.max, 60);
  assert.equal(captureConstraints(30).video.frameRate.max, 30);
});

test('la capture ne dépasse jamais le 1080p', () => {
  const { video } = captureConstraints(60);
  assert.equal(video.width.max, CAPTURE_LIMITS.width);
  assert.equal(video.height.max, CAPTURE_LIMITS.height);
  assert.ok(CAPTURE_LIMITS.width <= 1920 && CAPTURE_LIMITS.height <= 1080);
});

test('une cadence absente retombe sur 60 sans casser les contraintes', () => {
  assert.equal(captureConstraints(0).video.frameRate.ideal, 60);
  assert.equal(captureConstraints(undefined).video.frameRate.ideal, 60);
  assert.equal(captureConstraints(60).audio, true);
});

test('le profil le plus net demande bien du 60 i/s', () => {
  assert.equal(LIVE_PROFILES.sharp.fps, 60);
  assert.equal(captureConstraints(LIVE_PROFILES.sharp.fps).video.frameRate.ideal, 60);
});
