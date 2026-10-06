import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import { listRidePosts } from '@/lib/data/campus';
import { ROUTES } from '@/lib/constants';
import { PageHeader, EmptyState, Notice, LinkButton } from '@/components/ui';
import { ContentCard } from '@/components/content/ContentCard';
import { PostActionsRow } from '@/components/campus/PostActionsRow';
import { formatDate, formatTime } from '@/lib/utils';

export const metadata = { title: 'Rides' };

/** Ride sharing (spec §32). Students coordinate in messages; no payments here. */
export default async function RidesPage() {
  const user = await requireUser();
  const supabase = await getServerClient();
  const actor = toActor(user);
  const { items, unavailable } = await listRidePosts(supabase, { limit: 30 });
  const canCreate = can(actor, 'create_ride_post');

  const creators = await (async () => {
    const ids = [...new Set(items.map((item) => item.creator_id))];
    if (!ids.length) return new Map();
    const { data } = await supabase.from('public_profiles').select('id, username, display_name').in('id', ids);
    return new Map((data || []).map((person) => [person.id, person]));
  })();

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Rides"
        description="Share a cab, find a seat, split a trip home."
        back={{ href: ROUTES.campus, label: 'Campus' }}
        action={canCreate ? <LinkButton href="/campus/rides/new" size="sm" icon="plus">Post a ride</LinkButton> : null}
      />

      {unavailable ? <Notice tone="warning" icon="flag">Rides could not be loaded right now.</Notice> : null}

      {!unavailable && !items.length ? (
        <EmptyState
          icon="bus"
          title="No rides posted"
          description="Weekend trips, station runs and holidays — post one when you have space."
          action={canCreate ? <LinkButton href="/campus/rides/new" variant="primary" size="sm">Post a ride</LinkButton> : null}
        />
      ) : null}

      <section aria-label="Rides" className="flex flex-col gap-3">
        {items.map((ride) => {
          const creator = creators.get(ride.creator_id);
          return (
            <ContentCard
              key={ride.id}
              title={`${ride.origin} → ${ride.destination}`}
              description={ride.description}
              icon="bus"
              timestamp={ride.created_at}
              badges={[
                { label: formatDate(ride.ride_date), tone: 'accent' },
                ...(ride.ride_time ? [{ label: formatTime(ride.ride_time) }] : []),
                ...(ride.seats ? [{ label: `${ride.seats} seat${ride.seats === 1 ? '' : 's'}` }] : []),
              ]}
              meta={[creator ? `@${creator.username}` : null]}
              footer={
                <span className="mt-2 flex flex-wrap items-center gap-2">
                  <PostActionsRow
                    creatorId={ride.creator_id}
                    creatorUsername={creator?.username}
                    isOwner={ride.creator_id === user.profile.id}
                    canReport={can(actor, 'report_content')}
                    canMessage={can(actor, 'send_messages')}
                    reportType="ride_post"
                    reportRef={ride.id}
                  />
                </span>
              }
            />
          );
        })}
      </section>
    </div>
  );
}
