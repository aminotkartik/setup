import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import { AppShell } from '@/components/layout/AppShell';
import { readTheme } from '@/lib/theme';

// Every page in this group depends on the signed-in student, so nothing here is
// cached: a page rendered for one student must never be served to another.
export const dynamic = 'force-dynamic';

/**
 * The authenticated application frame.
 *
 * Every route in this group takes the same path: resolve the session, apply the
 * account/onboarding gate, then render inside the shell so desktop and mobile
 * keep the same navigation. Authorization *inside* each page is enforced again
 * by RLS and by `can(...)` — this layout only decides whether the frame shows.
 *
 * The Create menu is built here, on the server, so the browser never decides
 * what a student is allowed to publish.
 */
export default async function AppLayout({ children }) {
  const user = await requireUser();
  const actor = toActor(user);
  const theme = await readTheme();

  // Unread badge: the count is the recipient's own rows, so RLS does the
  // filtering for us.
  let unread = 0;
  const supabase = await getServerClient();
  if (supabase) {
    const { count } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .is('read_at', null);
    unread = count || 0;
  }

  const createItems = [
    ...(can(actor, 'create_posts')
      ? [
          { href: '/home', label: 'Post or poll', icon: 'comment' },
          { href: '/home?kind=discussion', label: 'Discussion', icon: 'chat' },
        ]
      : []),
    ...(can(actor, 'create_marketplace_listing') ? [{ href: '/market/new', label: 'Marketplace listing', icon: 'tag' }] : []),
    ...(can(actor, 'create_gigs') ? [{ href: '/market/new?type=gig', label: 'Gig', icon: 'briefcase' }] : []),
    ...(can(actor, 'create_communities')
      ? [
          { href: '/communities/new', label: 'Community', icon: 'users' },
          { href: '/communities/new?kind=study_group', label: 'Study group', icon: 'book' },
        ]
      : []),
    ...(can(actor, 'create_lost_found') ? [{ href: '/campus/lost-found/new', label: 'Lost & found', icon: 'search' }] : []),
    ...(can(actor, 'create_team_posts') ? [{ href: '/campus/teams/new', label: 'Team post', icon: 'sparkle' }] : []),
  ];

  return (
    <AppShell
      user={{
        username: user.profile?.username,
        displayName: user.profile?.display_name,
        roles: user.roles,
        staffLabel: user.roles?.includes('admin') ? 'Administrator' : undefined,
      }}
      unreadNotifications={unread}
      canModerate={can(actor, 'review_reports')}
      canAdmin={can(actor, 'view_audit_logs') || can(actor, 'manage_platform_settings')}
      createItems={createItems}
      theme={theme}
    >
      {children}
    </AppShell>
  );
}
