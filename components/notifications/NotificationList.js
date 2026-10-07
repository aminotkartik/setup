'use client';

/**
 * The one notification list (spec §47).
 *
 * Rows carry a deep link, the notification's own text and an unread marker.
 * Marking read and dismissing are server actions; the list is purely the
 * presentation layer and never decides visibility itself.
 */

import { useTransition } from 'react';
import Link from 'next/link';
import { cn, relativeTime } from '@/lib/utils';
import { Button, EmptyState, Notice } from '@/components/ui';
import { Icon } from '@/components/ui/icons';
import { markNotificationRead, clearNotification, markAllNotificationsRead } from '@/lib/actions/notifications';

const LABEL_BY_TYPE = {
  dm_new: 'Direct message',
  mention: 'Mention',
  comment: 'Comment',
  reply: 'Reply',
  reaction: 'Reaction',
  marketplace_message: 'Marketplace message',
  marketplace_status: 'Marketplace update',
  marketplace_rating: 'Rating',
  event_update: 'Event update',
  event_reminder: 'Event reminder',
  community_activity: 'Community',
  club_activity: 'Club',
  moderation_notice: 'Moderation notice',
  report_result: 'Report result',
  system: 'Campus+',
};

const ICON_BY_TYPE = {
  dm_new: 'chat',
  mention: 'at',
  comment: 'comment',
  reply: 'comment',
  reaction: 'heart',
  marketplace_message: 'tag',
  marketplace_status: 'tag',
  marketplace_rating: 'star',
  event_update: 'calendar',
  event_reminder: 'calendar',
  community_activity: 'users',
  club_activity: 'users',
  moderation_notice: 'shield',
  report_result: 'flag',
  system: 'megaphone',
};

export function NotificationList({ items = [], emptyTitle = 'No notifications yet' }) {
  const [pending, startTransition] = useTransition();

  if (!items.length) {
    return (
      <EmptyState
        icon="bell"
        title={emptyTitle}
        description="Replies, mentions, messages and official updates appear here."
      />
    );
  }

  const open = (item) => {
    if (!item.read_at) {
      const data = new FormData();
      data.set('id', item.id);
      startTransition(() => {
        markNotificationRead(data);
      });
    }
  };

  const dismiss = (item) => {
    const data = new FormData();
    data.set('id', item.id);
    startTransition(() => {
      clearNotification(data);
    });
  };

  const markAll = () => {
    startTransition(() => {
      markAllNotificationsRead();
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="text-2xs text-muted">
          {items.filter((item) => !item.read_at).length} unread of {items.length}
        </p>
        <Button variant="ghost" size="sm" onClick={markAll} disabled={pending}>
          Mark all read
        </Button>
      </div>

      <ul className={cn('card divide-y divide-line', pending && 'opacity-70')}>
        {items.map((item) => {
          const body = (
            <span className="flex min-w-0 items-start gap-3 p-3">
              <span className="mt-0.5 shrink-0 text-muted">
                <Icon name={ICON_BY_TYPE[item.type] || 'bell'} size={16} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className={cn('truncate text-[0.875rem]', item.read_at ? 'font-normal' : 'font-medium')}>
                    {item.title}
                  </span>
                  {!item.read_at ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-label="Unread" /> : null}
                </span>
                {item.body ? <span className="mt-0.5 block text-[0.8125rem] text-muted">{item.body}</span> : null}
                <span className="mt-1 block text-2xs text-muted">
                  {LABEL_BY_TYPE[item.type] || 'Campus+'} · {relativeTime(item.created_at)}
                </span>
              </span>
            </span>
          );

          return (
            <li key={item.id} className="flex items-stretch">
              {item.url ? (
                <Link
                  href={item.url}
                  onClick={() => open(item)}
                  className="min-w-0 flex-1 hover:bg-canvas hover:no-underline"
                >
                  {body}
                </Link>
              ) : (
                <button type="button" onClick={() => open(item)} className="min-w-0 flex-1 text-left hover:bg-canvas">
                  {body}
                </button>
              )}
              <button
                type="button"
                onClick={() => dismiss(item)}
                aria-label="Dismiss notification"
                className="px-2 text-muted hover:text-ink"
              >
                <Icon name="close" size={14} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function NotificationError({ message }) {
  return (
    <Notice tone="warning" icon="flag">
      {message || 'Notifications could not be loaded. Refresh to try again.'}
    </Notice>
  );
}
