import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encryptBackup, decryptBackup, isEncrypted, canEncrypt } from '../assets/js/vault.js';
import { makeBackup, parseBackup, DEFAULT_SETTINGS } from '../assets/js/store.js';

const backup = makeBackup(
  [{ name: 'قرض السيارة', kind: 'car', balanceFils: 6500000, minFils: 180000, originalFils: 9000000, rate: 5.5, createdAt: '2026-01-01T00:00:00.000Z', payments: [], paidAt: '', demo: false }],
  { ...DEFAULT_SETTINGS },
);

test('encrypted backup round-trips with the right passphrase', async () => {
  assert.ok(canEncrypt());
  const file = await encryptBackup(backup, 'كلمة-سر-قوية-2026');
  assert.ok(!file.includes('قرض السيارة') && !file.includes('6500000'), 'plaintext leaked into the file');
  const parsed = JSON.parse(file);
  assert.ok(isEncrypted(parsed));
  assert.equal(parsed.kdf.iterations, 600000);
  const out = await decryptBackup(parsed, 'كلمة-سر-قوية-2026');
  assert.equal(out.ok, true);
  assert.equal(out.text, backup);
  const restored = parseBackup(out.text);
  assert.equal(restored.ok, true);
  assert.equal(restored.debts[0].name, 'قرض السيارة');
});

test('wrong passphrase and edited files are rejected, never decoded to garbage', async () => {
  const parsed = JSON.parse(await encryptBackup(backup, 'correct horse battery'));
  assert.deepEqual(await decryptBackup(parsed, 'wrong horse battery'), { ok: false, error: 'passphrase' });
  const bytes = Buffer.from(parsed.data, 'base64');
  bytes[bytes.length - 1] ^= 1;
  assert.deepEqual(await decryptBackup({ ...parsed, data: bytes.toString('base64') }, 'correct horse battery'), { ok: false, error: 'passphrase' });
});

test('malformed or hostile envelopes fail fast as "format"', async () => {
  const parsed = JSON.parse(await encryptBackup(backup, 'passphrase-123'));
  const bad = [
    null,
    { ...parsed, encrypted: false },
    { ...parsed, kdf: { ...parsed.kdf, iterations: 1e12 } },
    { ...parsed, kdf: { ...parsed.kdf, hash: 'SHA-1' } },
    { ...parsed, cipher: { ...parsed.cipher, iv: 'AAAA' } },
    { ...parsed, data: '%%%not-base64%%%' },
  ];
  for (const file of bad) assert.deepEqual(await decryptBackup(file, 'passphrase-123'), { ok: false, error: 'format' });
  assert.equal(isEncrypted({ debts: [] }), false);
});

test('passphrases are Unicode-normalised (same key for composed and decomposed input)', async () => {
  const parsed = JSON.parse(await encryptBackup(backup, 'café-pass-1'));
  const out = await decryptBackup(parsed, 'café-pass-1');
  assert.equal(out.ok, true);
});
