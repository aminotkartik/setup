import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { listEvents } from '@/lib/data/campus';
import { ROUTES, PAGE_SIZE } from '@/lib/constants';
import { PageHeader, EmptyState, Notice, LinkButton, Card } from '@/components/ui';
import { ContentCard } from '@/components/content/ContentCard';
import { formatDate, formatTime } from '@/lib/utils';

export const metadata = { title: 'Events' };

/** Events list (spec §30). Upcoming first; past events stay reachable by link. */
export default async function EventsPage({ searchParams }) {
  await requireUser();
  const supabase = await getServerClient();
  const params = await searchParams;
  const offset = Math.max(0, Number.parseInt(params?.offset || '0', 10) || 0);
  const past = params?.when === 'past';

  const { items, unavailable } = await listEvents(supabase, { limit: PAGE_SIZE.default, offset, upcoming: !past });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Events"
        description="Campus events with RSVP and organizer contact."
        back={{ href: ROUTES.campus, label: 'Campus' }}
      />

      <Card className="flex flex-wrap gap-1.5 p-3">
        <LinkButton href="/campus/events" size="sm" variant={past ? 'ghost' : 'secondary'}>
          Upcoming
        </LinkButton>
        <LinkButton href="/campus/events?when=past" size="sm" variant={past ? 'secondary' : 'ghost'}>
          Past
        </LinkButton>
      </Card>

      {unavailable ? (
        <Notice tone="warning" icon="flag">
          Events could not be loaded right now.
        </Notice>
      ) : null}

      {!unavailable && !items.length ? (
        <EmptyState
          icon="calendar"
          title={past ? 'No past events' : 'No upcoming events'}
          description="Events published by clubs and the campus appear here."
        />
      ) : null}

      <section aria-label="Events" className="flex flex-col gap-3">
        {items.map((event) => (
          <ContentCard
            key={event.id}
            href={ROUTES.event(event.id)}
            title={event.title}
            description={event.description}
            icon="calendar"
            official={event.is_official}
            badges={[
              { label: formatDate(event.starts_on), tone: 'accent' },
              ...(event.start_time ? [{ label: formatTime(event.start_time) }] : []),
            ]}
            meta={[event.location, event.organizer]}
          />
        ))}
      </section>

      {items.length === PAGE_SIZE.default ? (
        <div className="flex justify-end">
          <LinkButton
            href={`/campus/events?${past ? 'when=past&' : ''}offset=${offset + PAGE_SIZE.default}`}
            size="sm"
            variant="secondary"
          >
            More events
          </LinkButton>
        </div>
      ) : null}
    </div>
  );
}
