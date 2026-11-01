/**
 * Sync codes and end-to-end encryption. The code is the only secret: it derives both the vault id
 * the server sees (a hash) and the AES-GCM key progress is encrypted with on the phone.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32: no I, L, O, U
const CODE_LEN = 20; // 100 bits

export function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LEN));
  return Array.from(bytes, (b) => ALPHABET[b & 31]).join('');
}
/** Accepts any spacing/dashes/case; O→0 and I/L→1 like Crockford. Returns null if it can't be a code. */
export function normalizeCode(input: string): string | null {
  const c = input.toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  return c.length === CODE_LEN && [...c].every((ch) => ALPHABET.includes(ch)) ? c : null;
}
export const formatCode = (c: string) => c.match(/.{1,4}/g)!.join('-');

const enc = new TextEncoder();
const digest = async (s: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)));
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

export const vaultId = async (code: string) => hex(await digest(`geonaut-sync:v1:id:${code}`));
const aesKey = async (code: string) => crypto.subtle.importKey('raw', await digest(`geonaut-sync:v1:key:${code}`), 'AES-GCM', false, ['encrypt', 'decrypt']);

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream) {
  const out = new Response(new Blob([data as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}
const toB64 = (b: Uint8Array) => { let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** JSON → gzip → AES-GCM → "g1." + base64(iv ‖ ciphertext). */
export async function seal(code: string, value: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const zipped = await pipe(enc.encode(JSON.stringify(value)), new CompressionStream('gzip'));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(code), zipped as BufferSource));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv); out.set(ct, 12);
  return 'g1.' + toB64(out);
}
/** Throws if the blob wasn't sealed with this code (wrong code or tampered data). */
export async function open<T>(code: string, blob: string): Promise<T> {
  if (!blob.startsWith('g1.')) throw new Error('unknown sync format — update Geonaut');
  const raw = fromB64(blob.slice(3));
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.subarray(0, 12) }, await aesKey(code), raw.subarray(12));
  const json = await pipe(new Uint8Array(plain), new DecompressionStream('gzip'));
  return JSON.parse(new TextDecoder().decode(json)) as T;
}
