import { ImageResponse } from 'next/og';

import { shopName } from '@/ui/shop-config';

export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

/**
 * ⚠ THE HEXES ARE LITERAL BECAUSE THEY HAVE TO BE, AND THAT MAKES THEM DRIFT.
 *
 * This renders in a Satori worker with no stylesheet, so `var(--accent)` does
 * not resolve here and the token layer cannot reach it. The values below are
 * copies of `--accent` and `--accent-ink` from `src/app/globals.css` and must
 * be changed with them.
 *
 * 🔴 THE BACKGROUND WAS `#0f5138` UNTIL 2026-08-19 — A GREEN THAT WAS NEVER IN
 * THIS PALETTE AT ALL. It is a survivor of the cool-green "cold larder" scheme
 * that was replaced when the shop pivoted from meat to fish, and it outlived
 * that scheme by a full brand change because a favicon is 32 pixels in a
 * browser tab and nobody looks at it. That is exactly the drift this comment
 * exists to prevent happening again.
 */
export default function Icon() {
  const initial = shopName().trim().charAt(0).toUpperCase();

  return new ImageResponse(
    <div
      style={{
        alignItems: 'center',
        background: '#0e7490',
        borderRadius: 8,
        color: '#ffffff',
        display: 'flex',
        fontSize: 16,
        fontWeight: 600,
        height: '100%',
        justifyContent: 'center',
        width: '100%',
      }}
    >
      {initial}
    </div>,
    size,
  );
}
