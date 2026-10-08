import './globals.css';

import { PLATFORM } from '@/lib/constants';
import { readTheme } from '@/lib/theme';

/**
 * Campus+ — root layout.
 *
 * Typography-first: one sans-serif family, no display fonts, no icon webfont.
 * The application frame (sidebar / bottom navigation) is applied per-route
 * group so the sign-in and setup screens can stay deliberately plain.
 *
 * The appearance (light/dark) is stored in a cookie and read here, so the very
 * first paint already has the right palette: no flash of the wrong theme, and
 * no inline bootstrap script. `applyTheme()` keeps the cookie in step.
 *
 * The font stack prefers Inter (then Geist) and falls back to the platform UI
 * font. The font is not fetched at build time on purpose: a build that depends
 * on a third-party CDN cannot be reproduced offline. To self-host Inter, drop
 * the woff2 files into app/fonts/ and switch to next/font/local — see
 * docs/DEPLOYMENT.md.
 */

export const metadata = {
  title: {
    default: `${PLATFORM.name} — ${PLATFORM.collegeName}`,
    template: `%s · ${PLATFORM.name}`,
  },
  description: `${PLATFORM.tagline} An unofficial, text-first platform for ${PLATFORM.collegeName} students.`,
  applicationName: PLATFORM.name,
  // No images, no social preview cards: Campus+ is text-first and stores no media.
  robots: { index: false, follow: false },
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7f5f1' },
    { media: '(prefers-color-scheme: dark)', color: '#121824' },
  ],
};

export default async function RootLayout({ children }) {
  const theme = await readTheme();

  return (
    <html lang="en" data-theme={theme} suppressHydrationWarning>
      <body className="min-h-dvh bg-canvas text-ink antialiased">
        {children}
      </body>
    </html>
  );
}
