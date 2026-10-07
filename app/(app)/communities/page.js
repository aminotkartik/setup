import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import { listCommunities } from '@/lib/data/campus';
import { ROUTES } from '@/lib/constants';
import { Badge, Button, Card, EmptyState, LinkButton, Notice, PageHeader, SectionHeader, TiltCard } from '@/components/ui';
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

  const featured =
    !q && items.length > 1
      ? items.slice().sort((a, b) => (b.member_count || 0) - (a.member_count || 0))[0]
      : null;

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
              aria-current={tab === item.key ? 'page' : undefined}
              className={`chip ${tab === item.key ? 'border-accent/40 bg-accent-soft text-accent-ink' : 'border-line bg-surface text-muted hover:text-ink'}`}
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
          <label className="flex flex-1 flex-col gap-1.5">
            <span className="field-label">Search</span>
            <input name="q" defaultValue={q || ''} maxLength={60} placeholder="Search by name" className="control control-input h-9" />
          </label>
          <Button type="submit" size="sm" variant="secondary" icon="search">
            Search
          </Button>
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

      {featured ? (
        <section aria-label="Most members" className="flex flex-col gap-2">
          <SectionHeader title="Biggest right now" description="The community with the most members on Campus+ today." />
          <TiltCard>
            <div className="glass glass-sheen card-glass flex flex-wrap items-center justify-between gap-4 p-5">
              <div className="min-w-0">
                <p className="t-label">{featured.kind === 'club' ? 'Club' : featured.kind === 'study_group' ? 'Study group' : 'Community'}</p>
                <h3 className="t-section mt-1">{featured.name}</h3>
                {featured.description ? (
                  <p className="t-secondary mt-1.5 max-w-xl">{featured.description}</p>
                ) : null}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Badge tone="accent">{featured.member_count} members</Badge>
                  {featured.subject ? <Badge>{featured.subject}</Badge> : null}
                  {featured.is_official ? <Badge tone="info">Official</Badge> : null}
                </div>
              </div>
              <LinkButton href={ROUTES.community(featured.slug)} variant="sheen" icon="arrowUpRight">
                Open
              </LinkButton>
            </div>
          </TiltCard>
        </section>
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
