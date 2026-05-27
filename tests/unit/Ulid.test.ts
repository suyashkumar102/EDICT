import { describe, expect, it } from 'vitest';
import { isValidUlid, mintUlid, ulidTimestamp } from '@shared/utilities/Ulid';

describe('ULID', () => {
  it('mints a 26-character base32 ULID', () => {
    const u = mintUlid(() => 1_700_000_000_000);
    expect(u).toHaveLength(26);
    expect(isValidUlid(u)).toBe(true);
  });

  it('encodes the timestamp recoverably in the first 10 chars', () => {
    const ts = 1_700_000_000_000;
    const u = mintUlid(() => ts);
    expect(ulidTimestamp(u)).toBe(ts);
  });

  it('produces lexicographically increasing ULIDs as time advances', () => {
    const earlier = mintUlid(() => 1_000_000);
    const later = mintUlid(() => 2_000_000);
    expect(earlier < later).toBe(true);
  });

  it('rejects malformed strings', () => {
    expect(isValidUlid('short')).toBe(false);
    expect(isValidUlid('1'.repeat(26).replace(/1/g, 'I'))).toBe(false); // 'I' not in Crockford
  });
});
