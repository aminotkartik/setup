/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Campus+ is text-first: user uploads do not exist and the only external media
  // is a GIF from GIPHY, whose URL is validated against this same host list
  // before it is ever stored (lib/giphy). `unoptimized` keeps GIF animation and
  // avoids proxying third-party media through the deployment.
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'media.giphy.com' },
      { protocol: 'https', hostname: 'media0.giphy.com' },
      { protocol: 'https', hostname: 'media1.giphy.com' },
      { protocol: 'https', hostname: 'media2.giphy.com' },
      { protocol: 'https', hostname: 'media3.giphy.com' },
      { protocol: 'https', hostname: 'media4.giphy.com' },
    ],
  },
  // Local tooling (the sandbox preview proxy) frames the dev server, so the
  // clickjacking guard is only sent by real deployments — `next dev` runs with
  // NODE_ENV=development, `next build`/Vercel always with production.
  async headers() {
    const headers = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    ];
    if (process.env.NODE_ENV === 'production') {
      headers.push({ key: 'X-Frame-Options', value: 'DENY' });
    }
    return [{ source: '/:path*', headers }];
  },
};

export default nextConfig;
