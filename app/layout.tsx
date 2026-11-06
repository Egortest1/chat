import type { Metadata } from 'next';
import './globals.css';
import './modern.css';

export const metadata: Metadata = {
  title: 'Chat by Barsik',
  description: 'Современный мессенджер для общения со своими людьми.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body>{children}</body></html>;
}
