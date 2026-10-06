import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { globalSearch } from '@/lib/search';
import { errors, toHttpResponse } from '@/lib/errors';

export const dynamic = 'force-dynamic';

/**
 * GET /api/search?q=&scope=&limit=&offset=
 *
 * Server-side proxy so the browser can debounce-query search without holding a
 * Supabase client per field. The heavy lifting is `public.global_search()`:
 * Postgres-native, RLS-scoped, block-aware, rate limited.
 */
export async function GET(request) {
  try {
    const user = await getCurrentUser();
    if (!user?.profile) throw errors.unauthenticated();

    const { searchParams } = new URL(request.url);
    const query = (searchParams.get('q') || '').slice(0, 80);
    const scope = (searchParams.get('scope') || 'all').slice(0, 24);
    const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 20, 1), 50);
    const offset = Math.max(Number(searchParams.get('offset')) || 0, 0);

    const supabase = await getServerClient();
    const result = await globalSearch(supabase, {
      query,
      scope,
      limit,
      offset,
      userId: user.profile.id,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return toHttpResponse(error);
  }
}
