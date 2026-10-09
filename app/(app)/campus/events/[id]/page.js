import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import { getEvent, getEventRsvp, listEventAttendees } from '@/lib/data/campus';
import { UUID_REGEX } from '@/lib/constants';
import { PageHeader, Badge, Notice, Card, StaffDot } from '@/components/ui';
import { IdentityLine } from '@/components/identity/IdentityLine';
import { RsvpForm } from '@/components/campus/RsvpForm';
import { EventReviewActions, EventWithdrawAction } from '@/components/campus/EventSubmissionActions';
import { categoryLabel } from '@/components/campus/eventMeta';
import { MessageButton } from '@/components/social/MessageButton';
import { ReportDialog } from '@/components/social/ReportDialog';
import { ExternalLink } from '@/components/content/ExternalLink';
import { formatDate, formatDateTime, formatTime } from '@/lib/utils';

export async function generateMetadata({ params }) {
  const { id } = await params;
  if (!UUID_REGEX.test(id)) return { title: 'Event' };
  const supabase = await getServerClient();
  const event = await getEvent(supabase, id);
  return { title: event?.title || 'Event' };
}

/**
 * Event detail (spec §30).
 *
 * RSVP is a single row per student. Organizer contact is a normal DM — the
 * registration URL, when present, must be an https link and is rendered as a
 * plain external link, never embedded.
 */
export default async function EventPage({ params }) {
  const { id } = await params;
  if (!UUID_REGEX.test(id)) notFound();

  const user = await requireUser();
  const supabase = await getServerClient();
  const actor = toActor(user);
  const event = await getEvent(supabase, id);
  if (!event) notFound();

  const isStaff = can(actor, 'manage_events') || can(actor, 'moderate_all');
  const isCreator = event.created_by === user.profile.id;
  // Drafts are visible to staff (review) and to their own submitter (tracking);
  // everyone else only ever sees published events.
  if (event.status !== 'published' && !isStaff && !isCreator) notFound();

  const [rsvp, attendees] = await Promise.all([
    getEventRsvp(supabase, event.id, user.profile.id),
    event.show_attendees ? listEventAttendees(supabase, event.id) : Promise.resolve([]),
  ]);

  const organizerProfile = event.organizer
    ? await (async () => {
        const { data } = await supabase
          .from('public_profiles')
          .select('id, username, display_name, is_staff')
          .eq('username', String(event.organizer).replace(/^@/, '').toLowerCase())
          .maybeSingle();
        return data || null;
      })()
    : null;

  const going = attendees.filter((row) => row.status === 'going').length;
  const interested = attendees.filter((row) => row.status === 'interested').length;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={event.title}
        description={[formatDate(event.starts_on), event.start_time ? formatTime(event.start_time) : null, event.location]
          .filter(Boolean)
          .join(' · ')}
        back={{ href: '/campus/events', label: 'Events' }}
      />

      <div className="flex flex-wrap items-center gap-2">
        {event.is_official ? <Badge tone="accent">Official</Badge> : <Badge>Student-organized</Badge>}
        {event.status !== 'published' ? <Badge tone={event.status === 'draft' ? 'warning' : 'danger'}>{event.status === 'draft' ? 'In review' : event.status}</Badge> : null}
        {event.club_id ? <Badge>Club event</Badge> : null}
        {categoryLabel(event.category) ? <Badge>{categoryLabel(event.category)}</Badge> : null}
      </div>

      {event.status === 'draft' && isStaff ? (
        <Card className="flex flex-col gap-2 p-4">
          <h2 className="text-sm font-semibold">Review this submission</h2>
          <p className="text-2xs text-muted">Publishing keeps it labelled student-organized — never official.</p>
          <EventReviewActions eventId={event.id} />
        </Card>
      ) : null}

      {event.status === 'draft' && isCreator && !isStaff ? (
        <Card className="flex flex-col gap-2 p-4">
          <h2 className="text-sm font-semibold">Your submission is in review</h2>
          <p className="text-2xs text-muted">Staff will publish or decline it. You can withdraw it any time before then.</p>
          <EventWithdrawAction eventId={event.id} />
        </Card>
      ) : null}

      <Card className="flex flex-col gap-3 p-4">
        {event.description ? (
          <p className="user-text whitespace-pre-wrap text-[0.9375rem] leading-relaxed">{event.description}</p>
        ) : null}
        <dl className="flex flex-wrap gap-x-4 gap-y-1 text-2xs text-muted">
          <div className="flex gap-1">
            <dt>Starts</dt>
            <dd>{formatDateTime(`${event.starts_on}T${event.start_time || '00:00:00'}`)}</dd>
          </div>
          {event.ends_on ? (
            <div className="flex gap-1">
              <dt>Ends</dt>
              <dd>{formatDate(event.ends_on)}</dd>
            </div>
          ) : null}
          {event.location ? (
            <div className="flex gap-1">
              <dt>Venue</dt>
              <dd>{event.location}</dd>
            </div>
          ) : null}
          {event.capacity ? (
            <div className="flex gap-1">
              <dt>Capacity</dt>
              <dd>{event.capacity}</dd>
            </div>
          ) : null}
        </dl>
        {event.registration_info ? <p className="text-[0.8125rem] text-muted">{event.registration_info}</p> : null}
        {event.registration_url ? (
          <p className="text-[0.8125rem]">
            Registration:{' '}
            <ExternalLink url={event.registration_url} className="underline">
              {event.registration_url}
            </ExternalLink>
          </p>
        ) : null}
      </Card>

      <Card className="flex flex-col gap-3 p-4">
        <h2 className="text-sm font-semibold">Your RSVP</h2>
        <RsvpForm eventId={event.id} currentStatus={rsvp?.status || null} canRsvp={can(actor, 'rsvp_events')} />
        {event.show_attendees ? (
          <p className="text-2xs text-muted">
            {going} going · {interested} interested
          </p>
        ) : null}
      </Card>

      {organizerProfile || event.organizer ? (
        <Card className="flex flex-col gap-3 p-4">
          <h2 className="text-sm font-semibold">Organizer</h2>
          {organizerProfile ? (
            <IdentityLine
              username={organizerProfile.username}
              displayName={organizerProfile.display_name}
              isStaff={organizerProfile.is_staff}
              badge={organizerProfile.is_staff ? <StaffDot label="Campus+ staff" /> : null}
            />
          ) : (
            <p className="text-[0.8125rem]">{event.organizer}</p>
          )}
          {organizerProfile && organizerProfile.id !== user.profile.id ? (
            <MessageButton profileId={organizerProfile.id} label="Message the organizer" />
          ) : (
            <p className="text-2xs text-muted">Contact the organizer through messages.</p>
          )}
        </Card>
      ) : null}

      {event.show_attendees && attendees.length ? (
        <Card className="flex flex-col gap-2 p-4">
          <h2 className="text-sm font-semibold">Who is coming</h2>
          <ul className="flex flex-col gap-2">
            {attendees.slice(0, 20).map((attendee) => (
              <li key={`${attendee.user_id}-${attendee.status}`}>
                <IdentityLine
                  username={attendee.username}
                  displayName={attendee.display_name}
                  size="sm"
                  badge={<Badge>{attendee.status.replace('_', ' ')}</Badge>}
                />
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="flex items-center justify-between">
        <Link href="/campus/events" className="text-2xs text-muted underline hover:text-ink">
          All events
        </Link>
        {can(actor, 'report_content') ? <ReportDialog targetType="event" targetRef={event.id} label="this event" /> : null}
      </div>

      <Notice tone="neutral" icon="shield">
        Campus+ has no payments and no ticket sales. Anything asking for money upfront is not part of
        this platform.
      </Notice>
    </div>
  );
}
