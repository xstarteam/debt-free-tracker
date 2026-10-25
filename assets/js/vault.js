/* Debt Free — passphrase-encrypted backups.
 *
 * Web Crypto only: PBKDF2-SHA-256 derives an AES-256-GCM key from the
 * passphrase; GCM authenticates the file, so a wrong passphrase or an edited
 * file is rejected instead of producing garbage. The passphrase is never
 * stored and never leaves this module.
 */

const ITERATIONS = 600_000; // OWASP guidance for PBKDF2-HMAC-SHA256
const MIN_ITERATIONS = 100_000;
const MAX_ITERATIONS = 2_000_000; // a crafted file can't freeze the page
const MAX_DATA = 7_000_000; // base64 characters (~5 MB)
const enc = new TextEncoder();
const dec = new TextDecoder();

export const MIN_PASSPHRASE = 8;

/** Web Crypto needs a secure context (https or localhost). */
export const canEncrypt = () => !!(globalThis.crypto && globalThis.crypto.subtle);

function toB64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function fromB64(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(passphrase, salt, iterations) {
  const material = await crypto.subtle.importKey('raw', enc.encode(String(passphrase).normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Encrypt a backup (the plain JSON text) into an encrypted backup file's text. */
export async function encryptBackup(text, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, ITERATIONS);
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text)));
  return JSON.stringify({
    app: 'debt-free',
    encrypted: true,
    version: 1,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS, salt: toB64(salt) },
    cipher: { name: 'AES-GCM', iv: toB64(iv) },
    data: toB64(data),
  }, null, 2);
}

/** Does a parsed backup file claim to be encrypted? */
export function isEncrypted(file) {
  return !!file && typeof file === 'object' && file.app === 'debt-free' && file.encrypted === true;
}

function readEnvelope(file) {
  const { kdf, cipher, data } = file;
  if (!kdf || kdf.name !== 'PBKDF2' || kdf.hash !== 'SHA-256') return null;
  if (!Number.isInteger(kdf.iterations) || kdf.iterations < MIN_ITERATIONS || kdf.iterations > MAX_ITERATIONS) return null;
  if (!cipher || cipher.name !== 'AES-GCM') return null;
  if (typeof data !== 'string' || !data || data.length > MAX_DATA) return null;
  try {
    const salt = fromB64(kdf.salt);
    const iv = fromB64(cipher.iv);
    const bytes = fromB64(data);
    if (salt.length < 16 || iv.length !== 12 || bytes.length < 17) return null;
    return { salt, iv, bytes, iterations: kdf.iterations };
  } catch {
    return null;
  }
}

/**
 * Decrypt an encrypted backup file (already parsed).
 * Resolves { ok: true, text } or { ok: false, error: 'format' | 'passphrase' }. Never throws.
 */
export async function decryptBackup(file, passphrase) {
  const env = isEncrypted(file) ? readEnvelope(file) : null;
  if (!env) return { ok: false, error: 'format' };
  try {
    const key = await deriveKey(passphrase, env.salt, env.iterations);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: env.iv }, key, env.bytes);
    return { ok: true, text: dec.decode(plain) };
  } catch {
    return { ok: false, error: 'passphrase' };
  }
}
