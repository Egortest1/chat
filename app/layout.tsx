import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Салон — мессенджер нового поколения',
  description: 'Личные сообщения, профиль и ваш собственный стиль общения.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body>{children}</body></html>;
}
