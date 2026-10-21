import { notFound, redirect } from 'next/navigation';
import { ROUTES, UUID_REGEX } from '@/lib/constants';

/**
 * Legacy club detail address. Every notification, search result and bookmark
 * created before clubs got their own section points here; it forwards to the
 * canonical `/clubs/<id>` page. `tests/spec.test.js` pins the path.
 */
export default async function LegacyClubPage({ params }) {
  const { id } = await params;
  if (!UUID_REGEX.test(id)) notFound();
  redirect(ROUTES.club(id));
}
