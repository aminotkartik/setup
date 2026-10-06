import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import { listCommunities } from '@/lib/data/campus';
import { ROUTES } from '@/lib/constants';
import { PageHeader, EmptyState, LinkButton, Notice, Card } from '@/components/ui';
import { ContentCard } from '@/components/content/ContentCard';

export const metadata = { title: 'Communities' };

const TABS = [
  { key: 'all', label: 'All', kinds: ['community', 'study_group', 'club'] },
  { key: 'communities', label: 'Communities', kinds: ['community'] },
  { key: 'study_groups', label: 'Study groups', kinds: ['study_group'] },
  { key: 'clubs', label: 'Clubs', kinds: ['club'] },
];

/**
 * Communities hub (spec §26, §28, §33).
 *
 * Communities, study groups and clubs share one infrastructure: same table,
 * same membership rules, same chat, same moderation. Study groups are simply
 * communities with a subject; clubs are communities that officials own.
 */
export default async function CommunitiesPage({ searchParams }) {
  const user = await requireUser();
  const supabase = await getServerClient();
  const actor = toActor(user);

  const params = await searchParams;
  const tab = TABS.some((item) => item.key === params?.tab) ? params.tab : 'all';
  const q = typeof params?.q === 'string' && params.q.trim().length >= 2 ? params.q.trim() : null;
  const kinds = TABS.find((item) => item.key === tab)?.kinds || null;

  const { items, unavailable } = await listCommunities(supabase, { kind: kinds, q, limit: 30 });
  const canCreate = can(actor, 'create_communities');

  const counts = await (async () => {
    const [communities, studyGroups, clubs] = await Promise.all([
      supabase.from('communities').select('id', { count: 'exact', head: true }).eq('kind', 'community').eq('status', 'published'),
      supabase.from('communities').select('id', { count: 'exact', head: true }).eq('kind', 'study_group').eq('status', 'published'),
      supabase.from('communities').select('id', { count: 'exact', head: true }).eq('kind', 'club').eq('status', 'published'),
    ]);
    return {
      communities: communities.count ?? 0,
      studyGroups: studyGroups.count ?? 0,
      clubs: clubs.count ?? 0,
    };
  })();

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Communities"
        description="Communities, study groups and clubs — all built on the same membership and chat."
        action={
          canCreate ? (
            <LinkButton href="/communities/new" size="sm" icon="plus">
              Create
            </LinkButton>
          ) : null
        }
      />

      <Card className="p-3">
        <nav aria-label="Community kinds" className="flex flex-wrap gap-1.5">
          {TABS.map((item) => (
            <Link
              key={item.key}
              href={item.key === 'all' ? ROUTES.communities : `${ROUTES.communities}?tab=${item.key}`}
              className={`rounded-full border px-3 py-1 text-2xs ${
                tab === item.key ? 'border-accent/40 bg-accent-soft text-ink' : 'border-line bg-white text-muted hover:text-ink'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <p className="mt-2 text-2xs text-muted">
          {counts.communities} communities · {counts.studyGroups} study groups · {counts.clubs} clubs
        </p>
        <form method="get" action={ROUTES.communities} className="mt-2 flex items-end gap-2">
          <input type="hidden" name="tab" value={tab} />
          <label className="flex flex-1 flex-col gap-1 text-2xs text-muted">
            Search
            <input
              name="q"
              defaultValue={q || ''}
              maxLength={60}
              placeholder="Search by name"
              className="rounded-lg border border-line bg-white px-2 py-1.5 text-[0.8125rem] text-ink"
            />
          </label>
          <button type="submit" className="h-9 rounded-lg border border-line bg-white px-3 text-[0.8125rem] hover:bg-canvas">
            Search
          </button>
        </form>
      </Card>

      {unavailable ? (
        <Notice tone="warning" icon="flag">
          Communities could not be loaded right now. Refresh to try again.
        </Notice>
      ) : null}

      {!unavailable && !items.length ? (
        <EmptyState
          icon="users"
          title={q ? 'Nothing matched that search' : 'No communities yet'}
          description={
            canCreate
              ? 'Start one for your branch, your batch, your club or a subject you are all struggling with.'
              : 'Communities will appear here once students create them.'
          }
          action={canCreate ? <LinkButton href="/communities/new" variant="primary" size="sm">Create a community</LinkButton> : null}
        />
      ) : null}

      <section aria-label="Communities" className="flex flex-col gap-3">
        {items.map((community) => (
          <ContentCard
            key={community.id}
            href={ROUTES.community(community.slug)}
            title={community.name}
            description={community.description}
            icon={community.kind === 'study_group' ? 'book' : community.kind === 'club' ? 'star' : 'users'}
            official={community.is_official}
            community={!community.is_official}
            badges={[
              { label: community.kind === 'study_group' ? 'Study group' : community.kind === 'club' ? 'Club' : 'Community' },
              ...(community.subject ? [{ label: community.subject }] : []),
              ...(community.join_policy !== 'open' ? [{ label: 'Request to join', tone: 'warning' }] : []),
            ]}
            meta={[
              `${community.member_count} member${community.member_count === 1 ? '' : 's'}`,
              `${community.post_count} post${community.post_count === 1 ? '' : 's'}`,
              community.visibility === 'campus' ? 'PCCOE only' : community.visibility,
            ]}
          />
        ))}
      </section>
    </div>
  );
}
