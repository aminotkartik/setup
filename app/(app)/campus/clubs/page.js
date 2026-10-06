import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { listCommunities } from '@/lib/data/campus';
import { ROUTES } from '@/lib/constants';
import { PageHeader, EmptyState, Notice } from '@/components/ui';
import { ContentCard } from '@/components/content/ContentCard';

export const metadata = { title: 'Clubs' };

/**
 * Clubs (spec §28). Clubs are communities that the campus owns or recognises —
 * the "Official" label comes from the database, never from this page.
 */
export default async function ClubsPage() {
  await requireUser();
  const supabase = await getServerClient();
  const { items, unavailable } = await listCommunities(supabase, { kind: 'club', limit: 40 });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Clubs"
        description="Student clubs and campus societies, with their events and contact."
        back={{ href: ROUTES.campus, label: 'Campus' }}
      />

      {unavailable ? (
        <Notice tone="warning" icon="flag">
          Clubs could not be loaded right now.
        </Notice>
      ) : null}

      {!unavailable && !items.length ? (
        <EmptyState
          icon="star"
          title="No clubs listed yet"
          description="Club pages appear here once they are published."
        />
      ) : null}

      <section aria-label="Clubs" className="flex flex-col gap-3">
        {items.map((club) => (
          <ContentCard
            key={club.id}
            href={ROUTES.club(club.id)}
            title={club.name}
            description={club.description}
            icon="star"
            official={club.is_official}
            badges={[
              club.is_official ? { label: 'Official', tone: 'accent' } : { label: 'Student-run', tone: 'neutral' },
              ...(club.subject ? [{ label: club.subject }] : []),
            ]}
            meta={[
              `${club.member_count} member${club.member_count === 1 ? '' : 's'}`,
              club.recruitment_info ? 'Recruiting' : null,
            ]}
          />
        ))}
      </section>
    </div>
  );
}
