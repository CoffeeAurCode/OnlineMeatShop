import { describe, expect, it } from 'vitest';

import {
  buildDispatchMessage,
  forbiddenFieldIn,
  segmentsFor,
  type DispatchOrder,
} from '@/domain/dispatch';

/**
 * The delivery partner's message.
 *
 * ⚠ EVERY FIXTURE HERE IS FICTIONAL — `Sample Street`, `A1A 1A1`, a 555
 * number. This repository is public and a test that depends on real customer
 * data would both leak it and break the moment the catalog changes.
 */
const BASE: DispatchOrder = {
  reference: '027e1f7e',
  shopName: 'Sample Fish Co',
  slotLabel: 'Tue 18 Aug 14:00-16:00',
  lines: [
    { name: 'Sample arctic char', quantityLabel: '1 kg', hot: false },
    { name: 'Sample fish and chips', quantityLabel: '2 x', hot: true },
  ],
  addressLine1: '4200 Sample Street',
  addressLine2: 'Apt 3',
  city: 'Sampleville',
  province: 'QC',
  postalCode: 'A1A 1A1',
  deliveryNotes: 'Buzzer 402',
  dropOff: 'Hand to customer',
  customerPhone: '+15145550142',
  customerName: 'Sample Customer',
  lat: 45.5019,
  lng: -73.567,
};

describe('buildDispatchMessage', () => {
  it('carries everything a driver needs to find the door', () => {
    const { text } = buildDispatchMessage(BASE);

    expect(text).toContain('027e1f7e');
    expect(text).toContain('Tue 18 Aug 14:00-16:00');
    expect(text).toContain('4200 Sample Street');
    expect(text).toContain('Apt 3');
    expect(text).toContain('Sampleville QC A1A 1A1');
    expect(text).toContain('Buzzer 402');
    expect(text).toContain('Hand to customer');
    expect(text).toContain('+15145550142');
  });

  /**
   * ⭐ Hot food is a food-safety constraint and it decides which bag the line
   * goes in. A driver who cannot tell has no way to recover.
   */
  it('marks a hot line and does not mark a cold one', () => {
    const { text } = buildDispatchMessage(BASE);
    expect(text).toContain('Sample fish and chips (HOT)');
    expect(text).not.toContain('Sample arctic char (HOT)');
  });

  it('routes by coordinate when there is one', () => {
    const { mapsUrl, text } = buildDispatchMessage(BASE);
    expect(mapsUrl).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=45.5019,-73.567&travelmode=driving',
    );
    expect(text).toContain(mapsUrl);
    // No `origin`, so Maps routes from wherever the driver actually is.
    expect(mapsUrl).not.toContain('origin=');
  });

  it('falls back to the typed address when the customer declined GPS', () => {
    const { mapsUrl } = buildDispatchMessage({ ...BASE, lat: null, lng: null });
    expect(mapsUrl).toContain('destination=4200%20Sample%20Street');
    expect(mapsUrl).toContain('Sampleville');
  });

  /**
   * ⚠ THE ADDRESS LINES ARE IN THE MESSAGE EVEN WHEN THE COORDINATE IS.
   * GPS in a stairwell is routinely 30 m out, which is the difference between
   * two doors on a terrace. This is the assertion that stops somebody
   * "simplifying" the message down to the map link.
   */
  it('includes the address lines even when a coordinate is present', () => {
    const { text } = buildDispatchMessage(BASE);
    expect(text).toContain('4200 Sample Street');
    expect(text).toContain('maps/dir');
  });

  it('never carries money or an email address', () => {
    const { text } = buildDispatchMessage(BASE);
    expect(forbiddenFieldIn(text)).toBeNull();
    expect(text).not.toMatch(/\$/);
    expect(text).not.toMatch(/@/);
  });

  it('has no raw null or undefined in it, whatever is missing', () => {
    const sparse: DispatchOrder = {
      ...BASE,
      addressLine2: null,
      postalCode: null,
      deliveryNotes: null,
      dropOff: null,
      customerName: null,
    };
    const { text } = buildDispatchMessage(sparse);
    expect(text).not.toContain('null');
    expect(text).not.toContain('undefined');
    expect(text).toContain('4200 Sample Street');
  });

  it('survives an apostrophe in a street name', () => {
    const { text } = buildDispatchMessage({ ...BASE, addressLine1: "12 O'Brien Street" });
    expect(text).toContain("12 O'Brien Street");
  });
});

/**
 * SMS segmentation — this is how the message is BILLED, and it is not
 * `length / 160`.
 */
describe('segmentsFor', () => {
  it('counts a plain GSM-7 message', () => {
    expect(segmentsFor('a'.repeat(160))).toBe(1);
    expect(segmentsFor('a'.repeat(161))).toBe(2);
    expect(segmentsFor('a'.repeat(306))).toBe(2);
    expect(segmentsFor('a'.repeat(307))).toBe(3);
  });

  /**
   * ⭐ THE CASE THAT SURPRISES PEOPLE. One accented character forces the WHOLE
   * message into UCS-2, where a segment holds 70 instead of 160. A Montreal
   * street name or a customer's delivery note is the field most likely to do
   * it, and the bill more than doubles.
   */
  it('collapses to UCS-2 capacity the moment one character is outside GSM-7', () => {
    const ascii = 'a'.repeat(100);
    expect(segmentsFor(ascii)).toBe(1);
    // A curly apostrophe — what a word processor produces, and not in GSM-7.
    expect(segmentsFor(`${ascii}’`)).toBe(2);
  });

  it('charges two units for a GSM-7 extension character', () => {
    // `€` is in the extension table and costs two septets, so 80 of them fill
    // a 160-character segment exactly.
    expect(segmentsFor('€'.repeat(80))).toBe(1);
    expect(segmentsFor('€'.repeat(81))).toBe(2);
  });

  it('prices the real message at something sane', () => {
    const { segments, text } = buildDispatchMessage(BASE);
    expect(segments).toBe(segmentsFor(text));
    // Not an assertion about the exact number — an assertion that the message
    // has not quietly grown into something expensive.
    expect(segments).toBeLessThanOrEqual(4);
  });
});

describe('forbiddenFieldIn', () => {
  it('catches a total and an email that should never have been interpolated', () => {
    expect(forbiddenFieldIn('Total: $84.20')).toBe('money');
    expect(forbiddenFieldIn('Customer: sample@example.com')).toBe('email');
    expect(forbiddenFieldIn('Deliver: Tue 14:00-16:00')).toBeNull();
  });
});
