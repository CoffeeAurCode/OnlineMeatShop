import { describe, expect, it } from 'vitest';

import { formatPhone, isE164, normalisePhone } from '@/domain/phone';

/**
 * `normalisePhone` — the function that decides whether somebody can log in.
 *
 * ⭐ THE CENTRAL CASE IN THIS FILE IS THE ONE THAT USED TO FAIL. The old
 * Canada-only version returned null for every non-NANP number, which was
 * defensible while the number was a display field on an order and became a
 * defect the moment it became a LOGIN: a normaliser that cannot express the
 * user's own number does not make the shop stricter, it makes it unusable.
 */
describe('normalisePhone', () => {
  it('accepts the shapes a Montreal customer actually types', () => {
    for (const raw of [
      '514-486-5246',
      '(514) 486-5246',
      '514 486 5246',
      '5144865246',
      '1 514 486 5246',
      '+1 514 486 5246',
    ]) {
      expect(normalisePhone(raw), raw).toBe('+15144865246');
    }
  });

  it('accepts an international number when the caller gave a country code', () => {
    expect(normalisePhone('+919876543210')).toBe('+919876543210');
    expect(normalisePhone('+44 20 7946 0958')).toBe('+442079460958');
    // `00` is the ITU international prefix and means exactly what `+` means.
    expect(normalisePhone('0044 20 7946 0958')).toBe('+442079460958');
  });

  /**
   * ⚠ THE DISTINCTION THE WHOLE FUNCTION TURNS ON. The same eleven digits are
   * a Canadian number when typed bare and an international claim when typed
   * with a `+`. Deciding after stripping punctuation loses that, and losing it
   * silently routes an Indian number to a Canadian one.
   */
  it('reads the + from the ORIGINAL string, before punctuation is stripped', () => {
    expect(normalisePhone('15144865246')).toBe('+15144865246');
    expect(normalisePhone('+15144865246')).toBe('+15144865246');
    // Not a NANP number at all, so the bare form must be refused rather than
    // silently prefixed with +1.
    expect(normalisePhone('919876543210')).toBeNull();
  });

  it('refuses what is not a phone number', () => {
    for (const raw of ['', '   ', 'hello', '12', '+0123456789', '+123456', '+1234567890123456']) {
      expect(normalisePhone(raw), raw).toBeNull();
    }
  });

  it('never returns a value that fails the database CHECK', () => {
    // `partner_phone_e164` is `^[+][1-9][0-9]{6,14}$`. Anything this function
    // returns must satisfy it, or the roster write fails at the last moment.
    const inputs = [
      '514-486-5246',
      '+919876543210',
      '0044 20 7946 0958',
      '+1 (514) 486 5246',
      'nonsense',
      '',
      '+00123',
    ];
    for (const raw of inputs) {
      const out = normalisePhone(raw);
      if (out !== null) expect(isE164(out), `${raw} -> ${out}`).toBe(true);
    }
  });

  it('is idempotent — normalising its own output changes nothing', () => {
    for (const raw of ['514-486-5246', '+919876543210', '1 514 486 5246']) {
      const once = normalisePhone(raw);
      expect(once).not.toBeNull();
      expect(normalisePhone(once as string)).toBe(once);
    }
  });
});

describe('formatPhone', () => {
  it('groups a NANP number and leaves everything else alone', () => {
    expect(formatPhone('+15144865246')).toBe('+1 514 486-5246');
    expect(formatPhone('+442079460958')).toBe('+442079460958');
  });
});
