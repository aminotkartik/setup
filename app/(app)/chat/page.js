import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import { listConversations, conversationTitle } from '@/lib/data/messaging';
import { ROUTES } from '@/lib/constants';
import { PageHeader, EmptyState, Badge, Notice } from '@/components/ui';
import { Icon } from '@/components/ui/icons';
import { NewConversation } from '@/components/chat/NewConversation';
import { truncate, relativeTime } from '@/lib/utils';

export const metadata = { title: 'Messages' };

/**
 * Messages (spec §21).
 *
 * One inbox for every conversation kind: direct messages, community chats and
 * study groups. Sellers, organizers and project creators are all reached through
 * this same DM system — there is no separate "contact" channel anywhere.
 */
export default async function ChatPage() {
  const user = await requireUser();
  const supabase = await getServerClient();
  const actor = toActor(user);
  const { conversations, unavailable } = await listConversations(supabase, user.profile.id);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Messages"
        description="Direct messages, community chats and study groups."
        action={
          <Link href={ROUTES.random} className="text-2xs text-muted underline hover:text-ink">
            Try Random
          </Link>
        }
      />

      <NewConversation canMessage={can(actor, 'send_messages')} />

      {unavailable ? (
        <Notice tone="warning" icon="flag">
          Messages could not be loaded right now. Refresh to try again.
        </Notice>
      ) : null}

      {!unavailable && conversations.length === 0 ? (
        <EmptyState
          icon="chat"
          title="No conversations yet"
          description="Start one from any profile, or message a seller from the marketplace. Everyone uses the same inbox."
        />
      ) : null}

      {conversations.length ? (
        <ul className="card divide-y divide-[#E5E5E5]">
          {conversations.map((conversation) => {
            const title = conversationTitle(conversation, conversation.other, conversation.members);
            const last = conversation.lastMessage;
            const mine = last && last.sender_id === user.profile.id;
            return (
              <li key={conversation.id}>
                <Link
                  href={ROUTES.conversation(conversation.id)}
                  className="flex items-start gap-3 p-3 hover:bg-canvas hover:no-underline"
                >
                  <span className="mt-0.5 shrink-0 text-muted">
                    <Icon name={conversation.kind === 'direct' ? 'chat' : 'users'} size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-[0.875rem] font-medium">{title}</span>
                      {conversation.kind !== 'direct' ? <Badge>Community chat</Badge> : null}
                      {conversation.is_muted ? <Badge>Muted</Badge> : null}
                      {conversation.unread > 0 ? (
                        <Badge tone="accent">{conversation.unreadSaturated ? '30+' : conversation.unread}</Badge>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block truncate text-[0.8125rem] text-muted">
                      {last
                        ? `${mine ? 'You: ' : ''}${truncate(last.body || 'GIF', 90)}`
                        : 'No messages yet'}
                    </span>
                    <span className="mt-0.5 block text-2xs text-muted">
                      {last ? relativeTime(last.created_at) : relativeTime(conversation.created_at)}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
