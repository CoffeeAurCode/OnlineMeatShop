import { beforeAll, describe, expect, it } from 'vitest';

import { TEST_DATABASE_URL } from './helpers/db';

/*
 * ⚠ IMPORTED LAZILY, AND NOT BECAUSE ANY OF IT TOUCHES A DATABASE.
 *
 * `src/adapters/moneris.ts` imports `@/db/client` for the `payment` table, and
 * that module builds a connection pool at IMPORT time — so a static import
 * here throws on a missing `DATABASE_URL` before a single assertion runs. The
 * pool is never used by anything below.
 */
let moneris: typeof import('@/adapters/moneris');

beforeAll(async () => {
  process.env.DATABASE_URL ??= TEST_DATABASE_URL;
  moneris = await import('@/adapters/moneris');
});

/**
 * The pure half of the Moneris adapter: how amounts, order ids and receipts
 * are encoded and read back.
 *
 * ⚠ THIS TOUCHES NO DATABASE AND NO NETWORK. It lives in the integration suite
 * only because `src/adapters/moneris.ts` is `server-only`, and that import is
 * stubbed by the integration config alone — the same reason `stub-guards`
 * lives here.
 *
 * ⭐ THESE FOUR FUNCTIONS ARE WHERE A MONEY BUG WOULD ACTUALLY LIVE. The
 * adapter has never spoken to Moneris, so nothing here proves the API shape is
 * right; what it does prove is that when the credentials arrive, an approval
 * is not read as a decline, a decline is not read as an approval, and $46.20
 * is not sent as $4620.
 */

describe('monerisAmount', () => {
  it('formats cents as a two-decimal string', () => {
    expect(moneris.monerisAmount(4620)).toBe('46.20');
    expect(moneris.monerisAmount(100)).toBe('1.00');
    expect(moneris.monerisAmount(0)).toBe('0.00');
  });

  it('⭐ pads the cents rather than dropping a trailing zero', () => {
    // `4605` → "46.5" would be forty-six dollars fifty on Moneris' side. The
    // padding is the whole difference between a 5c error and a $0.45 one.
    expect(moneris.monerisAmount(4605)).toBe('46.05');
    expect(moneris.monerisAmount(4650)).toBe('46.50');
    expect(moneris.monerisAmount(5)).toBe('0.05');
  });

  it('handles amounts past the float-precision danger zone', () => {
    expect(moneris.monerisAmount(99999999)).toBe('999999.99');
  });

  it('refuses anything that is not a non-negative integer of cents', () => {
    expect(() => moneris.monerisAmount(46.2)).toThrow();
    expect(() => moneris.monerisAmount(-1)).toThrow();
    expect(() => moneris.monerisAmount(Number.NaN)).toThrow();
  });
});

describe('monerisOrderId', () => {
  it('is stable for the same idempotency key — that IS the idempotency', () => {
    expect(moneris.monerisOrderId('capture:abc:4620')).toBe(moneris.monerisOrderId('capture:abc:4620'));
  });

  it('⭐ changes when the amount changes', () => {
    // The keys carry the amount, so a different amount must be a different
    // Moneris transaction rather than a silent replay of the old figure.
    expect(moneris.monerisOrderId('capture:abc:4620')).not.toBe(moneris.monerisOrderId('capture:abc:4621'));
  });

  it('stays inside Moneris’ 50-character limit and uses safe characters', () => {
    const id = moneris.monerisOrderId('capture:0f8f7f2e-2c9a-4a1e-9f0f-2b7d1f4c9a3e:1234567');
    expect(id.length).toBeLessThanOrEqual(50);
    expect(id).toMatch(/^ps-[0-9a-f]{24}$/);
  });
});

describe('encodeAuthId / decodeAuthId', () => {
  it('round-trips the pair a completion needs', () => {
    const authId = moneris.encodeAuthId('ps-abc123', '660123456');
    expect(moneris.decodeAuthId(authId)).toEqual({
      monerisOrderId: 'ps-abc123',
      txnNumber: '660123456',
    });
  });

  it('refuses shapes that are not a pair, rather than guessing', () => {
    expect(moneris.decodeAuthId('no-colon-here')).toBeNull();
    expect(moneris.decodeAuthId(':leading')).toBeNull();
    expect(moneris.decodeAuthId('trailing:')).toBeNull();
    // A stub authorisation reaching the Moneris adapter must not be decoded
    // into something that looks usable.
    expect(moneris.decodeAuthId('stub_auth_0f8f7f2e')).toBeNull();
  });
});

describe('parseReceipt', () => {
  const receipt = (body: string) => `<?xml version="1.0"?><response><receipt>${body}</receipt></response>`;

  it('reads an approval', () => {
    const r = moneris.parseReceipt(
      receipt(
        '<ResponseCode>027</ResponseCode><Message>APPROVED</Message>' +
          '<TransID>660123456</TransID><ReferenceNum>660123456001</ReferenceNum>' +
          '<TransAmount>46.20</TransAmount>',
      ),
    );
    expect(r.approved).toBe(true);
    expect(r.txnNumber).toBe('660123456');
    expect(r.transAmount).toBe('46.20');
  });

  it('reads a decline — 50 and above is refused', () => {
    const r = moneris.parseReceipt(
      receipt('<ResponseCode>481</ResponseCode><Message>DECLINED</Message><TransID>1</TransID>'),
    );
    expect(r.approved).toBe(false);
  });

  it('treats 49 as approved and 50 as not, which is where the line is', () => {
    expect(moneris.parseReceipt(receipt('<ResponseCode>49</ResponseCode>')).approved).toBe(true);
    expect(moneris.parseReceipt(receipt('<ResponseCode>50</ResponseCode>')).approved).toBe(false);
  });

  it('⭐ does NOT read a system error as an approval', () => {
    /*
     * The trap this test exists for. On a system error the field comes back as
     * the literal string "null", or empty, or missing — and `Number('')` is
     * `0`, which is less than 50 and would sail through a naive check.
     *
     * Getting this wrong records a hold that does not exist, and the shop finds
     * out days later when the capture fails against nothing.
     */
    expect(moneris.parseReceipt(receipt('<ResponseCode>null</ResponseCode>')).approved).toBe(false);
    expect(moneris.parseReceipt(receipt('<ResponseCode></ResponseCode>')).approved).toBe(false);
    expect(moneris.parseReceipt(receipt('<Message>System error</Message>')).approved).toBe(false);
    expect(moneris.parseReceipt('not xml at all').approved).toBe(false);
  });

  it('does not mistake a negative code for an approval either', () => {
    expect(moneris.parseReceipt(receipt('<ResponseCode>-1</ResponseCode>')).approved).toBe(false);
  });
});
