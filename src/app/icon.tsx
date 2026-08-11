import { ImageResponse } from 'next/og';

import { shopName } from '@/ui/shop-config';

export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default function Icon() {
  const initial = shopName().trim().charAt(0).toUpperCase();

  return new ImageResponse(
    <div
      style={{
        alignItems: 'center',
        background: '#0f5138',
        borderRadius: 6,
        color: '#fcfdfd',
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
