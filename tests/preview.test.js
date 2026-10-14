import { afterEach, describe, expect, it, vi } from 'vitest';
import nextConfig from '../next.config.mjs';

afterEach(() => vi.unstubAllEnvs());

describe('local preview backend routing', () => {
  it('only exposes the fixture proxy when explicitly enabled in development', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NEXT_PUBLIC_LOCAL_PREVIEW', '1');
    expect(await nextConfig.rewrites()).toEqual([
      { source: '/api/preview-supabase/:path*', destination: 'http://127.0.0.1:3111/:path*' },
    ]);
    vi.stubEnv('NEXT_PUBLIC_LOCAL_PREVIEW', '');
    expect(await nextConfig.rewrites()).toEqual([]);
  });

  it('never exposes the fixture proxy in production, even if enabled', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_LOCAL_PREVIEW', '1');
    expect(await nextConfig.rewrites()).toEqual([]);
  });
});
