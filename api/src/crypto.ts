import { base64ToBytes, bytesToBase64 } from './password.js';

/**
 * AES-GCM envelope for third-party secrets (intervals.icu API keys).
 * Key = SHA-256 of a domain tag + AUTH_SECRET. Stored: `v1$iv$cipher`.
 */
async function aesKey(secret: string): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`override-studio-seal-v1:${secret}`),
  );
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function sealSecret(secret: string, plaintext: string): Promise<string> {
  const key = await aesKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
    key,
    new TextEncoder().encode(plaintext),
  );
  return `v1$${bytesToBase64(iv)}$${bytesToBase64(new Uint8Array(cipher))}`;
}

export async function openSecret(secret: string, sealed: string): Promise<string | null> {
  const parts = sealed.split('$');
  if (parts.length !== 3 || parts[0] !== 'v1') return null;
  try {
    const key = await aesKey(secret);
    const iv = base64ToBytes(parts[1]);
    const data = base64ToBytes(parts[2]);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
      key,
      data.buffer as ArrayBuffer,
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}
