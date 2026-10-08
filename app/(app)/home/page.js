import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import { ROUTES } from '@/lib/constants';
import { getCampusFeed, hydratePosts } from '@/lib/data/feed';
import { ContentCard } from '@/components/content/ContentCard';
import { Badge, EmptyState, LinkButton, Notice, Rail, RailCard, SectionHeader } from '@/components/ui';
import { Icon } from '@/components/ui/icons';
import { PostComposer } from '@/components/posts/PostComposer';
import { PostCard } from '@/components/posts/PostCard';
import { SearchEntry } from '@/components/search/SearchEntry';
import { ParticleField } from '@/components/atmosphere/ParticleField';
import { HomeReadySignal } from '@/components/layout/HomeLaunchGate';
import { formatDate, formatTime, formatCalendarBadge } from '@/lib/utils';

export const metadata = { title: 'Home' };

/** Modules worth one tap from the feed's contextual rail — real destinations. */
const QUICK_LINKS = [
  { href: '/campus/noticeboard', label: 'Noticeboard', icon: 'megaphone' },
  { href: '/campus/events', label: 'Events', icon: 'calendar' },
  { href: '/campus/lost-found', label: 'Lost & found', icon: 'search' },
  { href: '/explore/resources', label: 'Resources', icon: 'book' },
  { href: '/explore/opportunities', label: 'Opportunities', icon: 'briefcase' },
  { href: '/campus/clubs', label: 'Clubs', icon: 'star' },
];

/**
 * Home.
 *
 * Reads the unified campus feed plus the next few official events. Nothing is
 * invented: an empty database produces empty states, not placeholder content.
 *
 * Layout: a cinematic hero — the subtle blue particle sky behind the greeting,
 * search and the black-label Explore button — then one readable feed column
 * and, on wide screens only, a contextual rail built entirely from data this
 * page already fetched. The atmosphere is exactly that: background, never in
 * the way of reading.
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

  const feedPosts = feed
    .filter((item) => ['post', 'discussion', 'poll'].includes(item.type))
    .map((item) => item.post)
    .filter(Boolean);
  const hydrated = await hydratePosts(supabase, feedPosts, { currentProfileId: me });
  const postById = new Map(hydrated.map((post) => [post.id, post]));

  const trending = hydrated
    .slice()
    .sort((a, b) => (b.reaction_count || 0) + (b.comment_count || 0) - ((a.reaction_count || 0) + (a.comment_count || 0)))
    .slice(0, 3);

  const marketplace = feed.filter((item) => ['listing', 'deal'].includes(item.type)).slice(0, 3);

  const header = (
    <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <p className="t-label mb-1.5">PCCOE · Campus feed</p>
        <h1 className="t-page">
          Good to see you, {(user.profile.display_name || user.profile.username).split(' ')[0]}
        </h1>
        <p className="t-secondary mt-1.5">
          {user.profile.branch && user.profile.show_branch_year
            ? `${user.profile.branch} · everything happening around campus right now`
            : 'Everything happening around campus right now'}
        </p>
      </div>
      {/* The Explore button keeps its own bright sheen — its label is hard
          black on purpose. */}
      <LinkButton href={ROUTES.explore} size="md" variant="sheen" icon="search">
        Explore campus
      </LinkButton>
    </header>
  );

  return (
    <div className="page-grid" data-rail={events?.length || pinnedNotices?.length ? 'true' : undefined}>
      {/* Loading-layer probe (renders nothing): tells the launch intro that
          Home content has committed so it can complete its reveal and fade. */}
      <HomeReadySignal />
      <div className="flex min-w-0 flex-col gap-5">
        {/* Cinematic hero: a subtle particle sky behind the greeting and
            search. Atmospheric only — a canvas layer, no layout weight. */}
        <div className="home-hero cinematic-stage rounded-[var(--radius-xl)]">
          <ParticleField density={0.55} />
          <div className="home-hero__inner login-sky">
            {header}
            <SearchEntry />
          </div>
        </div>

        {canPost ? (
          <PostComposer authorName={user.profile.display_name || user.profile.username} />
        ) : (
          <Notice tone="neutral" icon="lock">
            Your account cannot publish posts right now.
          </Notice>
        )}

        {unavailable ? (
          <Notice tone="warning" icon="flag">
            The feed is temporarily unavailable. Refresh to try again.
          </Notice>
        ) : null}

        <section aria-label="Campus feed" className="flex flex-col gap-3">
          <SectionHeader
            title="Campus feed"
            description="Deterministic order, configured in the database — no ranking, no AI."
          />

          {feed.length === 0 && !unavailable ? (
            <EmptyState
              icon="sparkle"
              title="Nothing on the feed yet"
              description="When students post, discuss or share official updates, they appear here. Be the first."
              action={canPost ? null : undefined}
            />
          ) : null}

          {feed.map((item) => {
            if (item.type === 'listing') {
              const price = item.meta?.is_free ? 'Free' : item.meta?.price != null ? `₹${item.meta.price}` : null;
              return (
                <ContentCard
                  key={`listing-${item.id}`}
                  href={ROUTES.listing(item.id)}
                  icon="tag"
                  title={item.title}
                  badges={[
                    { label: 'Marketplace' },
                    ...(price ? [{ label: price, tone: 'accent' }] : []),
                  ]}
                  meta={[item.authorUsername ? `@${item.authorUsername}` : null]}
                />
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
                <ContentCard
                  key={`${item.type}-${item.id}`}
                  href={href}
                  icon={item.type === 'event' ? 'calendar' : item.type === 'notice' ? 'megaphone' : 'briefcase'}
                  title={item.title}
                  description={item.body}
                  official={item.isOfficial}
                  badges={[{ label: item.type === 'deal' ? 'Campus deal' : item.type }]}
                />
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

        <p className="pb-2 text-center text-2xs text-muted-soft">
          Campus+ has no algorithmic ranking and no AI. Feed order is deterministic and configured in the database.
        </p>
      </div>

      <Rail>
        {events?.length ? (
          <RailCard
            title="Upcoming events"
            icon="calendar"
            action={
              <Link href="/campus/events" className="text-2xs font-semibold text-muted hover:text-ink">
                All
              </Link>
            }
          >
            <ul className="flex flex-col gap-2.5">
              {events.map((event) => {
                const calendar = formatCalendarBadge(event.starts_on);
                return (
                  <li key={event.id}>
                    <Link href={ROUTES.event(event.id)} className="flex items-start gap-2.5 hover:no-underline">
                      <span className="flex w-10 shrink-0 flex-col items-center rounded-[var(--radius-sm)] border border-line bg-surface-2 py-1">
                        <span className="text-[0.5625rem] font-bold uppercase text-muted-soft">{calendar.month}</span>
                        <span className="text-[0.8125rem] font-bold leading-none">{calendar.day}</span>
                      </span>
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-[0.8125rem] font-semibold">{event.title}</span>
                          {event.is_official ? <Badge tone="accent">Official</Badge> : null}
                        </span>
                        <span className="mt-0.5 block text-2xs text-muted-soft">
                          {formatTime(event.start_time)}
                          {event.location ? ` · ${event.location}` : ''}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </RailCard>
        ) : null}

        {pinnedNotices?.length ? (
          <RailCard
            title="Notices"
            icon="megaphone"
            action={
              <Link href="/campus/noticeboard" className="text-2xs font-semibold text-muted hover:text-ink">
                All
              </Link>
            }
          >
            <ul className="divide-y divide-line">
              {pinnedNotices.map((notice) => (
                <li key={notice.id}>
                  <Link href={ROUTES.notice(notice.id)} className="flex flex-col gap-1 py-2 first:pt-0 last:pb-0 hover:no-underline">
                    <span className="text-[0.8125rem] font-medium leading-snug">{notice.title}</span>
                    <span className="flex items-center gap-1.5 text-2xs text-muted-soft">
                      <Badge tone={notice.importance === 'critical' || notice.importance === 'high' ? 'danger' : 'neutral'}>
                        {notice.importance === 'critical' ? 'Critical' : notice.importance === 'high' ? 'Important' : notice.category}
                      </Badge>
                      {formatDate(notice.published_at)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </RailCard>
        ) : null}

        {trending.length ? (
          <RailCard title="Busiest right now" icon="trend">
            <ol className="flex flex-col gap-2">
              {trending.map((post) => (
                <li key={post.id}>
                  <Link href={ROUTES.post(post.id)} className="flex items-start gap-2 hover:no-underline">
                    <span className="mt-0.5 text-2xs font-bold text-muted-soft">{String(trending.indexOf(post) + 1).padStart(2, '0')}</span>
                    <span className="min-w-0">
                      <span className="line-clamp-2 text-[0.8125rem] leading-snug">
                        {post.title || post.body?.slice(0, 90) || 'Post'}
                      </span>
                      <span className="mt-0.5 block text-2xs text-muted-soft">
                        {post.reaction_count || 0} reactions · {post.comment_count || 0} comments
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          </RailCard>
        ) : null}

        {marketplace.length ? (
          <RailCard
            title="Marketplace"
            icon="tag"
            action={
              <Link href={ROUTES.market} className="text-2xs font-semibold text-muted hover:text-ink">
                Open
              </Link>
            }
          >
            <ul className="flex flex-col gap-2">
              {marketplace.map((item) => (
                <li key={`rail-listing-${item.id}`}>
                  <Link href={ROUTES.listing(item.id)} className="flex items-center justify-between gap-2 hover:no-underline">
                    <span className="min-w-0 truncate text-[0.8125rem]">{item.title}</span>
                    <span className="shrink-0 text-2xs font-semibold text-accent-ink">
                      {item.meta?.is_free ? 'Free' : item.meta?.price != null ? `₹${item.meta.price}` : ''}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </RailCard>
        ) : null}

        <RailCard title="Jump to" icon="grid">
          <ul className="grid grid-cols-2 gap-1.5">
            {QUICK_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-line bg-surface px-2.5 py-2 text-2xs font-semibold text-ink-soft transition-colors hover:border-line-strong hover:no-underline"
                >
                  <Icon name={link.icon} size={13} className="text-muted" />
                  <span className="truncate">{link.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </RailCard>
      </Rail>
    </div>
  );
}
