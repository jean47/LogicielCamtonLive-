import test from 'node:test';
import assert from 'node:assert/strict';

import { isNewerVersion, parseVersion } from './version.js';

test('une version se compare nombre par nombre', () => {
  assert.equal(isNewerVersion('0.5.5', '0.5.4'), true);
  assert.equal(isNewerVersion('0.5.10', '0.5.9'), true);
  assert.equal(isNewerVersion('0.6.0', '0.5.99'), true);
  assert.equal(isNewerVersion('0.5.4', '0.5.4'), false);
  assert.equal(isNewerVersion('0.5.3', '0.5.4'), false);
});

test('une version illisible ne déclenche rien', () => {
  assert.equal(parseVersion('bêta'), null);
  assert.equal(isNewerVersion('bêta', '0.5.4'), false);
  assert.equal(isNewerVersion('0.5.5', ''), false);
});
