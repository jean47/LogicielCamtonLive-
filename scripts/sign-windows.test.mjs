import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { certificateArgs, signingConfigured } from './sign-windows.mjs';

function withEnv(values, run) {
  const saved = { ...process.env };
  for (const key of ['WINDOWS_CERT_PFX_PATH', 'WINDOWS_CERT_PFX_BASE64', 'WINDOWS_CERT_PASSWORD', 'WINDOWS_CERT_SHA1', 'WINDOWS_CERT_STORE']) {
    delete process.env[key];
  }
  Object.assign(process.env, values);
  try {
    return run();
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in saved)) delete process.env[key];
    }
    Object.assign(process.env, saved);
  }
}

test('sans certificat, rien n’est configuré et aucun argument n’est produit', () => {
  withEnv({}, () => {
    assert.equal(signingConfigured(), false);
    assert.equal(certificateArgs(), null);
  });
});

test('un certificat sur token est désigné par son empreinte', () => {
  withEnv({ WINDOWS_CERT_SHA1: 'aa:bb:cc' }, () => {
    assert.equal(signingConfigured(), true);
    assert.deepEqual(certificateArgs(), ['/sha1', 'aabbcc']);
  });
});

test('le magasin machine ajoute /sm, le magasin utilisateur non', () => {
  withEnv({ WINDOWS_CERT_SHA1: 'aabbcc', WINDOWS_CERT_STORE: 'machine' }, () => {
    assert.deepEqual(certificateArgs(), ['/sha1', 'aabbcc', '/sm']);
  });
  withEnv({ WINDOWS_CERT_SHA1: 'aabbcc' }, () => {
    assert.deepEqual(certificateArgs(), ['/sha1', 'aabbcc']);
  });
});

test('un .pfx l’emporte sur l’empreinte et porte son mot de passe', () => {
  const folder = mkdtempSync(path.join(os.tmpdir(), 'camton-test-'));
  const pfx = path.join(folder, 'cert.pfx');
  writeFileSync(pfx, 'faux certificat', 'utf8');
  withEnv({ WINDOWS_CERT_PFX_PATH: pfx, WINDOWS_CERT_PASSWORD: 'secret', WINDOWS_CERT_SHA1: 'aabbcc' }, () => {
    assert.deepEqual(certificateArgs(), ['/f', pfx, '/p', 'secret']);
  });
  rmSync(folder, { recursive: true, force: true });
});
