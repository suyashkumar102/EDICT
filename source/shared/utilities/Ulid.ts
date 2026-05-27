/**
 * ULID — Universally Unique Lexicographically Sortable Identifier.
 * Chosen over UUID v7 so event-store keys sort by time without a separate
 * timestamp prefix. 128 bits, base32 (Crockford), 26 chars.
 *
 * See https://github.com/ulid/spec — this is a self-contained implementation
 * because we want zero deps inside the domain & shared layers.
 */

import { brandULID, type ULID } from '@shared/types/BrandedPrimitives';

const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32
const ENCODING_LEN = 32;
const TIME_LEN = 10;
const RANDOM_LEN = 16;

const cryptoRandom = (): number => {
  if (
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.getRandomValues === 'function'
  ) {
    const buf = new Uint8Array(1);
    globalThis.crypto.getRandomValues(buf);
    return (buf[0] ?? 0) / 0x100;
  }
  return Math.random();
};

const encodeTime = (timestampMs: number, length: number): string => {
  if (timestampMs < 0 || !Number.isFinite(timestampMs)) {
    throw new RangeError(`Invalid ULID timestamp: ${timestampMs}`);
  }
  let now = Math.floor(timestampMs);
  const out: string[] = new Array(length);
  for (let i = length - 1; i >= 0; i -= 1) {
    const mod = now % ENCODING_LEN;
    out[i] = ENCODING.charAt(mod);
    now = (now - mod) / ENCODING_LEN;
  }
  return out.join('');
};

const encodeRandom = (length: number): string => {
  const out: string[] = new Array(length);
  for (let i = 0; i < length; i += 1) {
    const r = Math.floor(cryptoRandom() * ENCODING_LEN);
    out[i] = ENCODING.charAt(r);
  }
  return out.join('');
};

/**
 * Generate a fresh ULID. Pass a deterministic clock for tests; defaults to Date.now().
 */
export const mintUlid = (clock: () => number = Date.now): ULID => {
  return brandULID(encodeTime(clock(), TIME_LEN) + encodeRandom(RANDOM_LEN));
};

/**
 * Extract the timestamp encoded in a ULID. Useful for "give me all events
 * before timestamp X" queries without touching the event payload.
 */
export const ulidTimestamp = (ulid: ULID): number => {
  const timePart = ulid.slice(0, TIME_LEN);
  let result = 0;
  for (let i = 0; i < TIME_LEN; i += 1) {
    const c = timePart.charAt(i);
    const value = ENCODING.indexOf(c);
    if (value < 0) throw new SyntaxError(`Invalid ULID character: ${c}`);
    result = result * ENCODING_LEN + value;
  }
  return result;
};

export const isValidUlid = (raw: string): raw is ULID => {
  if (raw.length !== TIME_LEN + RANDOM_LEN) return false;
  for (let i = 0; i < raw.length; i += 1) {
    if (ENCODING.indexOf(raw.charAt(i)) < 0) return false;
  }
  return true;
};
