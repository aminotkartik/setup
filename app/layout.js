import './globals.css';
import { LandingIntro } from '@/components/layout/GalacticIntro';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';

import localFont from 'next/font/local';
import { PLATFORM } from '@/lib/constants';
import { shouldUseVercelTelemetry } from '@/lib/vercel-telemetry';

/* Hallmark Lumen's exact faces, self-hosted for reproducible production and
   offline rendering. The variables override the generated token fallbacks on
   <body>, so every route and component receives the same real font binaries. */
const bodyFont = localFont({
  src: [
    { path: './fonts/Geist-Regular.woff2', weight: '400', style: 'normal' },
    { path: './fonts/Geist-Medium.woff2', weight: '500', style: 'normal' },
  ],
  variable: '--font-body',
  display: 'swap',
});

const displayFont = localFont({
  src: './fonts/InstrumentSerif-Regular.woff2',
  weight: '400',
  style: 'normal',
  variable: '--font-display',
  display: 'swap',
});

const microFont = localFont({
  src: './fonts/GeistMono-Regular.woff2',
  weight: '400',
  style: 'normal',
  variable: '--font-outlier',
  display: 'swap',
});

/**
 * Campus+ — root layout.
 *
 * Geist is the reading and interface family, Instrument Serif the restrained
 * display face, and Geist Mono the readout face. No icon webfont. The
 * application frame (sidebar / bottom navigation) is applied per-route group
 * so the sign-in and setup screens can stay deliberately plain.
 *
 * Campus+ is permanently dark: the root always renders `data-theme="dark"`
 * with a dark `color-scheme`, so the very first paint is the night palette —
 * no cookie, saved preference or operating-system setting can select anything
 * else, and there is never a flash of light.
 *
 * All three faces are local next/font assets, so production and offline builds
 * do not depend on a third-party font CDN.
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
  // Hallmark Lumen night paper (--color-paper); it never follows the device.
  themeColor: '#060510',
};

export default function RootLayout({ children }) {
  /* The original landing sequence is route-gated to a fresh Home document.
     It does no work on other routes or on client navigation back to Home. */
  return (
    <html lang="en" data-theme="dark">
      <body className={`${bodyFont.variable} ${displayFont.variable} ${microFont.variable} min-h-dvh bg-canvas text-ink antialiased`}>
        <LandingIntro>{children}</LandingIntro>
        {shouldUseVercelTelemetry() ? (
          <>
            <Analytics />
            <SpeedInsights />
          </>
        ) : null}
      </body>
    </html>
  );
}
