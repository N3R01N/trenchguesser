import type { Metadata, Viewport } from 'next';
import { Anton } from 'next/font/google';
import './globals.css';

/**
 * The wordmark face, and only the wordmark.
 *
 * Condensed because the name is thirteen characters and has to sit on one line
 * of a narrow phone at a size worth looking at. Body copy stays on the system
 * stack, which costs nothing and renders natively on every device at the table.
 */
const display = Anton({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Trenchguesser',
  description: 'Guess the shitcoin. Closest wins, worst pays.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0b0b0c' },
  ],
};

/**
 * Applies a stored theme before the first paint.
 *
 * Without this the page renders at the system theme and then corrects itself,
 * which on a phone in a dark room is a white flash in the face.
 */
const THEME_BOOTSTRAP = `try{var t=localStorage.getItem('tg:theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={display.variable}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
