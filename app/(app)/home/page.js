import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import { ROUTES } from '@/lib/constants';
import { getCampusFeed, hydratePosts } from '@/lib/data/feed';
import { PageHeader, EmptyState, LinkButton, Badge, Notice } from '@/components/ui';
import { Icon } from '@/components/ui/icons';
import { PostComposer } from '@/components/posts/PostComposer';
import { PostCard } from '@/components/posts/PostCard';
import { SearchEntry } from '@/components/search/SearchEntry';
import { formatDate, formatTime } from '@/lib/utils';

export const metadata = { title: 'Home' };

/**
 * Home (spec §11).
 *
 * Reads the unified campus feed plus the next few official events. Nothing is
 * invented: an empty database produces empty states, not placeholder content.
 */
export default async function HomePage() {
  const user = await requireUser();
  const supabase = await getServerClient();
  const actor = toActor(user);
  const me = user.profile.id;

  const canPost = can(actor, 'create_posts');

  const [{ items: feed, unavailable }, { data: events }, { data: pinnedNotices }] = await Promise.all([
    getCampusFeed(supabase, { limit: 20 }),
    supabase
      .from('events')
      .select('id, title, starts_on, start_time, location, is_official, organizer')
      .eq('status', 'published')
      .gte('starts_on', new Date().toISOString().slice(0, 10))
      .order('starts_on', { ascending: true })
      .limit(3),
    supabase
      .from('notices')
      .select('id, title, category, importance, published_at')
      .eq('status', 'published')
      .order('pinned', { ascending: false })
      .order('published_at', { ascending: false })
      .limit(2),
  ]);

  const feedPosts = feed.filter((item) => ['post', 'discussion', 'poll'].includes(item.type)).map((item) => item.post).filter(Boolean);
  const hydrated = await hydratePosts(supabase, feedPosts, { currentProfileId: me });
  const postById = new Map(hydrated.map((post) => [post.id, post]));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Home"
        description={`What's happening on campus${user.profile.branch && user.profile.show_branch_year ? ` · ${user.profile.branch}` : ''}`}
        action={<LinkButton href={ROUTES.explore} size="sm" icon="search">Explore</LinkButton>}
      />

      <SearchEntry />

      {canPost ? (
        <PostComposer />
      ) : (
        <Notice tone="neutral" icon="lock">
          Your account cannot publish posts right now.
        </Notice>
      )}

      {pinnedNotices?.length ? (
        <section aria-label="Notices" className="card divide-y divide-[#E5E5E5]">
          {pinnedNotices.map((notice) => (
            <Link key={notice.id} href={ROUTES.notice(notice.id)} className="flex items-start gap-3 p-3 hover:bg-canvas hover:no-underline">
              <Icon name="megaphone" size={16} className="mt-0.5 shrink-0 text-muted" />
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-[0.875rem] font-medium">{notice.title}</span>
                  <Badge tone={notice.importance === 'critical' || notice.importance === 'high' ? 'accent' : 'neutral'}>
                    {notice.category}
                  </Badge>
                </span>
                <span className="mt-0.5 block text-2xs text-muted">{formatDate(notice.published_at)}</span>
              </span>
            </Link>
          ))}
        </section>
      ) : null}

      {unavailable ? (
        <Notice tone="warning" icon="flag">
          The feed is temporarily unavailable. Refresh to try again.
        </Notice>
      ) : null}

      <section aria-label="Campus feed" className="flex flex-col gap-3">
        {feed.length === 0 && !unavailable ? (
          <EmptyState
            icon="sparkle"
            title="Nothing on the feed yet"
            description="When students post, discuss or share official updates, they appear here. Be the first."
          />
        ) : null}

        {feed.map((item) => {
          if (item.type === 'listing') {
            return (
              <Link
                key={`listing-${item.id}`}
                href={ROUTES.listing(item.id)}
                className="card flex items-start gap-3 p-4 hover:no-underline"
              >
                <Icon name="tag" size={16} className="mt-0.5 shrink-0 text-muted" />
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[0.9375rem] font-medium">{item.title}</span>
                    <Badge>Marketplace</Badge>
                  </span>
                  <span className="mt-1 block text-[0.8125rem] text-muted">
                    {item.meta?.is_free ? 'Free' : item.meta?.price != null ? `₹${item.meta.price}` : ''} · by @{item.authorUsername}
                  </span>
                </span>
              </Link>
            );
          }

          if (['notice', 'event', 'deal', 'opportunity', 'resource', 'project'].includes(item.type)) {
            const href =
              item.type === 'notice'
                ? ROUTES.notice(item.id)
                : item.type === 'event'
                  ? ROUTES.event(item.id)
                  : item.type === 'opportunity'
                    ? ROUTES.opportunity(item.id)
                    : item.type === 'resource'
                      ? ROUTES.resource(item.id)
                      : item.type === 'project'
                        ? ROUTES.project(item.id)
                        : ROUTES.campus;
            return (
              <Link key={`${item.type}-${item.id}`} href={href} className="card flex items-start gap-3 p-4 hover:no-underline">
                <Icon
                  name={item.type === 'event' ? 'calendar' : item.type === 'notice' ? 'megaphone' : 'briefcase'}
                  size={16}
                  className="mt-0.5 shrink-0 text-muted"
                />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-[0.9375rem] font-medium">{item.title}</span>
                    {item.isOfficial ? <Badge tone="accent">Official</Badge> : null}
                    <Badge>{item.type}</Badge>
                  </span>
                  {item.body ? <span className="mt-1 block text-[0.8125rem] text-muted">{item.body.slice(0, 180)}</span> : null}
                </span>
              </Link>
            );
          }

          const post = postById.get(item.id) || item.post;
          if (!post) return null;
          return (
            <PostCard
              key={post.id}
              post={post}
              currentUserId={me}
              canModerate={can(actor, 'remove_posts')}
              reactions={{ count: post.reaction_count || 0, mine: Boolean(post.reacted_by_me) }}
              poll={post.poll}
            />
          );
        })}
      </section>

      <section aria-label="Upcoming events" className="card p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Upcoming events</h2>
          <Link href="/campus/events" className="text-2xs text-muted hover:text-ink">
            All events
          </Link>
        </div>
        {events?.length ? (
          <ul className="mt-3 divide-y divide-[#E5E5E5]">
            {events.map((event) => (
              <li key={event.id}>
                <Link href={ROUTES.event(event.id)} className="flex items-start gap-3 py-2.5 hover:no-underline">
                  <span className="flex w-12 shrink-0 flex-col items-center rounded-md border border-line py-1">
                    <span className="text-2xs uppercase text-muted">
                      {new Date(event.starts_on).toLocaleDateString('en-IN', { month: 'short' })}
                    </span>
                    <span className="text-sm font-semibold leading-none">{new Date(event.starts_on).getDate()}</span>
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[0.875rem] font-medium">{event.title}</span>
                      {event.is_official ? <Badge tone="accent">Official</Badge> : null}
                    </span>
                    <span className="mt-0.5 block text-2xs text-muted">
                      {formatTime(event.start_time)}{event.location ? ` · ${event.location}` : ''}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-[0.8125rem] text-muted">No upcoming events.</p>
        )}
      </section>

      <p className="pb-2 text-center text-2xs text-muted">
        Feed order is deterministic and configured in the database — Campus+ has no algorithmic
        ranking and no AI.
      </p>
    </div>
  );
}
