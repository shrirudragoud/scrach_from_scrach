import type { Metadata } from 'next';
import type { ReactNode } from 'react';
// Self-hosted font (no Google request): school networks often block third-party hosts.
import '@fontsource/nunito/700.css';
import '@fontsource/nunito/800.css';
import '@fontsource/nunito/900.css';
import './globals.css';

export const metadata: Metadata = { title: 'Code → Blocks' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
