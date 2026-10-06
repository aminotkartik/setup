import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import { listListings, listGigs, listDeals, listCategories, getMarketSummary } from '@/lib/data/marketplace';
import { ROUTES } from '@/lib/constants';
import { PageHeader, EmptyState, LinkButton, Notice, Card } from '@/components/ui';
import { ContentCard } from '@/components/content/ContentCard';
import { formatPrice, formatDate } from '@/lib/utils';

export const metadata = { title: 'Market' };

const TABS = [
  { key: 'all', label: 'Everything' },
  { key: 'free', label: 'Free stuff' },
  { key: 'gigs', label: 'Gigs' },
  { key: 'deals', label: 'Campus deals' },
];

/**
 * Marketplace (spec §17–§20).
 *
 * Listings, free items, gigs and official campus deals in one place — the same
 * infrastructure, different intent. Prices and conditions are the only numbers
 * shown; there are no view counts or "trending" badges.
 */
export default async function MarketPage({ searchParams }) {
  const user = await requireUser();
  const supabase = await getServerClient();
  const actor = toActor(user);

  const params = await searchParams;
  const tab = TABS.some((item) => item.key === params?.tab) ? params.tab : 'all';
  const q = typeof params?.q === 'string' && params.q.trim().length >= 2 ? params.q.trim() : null;
  const categoryId = typeof params?.category === 'string' && params.category ? params.category : null;

  const [categories, summary] = await Promise.all([listCategories(supabase), getMarketSummary(supabase)]);

  const listings =
    tab === 'gigs' || tab === 'deals'
      ? { items: [], unavailable: false }
      : await listListings(supabase, { free: tab === 'free' ? true : null, categoryId, q, limit: 24 });
  const gigs = tab === 'gigs' ? await listGigs(supabase, { q, limit: 24 }) : { items: [], unavailable: false };
  const deals = tab === 'deals' ? await listDeals(supabase, { limit: 24 }) : { items: [], unavailable: false };

  const canSell = can(actor, 'create_marketplace_listing');
  const canGig = can(actor, 'create_gigs');

  const sellers = await (async () => {
    const ids = [...new Set(listings.items.map((listing) => listing.seller_id))];
    if (!ids.length) return new Map();
    const { data } = await supabase.from('public_profiles').select('id, username, display_name, is_staff').in('id', ids);
    return new Map((data || []).map((person) => [person.id, person]));
  })();

  const gigCreators = await (async () => {
    const ids = [...new Set(gigs.items.map((gig) => gig.creator_id))];
    if (!ids.length) return new Map();
    const { data } = await supabase.from('public_profiles').select('id, username, display_name').in('id', ids);
    return new Map((data || []).map((person) => [person.id, person]));
  })();

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Market"
        description="Buy, sell, give away and hire — text first, meet on campus."
        action={
          <div className="flex items-center gap-2">
            {canGig ? <LinkButton href="/market/new?type=gig" size="sm" variant="secondary">Post a gig</LinkButton> : null}
            {canSell ? <LinkButton href="/market/new" size="sm" icon="plus">Sell something</LinkButton> : null}
          </div>
        }
      />

      <Card className="p-3">
        <nav aria-label="Market sections" className="flex flex-wrap gap-1.5">
          {TABS.map((item) => (
            <Link
              key={item.key}
              href={item.key === 'all' ? ROUTES.market : `${ROUTES.market}?tab=${item.key}`}
              className={`rounded-full border px-3 py-1 text-2xs ${
                tab === item.key ? 'border-accent/40 bg-accent-soft text-ink' : 'border-line bg-white text-muted hover:text-ink'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <p className="mt-2 text-2xs text-muted">
          {summary.active} available · {summary.free} free · {summary.gigs} gigs · {summary.sold} completed
        </p>
      </Card>

      <form method="get" action={ROUTES.market} className="card flex flex-wrap items-end gap-2 p-3">
        <input type="hidden" name="tab" value={tab} />
        <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-2xs text-muted">
          Search
          <input
            name="q"
            defaultValue={q || ''}
            maxLength={80}
            placeholder="Search listings and gigs"
            className="rounded-lg border border-line bg-white px-2 py-1.5 text-[0.8125rem] text-ink"
          />
        </label>
        <label className="flex flex-col gap-1 text-2xs text-muted">
          Category
          <select
            name="category"
            defaultValue={categoryId || ''}
            className="rounded-lg border border-line bg-white px-2 py-1.5 text-[0.8125rem] text-ink"
          >
            <option value="">All</option>
            {categories
              .filter((category) => category.scope === 'marketplace')
              .map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
          </select>
        </label>
        <button type="submit" className="h-9 rounded-lg border border-line bg-white px-3 text-[0.8125rem] hover:bg-canvas">
          Apply
        </button>
      </form>

      {listings.unavailable || gigs.unavailable || deals.unavailable ? (
        <Notice tone="warning" icon="flag">
          Part of the marketplace could not be loaded. Refresh to try again.
        </Notice>
      ) : null}

      {!listings.unavailable && listings.items.length ? (
        <section aria-label="Listings" className="flex flex-col gap-3">
          {listings.items.map((listing) => {
            const seller = sellers.get(listing.seller_id);
            return (
              <ContentCard
                key={listing.id}
                href={ROUTES.listing(listing.id)}
                title={listing.title}
                description={listing.description}
                icon="tag"
                timestamp={listing.created_at}
                badges={[
                  { label: listing.is_free ? 'Free' : formatPrice(listing.price), tone: 'accent' },
                  ...(listing.condition && listing.condition !== 'not_applicable'
                    ? [{ label: listing.condition.replace(/_/g, ' ') }]
                    : []),
                  ...(listing.status === 'reserved' ? [{ label: 'Reserved', tone: 'warning' }] : []),
                ]}
                meta={[
                  seller ? `@${seller.username}` : null,
                  listing.location || null,
                ]}
              />
            );
          })}
        </section>
      ) : null}

      {tab === 'gigs' && gigs.items.length ? (
        <section aria-label="Gigs" className="flex flex-col gap-3">
          {gigs.items.map((gig) => {
            const creator = gigCreators.get(gig.creator_id);
            return (
              <ContentCard
                key={gig.id}
                href={ROUTES.gig(gig.id)}
                title={gig.title}
                description={gig.description}
                icon="briefcase"
                timestamp={gig.created_at}
                badges={[
                  { label: 'Gig' },
                  ...(gig.compensation ? [{ label: gig.compensation }] : []),
                ]}
                meta={[creator ? `@${creator.username}` : null, gig.category, gig.availability]}
              />
            );
          })}
        </section>
      ) : null}

      {tab === 'deals' && deals.items.length ? (
        <section aria-label="Campus deals" className="flex flex-col gap-3">
          {deals.items.map((deal) => (
            <ContentCard
              key={deal.id}
              title={deal.title}
              description={deal.description}
              icon="star"
              official={deal.is_official}
              badges={[
                ...(deal.discount_details ? [{ label: deal.discount_details, tone: 'accent' }] : []),
                ...(deal.valid_until ? [{ label: `Until ${formatDate(deal.valid_until)}` }] : []),
              ]}
              meta={[deal.merchant, deal.contact_info]}
            />
          ))}
        </section>
      ) : null}

      {!listings.unavailable && !gigs.unavailable && !deals.unavailable && !listings.items.length && !gigs.items.length && !deals.items.length ? (
        <EmptyState
          icon="tag"
          title={q ? 'Nothing matched that search' : 'The marketplace is empty'}
          description={
            canSell
              ? 'Nothing has been listed yet. Sell something or give something away — text and a price, that is all it takes.'
              : 'Nothing has been listed yet.'
          }
          action={canSell ? <LinkButton href="/market/new" variant="primary" size="sm">Create the first listing</LinkButton> : null}
        />
      ) : null}

      <p className="pb-2 text-center text-2xs text-muted">
        Listings are text only — no photos, no file uploads, no payments. Meet on campus and settle directly.
      </p>
    </div>
  );
}
