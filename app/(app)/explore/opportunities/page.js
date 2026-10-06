import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import { listOpportunities } from '@/lib/data/campus';
import { ROUTES } from '@/lib/constants';
import { PageHeader, EmptyState, Notice, LinkButton } from '@/components/ui';
import { ContentCard } from '@/components/content/ContentCard';
import { formatDate } from '@/lib/utils';

export const metadata = { title: 'Opportunities' };

/** Internships, competitions and programs (spec §35). Official and community entries are labelled. */
export default async function OpportunitiesPage() {
  const user = await requireUser();
  const supabase = await getServerClient();
  const actor = toActor(user);
  const { items, unavailable } = await listOpportunities(supabase, { limit: 30 });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Opportunities"
        description="Internships, competitions, scholarships and programs."
        back={{ href: ROUTES.explore, label: 'Explore' }}
        action={
          can(actor, 'submit_opportunities') ? (
            <LinkButton href="/explore/opportunities/new" size="sm" icon="plus">
              Submit one
            </LinkButton>
          ) : null
        }
      />

      {unavailable ? <Notice tone="warning" icon="flag">Opportunities could not be loaded right now.</Notice> : null}

      {!unavailable && !items.length ? (
        <EmptyState
          icon="briefcase"
          title="No opportunities yet"
          description="Posted internships and programs appear here, clearly marked as official or community-submitted."
          action={
            can(actor, 'submit_opportunities') ? (
              <LinkButton href="/explore/opportunities/new" variant="primary" size="sm">
                Submit one
              </LinkButton>
            ) : null
          }
        />
      ) : null}

      <section aria-label="Opportunities" className="flex flex-col gap-3">
        {items.map((item) => (
          <ContentCard
            key={item.id}
            href={ROUTES.opportunity(item.id)}
            title={item.title}
            description={item.description}
            icon="briefcase"
            official={item.source === 'official'}
            community={item.source !== 'official'}
            badges={[
              ...(item.mode ? [{ label: item.mode }] : []),
              ...(item.deadline ? [{ label: `Apply by ${formatDate(item.deadline)}`, tone: 'warning' }] : []),
            ]}
            meta={[item.organization, item.location]}
          />
        ))}
      </section>
    </div>
  );
}
