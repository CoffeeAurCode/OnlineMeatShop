import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: 'Online Meat Shop',
  description: 'Fresh meat, cut to order, delivered locally.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
