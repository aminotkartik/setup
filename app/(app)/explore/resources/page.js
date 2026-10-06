import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import { listResources } from '@/lib/data/campus';
import { ROUTES } from '@/lib/constants';
import { PageHeader, EmptyState, Notice, LinkButton } from '@/components/ui';
import { ContentCard } from '@/components/content/ContentCard';
import { formatDate } from '@/lib/utils';

export const metadata = { title: 'Resources' };

/** Academic resources (spec §34). Official material and student submissions are labelled differently. */
export default async function ResourcesPage({ searchParams }) {
  const user = await requireUser();
  const supabase = await getServerClient();
  const actor = toActor(user);
  const params = await searchParams;
  const branch = typeof params?.branch === 'string' && params.branch ? params.branch : null;

  const { items, unavailable } = await listResources(supabase, { branch, limit: 30 });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Resources"
        description="Notes, previous papers and reference material shared by students and staff."
        back={{ href: ROUTES.explore, label: 'Explore' }}
        action={can(actor, 'submit_resources') ? <LinkButton href="/explore/resources/new" size="sm" icon="plus">Submit a resource</LinkButton> : null}
      />

      {unavailable ? <Notice tone="warning" icon="flag">Resources could not be loaded right now.</Notice> : null}

      {!unavailable && !items.length ? (
        <EmptyState
          icon="book"
          title="No resources yet"
          description="Share a link to notes or a paper you found useful. Links must be public and safe to open."
          action={can(actor, 'submit_resources') ? <LinkButton href="/explore/resources/new" variant="primary" size="sm">Submit a resource</LinkButton> : null}
        />
      ) : null}

      <section aria-label="Resources" className="flex flex-col gap-3">
        {items.map((resource) => (
          <ContentCard
            key={resource.id}
            href={ROUTES.resource(resource.id)}
            title={resource.title}
            description={resource.description}
            icon="book"
            official={resource.is_official}
            community={!resource.is_official}
            badges={[
              ...(resource.type ? [{ label: resource.type }] : []),
              ...(resource.branch ? [{ label: resource.branch }] : []),
              ...(resource.semester ? [{ label: resource.semester }] : []),
            ]}
            meta={[resource.subject, `Published ${formatDate(resource.published_at || resource.created_at)}`]}
          />
        ))}
      </section>
    </div>
  );
}
