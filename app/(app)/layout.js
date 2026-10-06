import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import { AppShell } from '@/components/layout/AppShell';

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
 */
export default async function AppLayout({ children }) {
  const user = await requireUser();
  const actor = toActor(user);

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

  return (
    <AppShell
      user={{
        username: user.profile?.username,
        displayName: user.profile?.display_name,
        staffLabel: user.roles?.includes('admin') ? 'Administrator' : undefined,
      }}
      unreadNotifications={unread}
      canModerate={can(actor, 'review_reports')}
      canAdmin={can(actor, 'view_audit_logs') || can(actor, 'manage_platform_settings')}
    >
      {children}
    </AppShell>
  );
}
