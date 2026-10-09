import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import { ROUTES } from '@/lib/constants';
import { PageHeader, Card, EmptyState, LinkButton, SectionHeader } from '@/components/ui';
import { Icon } from '@/components/ui/icons';
import { SearchResults } from '@/components/search/SearchResults';
import { PostCard } from '@/components/posts/PostCard';
import { hydratePosts } from '@/lib/data/feed';
import { compactNumber } from '@/lib/utils';

export const metadata = { title: 'Explore' };

/**
 * Explore (spec §16, §17).
 *
 * One page, two modes:
 *   ?q=…   → unified search results (server-side `global_search()`)
 *   no q   → campus discovery: trending, communities, clubs, resources,
 *            opportunities, projects, lost & found, discussions
 *
 * Only modules whose feature flag is on are rendered, and every section uses
 * the real tables — an empty database shows "nothing yet", never filler.
 */
export default async function ExplorePage({ searchParams }) {
  const user = await requireUser();
  const params = await searchParams;
  const query = typeof params?.q === 'string' ? params.q.slice(0, 80) : '';
  const scope = typeof params?.scope === 'string' ? params.scope : 'all';

  if (query.trim().length >= 2) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Explore" description={`Results for “${query}”`} />
        <SearchResults initialQuery={query} initialScope={scope} />
      </div>
    );
  }

  const supabase = await getServerClient();
  const actor = toActor(user);

  // Trending and discussion hydration are independent of the module queries, so
  // they join the same fan-out instead of waiting for it (they used to run
  // strictly after the whole batch, adding two serial round trips).
  const discussionQuery = supabase
    .from('posts')
    .select('id, author_id, kind, title, body, gif, community_id, visibility, status, is_official, comment_count, reaction_count, created_at')
    .eq('kind', 'discussion')
    .eq('status', 'published')
    .order('created_at', { ascending: false })
    .limit(4);

  const [
    { data: communities },
    { data: clubs },
    { data: resources },
    { data: opportunities },
    { data: projects },
    { data: lostFound },
    { data: trending },
    hydratedDiscussions,
  ] = await Promise.all([
    supabase.from('communities').select('id, name, slug, description, member_count, kind, is_official').eq('status', 'published').eq('kind', 'community').order('member_count', { ascending: false }).limit(5),
    supabase.from('communities').select('id, name, slug, description, member_count, is_official').eq('status', 'published').eq('kind', 'club').order('member_count', { ascending: false }).limit(5),
    supabase.from('official_resources').select('id, title, subject, semester, type, is_official, url').eq('status', 'published').order('created_at', { ascending: false }).limit(5),
    supabase.from('opportunities').select('id, title, organization, deadline, source, mode').eq('status', 'published').order('created_at', { ascending: false }).limit(5),
    supabase.from('projects').select('id, title, technologies, reaction_count').eq('status', 'published').order('created_at', { ascending: false }).limit(5),
    supabase.from('lost_found').select('id, title, kind, location, occurred_on').eq('status', 'published').order('created_at', { ascending: false }).limit(5),
    supabase.rpc('trending_posts', { p_limit: 5, p_hours: 72 }),
    (async () => {
      const { data: discussions } = await discussionQuery;
      return hydratePosts(supabase, discussions || [], { currentProfileId: user.profile.id });
    })(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Explore" description="Search, trending, and the modules you might not have opened yet." />
      <SearchResults initialQuery="" initialScope="all" />

      <section aria-label="Trending" className="flex flex-col gap-3">
        <SectionHeader
          title="Trending now"
          description="Deterministic score from reactions, comments and participants — no algorithm, no AI."
        />
        {trending?.length ? (
          <ul className="card divide-y divide-line">
            {trending.map((item) => (
              <li key={item.id}>
                <Link href={ROUTES.post(item.id)} className="flex items-start gap-3 p-3 hover:bg-canvas hover:no-underline">
                  <Icon name="sparkle" size={16} className="mt-0.5 shrink-0 text-muted" />
                  <span className="min-w-0">
                    <span className="block truncate text-[0.875rem] font-medium">
                      {item.title || (item.body ? `${item.body.slice(0, 90)}…` : 'Post')}
                    </span>
                    <span className="mt-0.5 block text-2xs text-muted">
                      @{item.username} · {compactNumber(item.reaction_count)} reactions · {compactNumber(item.comment_count)} comments
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon="sparkle"
            title="No trending posts yet"
            description="Trending is computed from real reactions and comments in the last 72 hours."
          />
        )}
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        <ModuleCard
          title="Communities"
          href={ROUTES.communities}
          icon="users"
          count={communities?.length ? `${communities.length} to browse` : null}
          items={communities?.map((item) => ({ id: item.id, label: item.name, href: ROUTES.community(item.slug), meta: `${compactNumber(item.member_count)} members` }))}
          empty="No communities yet."
        />
        <ModuleCard
          title="Clubs"
          href="/campus/clubs"
          icon="building"
          items={clubs?.map((item) => ({ id: item.id, label: item.name, href: ROUTES.club(item.id), meta: `${compactNumber(item.member_count)} members` }))}
          empty="No clubs listed yet."
        />
        <ModuleCard
          title="Resources"
          href="/explore/resources"
          icon="book"
          items={resources?.map((item) => ({ id: item.id, label: item.title, href: ROUTES.resource(item.id), meta: item.subject || item.type }))}
          empty="No resources shared yet."
        />
        <ModuleCard
          title="Opportunities"
          href="/explore/opportunities"
          icon="briefcase"
          items={opportunities?.map((item) => ({ id: item.id, label: item.title, href: ROUTES.opportunity(item.id), meta: item.organization }))}
          empty="No opportunities posted yet."
        />
        <ModuleCard
          title="Projects"
          href="/explore/projects"
          icon="sparkle"
          items={projects?.map((item) => ({ id: item.id, label: item.title, href: ROUTES.project(item.id), meta: item.technologies }))}
          empty="No projects in the showcase yet."
        />
        <ModuleCard
          title="Lost & found"
          href="/campus/lost-found"
          icon="search"
          items={lostFound?.map((item) => ({ id: item.id, label: item.title, href: `/campus/lost-found/${item.id}`, meta: `${item.kind === 'lost' ? 'Lost' : 'Found'} · ${item.location || 'location not given'}` }))}
          empty="Nothing lost or found right now."
        />
      </div>

      <section aria-label="Discussions" className="flex flex-col gap-3">
        <SectionHeader
          title="Discussions"
          description="Questions and answers, in text."
          action={<LinkButton href="/explore?scope=discussions" size="sm" variant="ghost">Search discussions</LinkButton>}
        />
        {hydratedDiscussions.length ? (
          hydratedDiscussions.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              currentUserId={user.profile.id}
              canModerate={can(actor, 'remove_posts')}
              reactions={{ count: post.reaction_count || 0, mine: Boolean(post.reacted_by_me) }}
              poll={post.poll}
            />
          ))
        ) : (
          <EmptyState icon="comment" title="No discussions yet" description="Start one from the Home composer." />
        )}
      </section>

      <section aria-label="Study groups, study partners and team finder">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Card className="p-4">
            <h2 className="text-sm font-semibold">Study groups</h2>
            <p className="mt-1 text-[0.8125rem] text-muted">
              Subject-based groups live in Communities and reuse the same chat and discussion tools.
            </p>
            <Link href="/communities?kind=study_group" className="mt-3 inline-flex items-center gap-1 text-2xs text-ink underline">
              Browse study groups <Icon name="chevronRight" size={13} />
            </Link>
          </Card>
          <Card className="p-4">
            <h2 className="text-sm font-semibold">Study partner finder</h2>
            <p className="mt-1 text-[0.8125rem] text-muted">
              Preparing for an exam or working through a subject? Find peers with matching rough availability.
            </p>
            <Link href={ROUTES.study} className="mt-3 inline-flex items-center gap-1 text-2xs text-ink underline">
              Find a study partner <Icon name="chevronRight" size={13} />
            </Link>
          </Card>
          <Card className="p-4">
            <h2 className="text-sm font-semibold">Team finder</h2>
            <p className="mt-1 text-[0.8125rem] text-muted">
              Looking for teammates for a project or hackathon? Post what you need and students can message you directly.
            </p>
            <Link href="/campus/teams" className="mt-3 inline-flex items-center gap-1 text-2xs text-ink underline">
              Open the board <Icon name="chevronRight" size={13} />
            </Link>
          </Card>
        </div>
      </section>
    </div>
  );
}

function ModuleCard({ title, href, icon, items, empty, count = null }) {
  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Icon name={icon} size={16} className="text-muted" />
          {title}
        </h2>
        <Link href={href} className="text-2xs text-muted hover:text-ink">
          Open
        </Link>
      </div>
      {count ? <p className="mt-1 text-2xs text-muted">{count}</p> : null}
      {items?.length ? (
        <ul className="mt-3 flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.id}>
              <Link href={item.href} className="flex items-baseline justify-between gap-3 hover:no-underline">
                <span className="truncate text-[0.8125rem]">{item.label}</span>
                {item.meta ? <span className="shrink-0 text-2xs text-muted">{String(item.meta).slice(0, 32)}</span> : null}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-[0.8125rem] text-muted">{empty}</p>
      )}
    </Card>
  );
}
