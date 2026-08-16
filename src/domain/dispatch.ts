/**
 * The delivery partner's dispatch message.
 *
 * PURE. No I/O, no clock, no database. See eslint.config.mjs.
 *
 * `07-PLAN` §4. One message that gets a person who has never seen this order
 * to the right door, with the right box, without phoning the shop.
 *
 * ══ WHAT IS DELIBERATELY NOT IN IT ════════════════════════════════════════
 *
 * ⚠ NO ORDER TOTAL, NO PAYMENT STATUS, NO CUSTOMER EMAIL, AND NO LINK TO
 * ANYTHING THAT WOULD SHOW ANOTHER ORDER.
 *
 * The partner is not a user of this system (`07-PLAN` §1.5) — they are a name
 * and a number on a roster, and this message is the entire interface. Every
 * field in it has to earn its place by answering a question the driver will
 * otherwise ask by phone. "What is it worth" is not one of those questions,
 * and a money figure in a forwarded text is a liability with no upside.
 *
 * `assertNoForbiddenFields` below is not decoration: it is a runtime backstop
 * on a message assembled from a database row, where the field that leaks is
 * the one somebody adds to the snapshot type six months from now.
 */

import { mapsDirectionsUrl, mapsDirectionsUrlForAddress } from './maps';

export interface DispatchLine {
  readonly name: string;
  /** "1 kg", "2 × pack". Already formatted — this module does no arithmetic. */
  readonly quantityLabel: string;
  /** A `COOKED_HOT` line. Decides which bag it goes in, so it is marked. */
  readonly hot: boolean;
}

export interface DispatchOrder {
  /** The short reference both the owner and the partner say out loud. */
  readonly reference: string;
  readonly shopName: string;
  /** "today 14:00-16:00". Formatted by the caller, which owns the timezone. */
  readonly slotLabel: string;
  readonly lines: readonly DispatchLine[];

  readonly addressLine1: string;
  readonly addressLine2: string | null;
  readonly city: string;
  readonly province: string;
  readonly postalCode: string | null;
  readonly deliveryNotes: string | null;
  readonly dropOff: string | null;

  /** E.164. The partner is at the door and nobody is answering. */
  readonly customerPhone: string;
  readonly customerName: string | null;

  readonly lat: number | null;
  readonly lng: number | null;
}

export interface DispatchMessage {
  readonly text: string;
  readonly mapsUrl: string;
  /** How many SMS segments `text` costs. See `segmentsFor`. */
  readonly segments: number;
}

/**
 * ⭐ THE COORDINATE FINDS THE BUILDING; THE ADDRESS LINES SAY WHICH DOOR.
 *
 * `07-PLAN` §1.3. Both are in the message, always, and neither substitutes for
 * the other. GPS on a phone in a stairwell is routinely 30 m out, which is the
 * difference between two addresses on a terrace — so a message built from the
 * coordinate alone sends a driver to approximately the right place, which is
 * the failure that wastes twenty minutes rather than the one that is obvious.
 */
export function buildDispatchMessage(order: DispatchOrder): DispatchMessage {
  const mapsUrl =
    order.lat !== null && order.lng !== null
      ? mapsDirectionsUrl(order.lat, order.lng)
      : mapsDirectionsUrlForAddress(addressOneLine(order));

  const items = order.lines
    .map((l) => `${l.quantityLabel} ${l.name}${l.hot ? ' (HOT)' : ''}`)
    .join(', ');

  const address = [
    order.addressLine1,
    order.addressLine2,
    `${order.city} ${order.province}${order.postalCode === null ? '' : ` ${order.postalCode}`}`,
    order.deliveryNotes,
    order.dropOff,
  ]
    .filter((line): line is string => line !== null && line.trim() !== '')
    .join('\n');

  const text = [
    `New order #${order.reference} - ${order.shopName}`,
    '',
    `Deliver: ${order.slotLabel}`,
    `Items: ${items}`,
    '',
    'Deliver to:',
    address,
    '',
    `Customer: ${order.customerName === null ? '' : `${order.customerName} `}${order.customerPhone}`,
    '',
    `Route: ${mapsUrl}`,
  ].join('\n');

  return { text, mapsUrl, segments: segmentsFor(text) };
}

/** The address as one line, for the geocoded fallback route link. */
export function addressOneLine(order: DispatchOrder): string {
  return [
    order.addressLine1,
    order.addressLine2,
    order.city,
    order.province,
    order.postalCode,
  ]
    .filter((p): p is string => p !== null && p.trim() !== '')
    .join(', ');
}

/**
 * How many SMS segments a message costs, which is how it is BILLED.
 *
 * ══ WHY THIS IS NOT `Math.ceil(length / 160)` ═════════════════════════════
 *
 * ⚠ ONE ACCENTED CHARACTER MORE THAN HALVES THE CAPACITY OF EVERY SEGMENT.
 *
 * GSM-7 packs 160 characters into a segment. A single character outside that
 * alphabet — `é` in a Montreal street name, a curly apostrophe pasted from a
 * word processor, an emoji in a delivery note the customer typed — forces the
 * WHOLE message into UCS-2, where a segment holds 70. A 300-character message
 * is 2 segments in one alphabet and 5 in the other, and the customer's
 * delivery note is the field most likely to flip it.
 *
 * Concatenated messages are smaller still (153 / 67) because the segment
 * header eats into the payload. Getting this wrong understates the bill and,
 * worse, understates it in exactly the cases where the message is longest.
 *
 * The `€` and the nine other characters in the GSM-7 EXTENSION table cost two
 * characters each rather than one, which is the last footgun in here.
 */
const GSM7 =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM7_EXTENDED = '^{}\[~]|€';

export function segmentsFor(text: string): number {
  const chars = [...text];

  let units = 0;
  let gsm = true;
  for (const c of chars) {
    if (GSM7.includes(c)) {
      units += 1;
    } else if (GSM7_EXTENDED.includes(c)) {
      units += 2;
    } else {
      gsm = false;
      break;
    }
  }

  if (!gsm) {
    // UCS-2 is billed in 16-bit code UNITS, not code points: an emoji outside
    // the BMP is a surrogate pair and costs two.
    const ucsUnits = text.length;
    if (ucsUnits <= 70) return 1;
    return Math.ceil(ucsUnits / 67);
  }

  if (units <= 160) return 1;
  return Math.ceil(units / 153);
}

/**
 * A runtime backstop against the message ever carrying money or an email.
 *
 * Called by the route that sends. It exists because the leak this guards
 * against does not come from this file — it comes from a future field on
 * `DispatchOrder` that somebody interpolates into the template without asking
 * whether a driver should see it.
 */
export function forbiddenFieldIn(text: string): string | null {
  if (/\$\s*\d/.test(text)) return 'money';
  if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(text)) return 'email';
  return null;
}
