import { notFound, redirect } from 'next/navigation';

import { ROUTES, UUID_REGEX } from '@/lib/constants';
import { getServerClient } from '@/lib/supabase/server';
import { getCommunityBySlug } from '@/lib/data/campus';
import { requireUser } from '@/lib/auth/session';

/**
 * Canonical deep link alias.
 *
 * The specification lists `/community/<slug>` as a public deep link while the
 * application organises communities under `/communities/<slug>`. Rather than
 * duplicating the page, this route resolves the slug to its canonical URL so an
 * old or externally shared link never 404s.
 */
export default async function CommunityAliasPage({ params }) {
  await requireUser();
  const { slug } = await params;
  const value = String(slug || '').toLowerCase();

  if (!value || UUID_REGEX.test(value)) notFound();

  const supabase = await getServerClient();
  const community = await getCommunityBySlug(supabase, value);
  if (!community) notFound();

  redirect(ROUTES.community(community.slug));
}
