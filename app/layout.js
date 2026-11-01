import './globals.css';
import { LandingIntro } from '@/components/layout/GalacticIntro';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';

import localFont from 'next/font/local';
import { PLATFORM } from '@/lib/constants';
import { shouldUseVercelTelemetry } from '@/lib/vercel-telemetry';
import { DEVICE_COLOR_PREHYDRATION_SCRIPT } from '@/lib/device-colors';

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
 * Campus+ always starts from its permanent dark palette: the root renders
 * `data-theme="dark"` with a dark `color-scheme`, never a light or system
 * variant. A signed-in user may opt into four device-local color overrides in
 * Settings; the tiny static script below restores only those colors before the
 * first paint. No account or site-wide setting is read or changed.
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
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <body className={`${bodyFont.variable} ${displayFont.variable} ${microFont.variable} min-h-dvh bg-canvas text-ink antialiased`}>
        <script id="campusplus-device-colors">{DEVICE_COLOR_PREHYDRATION_SCRIPT}</script>
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
