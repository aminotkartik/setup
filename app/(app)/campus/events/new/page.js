import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import { EVENT_CATEGORIES } from '@/lib/constants';
import { PageHeader, Notice, Card } from '@/components/ui';
import { ActionForm } from '@/components/forms/ActionForm';
import { submitEvent } from '@/lib/actions/campus';

export const metadata = { title: 'Submit an event' };

/**
 * Student event submission. Lands as a non-official draft for staff review —
 * it appears on the calendar only after staff publish it, still labelled
 * student-organized.
 */
export default async function NewEventPage() {
  const user = await requireUser();
  const actor = toActor(user);

  if (!can(actor, 'submit_events')) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Submit an event" back={{ href: '/campus/events', label: 'Events' }} />
        <Notice tone="warning" icon="lock">Your account cannot submit events right now.</Notice>
      </div>
    );
  }

  const supabase = await getServerClient();
  const { data: clubs } = await supabase
    .from('communities')
    .select('id, name')
    .eq('status', 'published')
    .eq('kind', 'club')
    .order('name', { ascending: true })
    .limit(100);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Submit an event"
        description="Tell us what is happening. Staff review every submission before it appears on the calendar."
        back={{ href: '/campus/events', label: 'Events' }}
      />
      <Card className="p-4 text-[0.8125rem] leading-relaxed text-muted">
        <strong className="text-ink">Community submissions stay community.</strong> Your event will be
        labelled student-organized even after review — only staff-published events carry the official
        badge. Include a venue, and a registration link when seats are limited.
      </Card>
      <ActionForm
        action={submitEvent}
        submitLabel="Submit for review"
        successMessage="Submitted. Staff will review it before it appears on the calendar."
        redirectTo="/campus/events"
        resetOnSuccess={false}
        cancelHref="/campus/events"
        fields={[
          { name: 'title', label: 'Event title', required: true, maxLength: 140 },
          { name: 'description', label: 'What is happening?', type: 'textarea', required: true, maxLength: 2000 },
          { name: 'category', label: 'Category', type: 'select', options: EVENT_CATEGORIES.map((option) => ({ value: option.value, label: option.label })) },
          { name: 'starts_on', label: 'Date', type: 'date', required: true },
          { name: 'start_time', label: 'Start time', type: 'time' },
          { name: 'end_time', label: 'End time', type: 'time' },
          { name: 'location', label: 'Venue', required: true, maxLength: 140, placeholder: 'e.g. Main auditorium' },
          { name: 'organizer', label: 'Organizer', maxLength: 120, placeholder: 'Club or team name' },
          { name: 'club_id', label: 'Club', type: 'select', options: (clubs || []).map((club) => ({ value: club.id, label: club.name })) },
          { name: 'registration_info', label: 'Registration details', type: 'textarea', maxLength: 500, hint: 'How do students register? Any fee or requirements?' },
          { name: 'registration_url', label: 'Registration link', maxLength: 300, placeholder: 'https://…' },
          { name: 'capacity', label: 'Capacity', type: 'number', min: 1, max: 100000, step: '1' },
        ]}
      />
    </div>
  );
}
