import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import { ROUTES } from '@/lib/constants';
import { PageHeader, Card, Notice } from '@/components/ui';
import { RandomLobby } from '@/components/random/RandomLobby';

export const metadata = { title: 'Random' };

/**
 * Random (spec §29).
 *
 * Sessions have no URL of their own: this page renders the lobby, and once a
 * match exists the chat lives in client state on the same route. Nothing about a
 * Random session can be shared, bookmarked or linked to.
 */
export default async function RandomPage() {
  const user = await requireUser();
  const supabase = await getServerClient();
  const actor = toActor(user);

  // `random_session_view` is the participant-safe projection: it carries no
  // identity, only the session id, status and my own side.
  const { data: session } = await supabase
    .from('random_session_view')
    .select('id, status, started_at, expires_at, message_count, end_reason, my_side')
    .eq('status', 'active')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let initialSession = null;
  if (session) {
    const { data: messages } = await supabase
      .from('random_messages_view')
      .select('id, session_id, mine, content, gif, created_at, status')
      .eq('session_id', session.id)
      .order('created_at', { ascending: true })
      .limit(200);
    initialSession = { ...session, messages: messages || [] };
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Random"
        description="An anonymous conversation with another student. Temporary, unlisted, reportable."
        back={{ href: ROUTES.chat, label: 'Messages' }}
      />

      <RandomLobby canUseRandom={can(actor, 'use_random_chat')} initialSession={initialSession} />

      <Card className="flex flex-col gap-2 p-4">
        <h2 className="text-sm font-semibold">How Random works</h2>
        <ul className="flex list-inside list-disc flex-col gap-1 text-[0.8125rem] text-muted">
          <li>Matching is one waiting student paired with the longest-waiting eligible partner.</li>
          <li>Blocked students are never matched, and a block ends a session immediately.</li>
          <li>No presence, no typing indicator, no read receipts — messages are text and GIFs.</li>
          <li>Sessions expire and are cleaned up; a moderator needs an explicit permission to see identities.</li>
        </ul>
      </Card>

      {can(actor, 'moderate_random') ? (
        <Notice tone="neutral" icon="shield">
          You can review reported Random sessions in the moderation queue.
        </Notice>
      ) : null}
    </div>
  );
}
