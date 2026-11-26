import assert from 'node:assert/strict';
import test from 'node:test';

import { describeMeasurement } from './speed-verdict.js';

test('a comfortable upload is reported as passing with margin', () => {
  const { level, text } = describeMeasurement({ mbps: 9.2, profileKbps: 4500, label: 'Équilibré' });
  assert.equal(level, 'ok');
  assert.match(text, /9,2 Mb\/s/);
  assert.match(text, /marge/);
});

test('a measurement just above the bitrate is called tight, not comfortable', () => {
  const { level, text } = describeMeasurement({ mbps: 5, profileKbps: 4500, label: 'Équilibré' });
  assert.equal(level, 'tight');
  assert.match(text, /juste/);
});

test('an insufficient upload names the profile and suggests a lighter one', () => {
  const { level, text } = describeMeasurement({ mbps: 3.1, profileKbps: 6000, label: 'Très net' });
  assert.equal(level, 'short');
  assert.match(text, /Très net/);
  assert.match(text, /plus léger/);
});

test('an unusable measurement never claims a verdict', () => {
  assert.equal(describeMeasurement({ mbps: 0, profileKbps: 4500, label: 'Équilibré' }).level, 'error');
  assert.equal(describeMeasurement({ mbps: Number.NaN, profileKbps: 4500, label: 'Équilibré' }).level, 'error');
});
