/**
 * Decrypts private/briefing.enc, written by pipeline/crypto.py.
 * File: JSON {salt, iv, ct}, each base64. key = PBKDF2-SHA256(passphrase, salt, 250000) -> AES-GCM-256.
 * ct carries the 16-byte GCM tag appended, which is what Web Crypto expects.
 */
export const ITERATIONS = 250_000;

export function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function deriveKey(passphrase: string, salt: BufferSource): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Rejects (OperationError) on a wrong passphrase or tampered file. */
export async function decryptBriefing<T = unknown>(b64json: string, passphrase: string): Promise<T> {
  const env = JSON.parse(b64json) as { salt: string; iv: string; ct: string };
  const key = await deriveKey(passphrase, fromB64(env.salt));
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(env.iv) }, key, fromB64(env.ct));
  return JSON.parse(new TextDecoder().decode(pt)) as T;
}
