import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import { countClubsByCategory, listCommunities } from '@/lib/data/campus';
import { ROUTES, CLUB_CATEGORIES, CLUB_SORTS } from '@/lib/constants';
import { Button, EmptyState, LinkButton, Notice, PageHeader, SectionHeader } from '@/components/ui';
import { Icon } from '@/components/ui/icons';
import { ClubCard } from '@/components/clubs/ClubCard';

export const metadata = { title: 'Clubs' };

/**
 * Clubs — the dedicated discovery surface.
 *
 * Clubs are still `communities` rows with kind = 'club' (same membership, join
 * requests, chat and posts), but they are no longer mixed into the Communities
 * hub: this page answers "what can I join?", filters by the six campus
 * categories, and shows the monogram, members and recruiting state.
 */
export default async function ClubsPage({ searchParams }) {
  const user = await requireUser();
  const supabase = await getServerClient();
  const actor = toActor(user);
  const params = await searchParams;

  const q = typeof params?.q === 'string' && params.q.trim().length >= 2 ? params.q.trim() : null;
  const category = CLUB_CATEGORIES.some((entry) => entry.value === params?.category) ? params.category : null;
  const sort = CLUB_SORTS.some((entry) => entry.value === params?.sort) ? params.sort : 'members';

  const [{ items, unavailable }, counts, memberships] = await Promise.all([
    listCommunities(supabase, { kind: 'club', q, category, order: sort, limit: 60 }),
    countClubsByCategory(supabase),
    supabase
      .from('community_members')
      .select('community_id')
      .eq('user_id', user.profile.id)
      .eq('status', 'active')
      .limit(300),
  ]);

  const joined = new Set((memberships.data || []).map((row) => row.community_id));
  const canCreate = can(actor, 'manage_clubs');
  const hasFilters = Boolean(q || category || sort !== 'members');

  const hrefWith = (overrides) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries({ q, category, sort, ...overrides })) {
      if (!value) continue;
      if (key === 'sort' && value === 'members') continue;
      search.set(key, String(value));
    }
    const query = search.toString();
    return query ? `${ROUTES.clubs}?${query}` : ROUTES.clubs;
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Clubs"
        eyebrow="Campus life"
        description="Technical, cultural, sports, arts, entrepreneurship and social clubs — join one, follow its events, or reach its team."
        action={
          canCreate ? (
            <LinkButton href={ROUTES.clubNew} icon="plus" tone="accent">
              Create Club
            </LinkButton>
          ) : null
        }
      />

      <section aria-label="Club categories" className="card flex flex-col gap-3 p-3">
        <nav className="flex flex-wrap gap-1.5">
          <Link href={hrefWith({ category: null })} className="chip" data-active={!category}>
            <Icon name="star" size={12} />
            All clubs
            <span className="text-muted-soft">{counts.total}</span>
          </Link>
          {CLUB_CATEGORIES.map((entry) => (
            <Link
              key={entry.value}
              href={hrefWith({ category: entry.value })}
              className="chip"
              data-active={category === entry.value}
            >
              <Icon name={entry.icon} size={12} />
              {entry.label}
              {counts.counts[entry.value] ? <span className="text-muted-soft">{counts.counts[entry.value]}</span> : null}
            </Link>
          ))}
        </nav>

        <form method="get" action={ROUTES.clubs} className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
          {category ? <input type="hidden" name="category" value={category} /> : null}
          <label className="flex min-w-[14rem] flex-1 flex-col gap-1.5">
            <span className="field-label">Search by name or interest</span>
            <span className="relative">
              <Icon name="search" size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-soft" />
              <input
                name="q"
                defaultValue={q || ''}
                maxLength={60}
                placeholder="Robotics, dance, football, debate…"
                className="control control-input h-9 pl-8"
              />
            </span>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="field-label">Sort</span>
            <select name="sort" defaultValue={sort} className="control control-select h-9 w-40 py-0">
              {CLUB_SORTS.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" size="sm" variant="secondary" icon="search">
            Search
          </Button>
          {hasFilters ? (
            <Link href={ROUTES.clubs} className="pb-1.5 text-2xs text-muted underline hover:text-ink">
              Clear
            </Link>
          ) : null}
        </form>
      </section>

      {unavailable ? (
        <Notice tone="warning" icon="flag">
          Clubs could not be loaded right now. Try again in a moment.
        </Notice>
      ) : null}

      <SectionHeader
        title={category ? `${category} clubs` : q ? `Clubs matching “${q}”` : 'All clubs'}
        description={`${items.length} club${items.length === 1 ? '' : 's'} listed.`}
      />

      {!unavailable && !items.length ? (
        <EmptyState
          icon="star"
          title={hasFilters ? 'No clubs match that search' : 'No clubs yet'}
          description={
            hasFilters
              ? 'Try another category, or search by the club’s subject.'
              : canCreate
                ? 'Create the first club page — it gets a feed, members and events.'
                : 'Club pages appear here once the campus team publishes them.'
          }
          action={
            canCreate ? (
              <LinkButton href={ROUTES.clubNew} size="sm" tone="accent" icon="plus">
                Create Club
              </LinkButton>
            ) : null
          }
        />
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((club) => (
          <ClubCard key={club.id} club={club} joined={joined.has(club.id)} />
        ))}
      </div>

      <p className="text-center text-2xs text-muted">
        Clubs run their own feed, members and events. Creation is handled by the campus team — ask an admin if your
        club is missing.
      </p>
    </div>
  );
}
