import { requireUser } from '@/lib/auth/session';
import { can, toActor } from '@/lib/permissions/authorization';
import { ROUTES, LIMITS, CLUB_CATEGORIES } from '@/lib/constants';
import { PageHeader, Notice } from '@/components/ui';
import { ActionForm } from '@/components/forms/ActionForm';
import { createClub } from '@/lib/actions/communities';

export const metadata = { title: 'Create a club' };

/**
 * Create Club.
 *
 * Clubs are campus-run spaces, so this is gated by the existing `manage_clubs`
 * permission (the same rule the database enforces on insert). The form collects
 * the discovery category and recruitment note that the /clubs board filters by.
 */
export default async function NewClubPage() {
  const user = await requireUser();
  const actor = toActor(user);

  if (!can(actor, 'manage_clubs')) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Create a club" back={{ href: ROUTES.clubs, label: 'Clubs' }} />
        <Notice tone="warning" icon="lock">
          Clubs are campus-run spaces. Your account cannot create one — ask an admin to set it up from the admin
          console, or create a community or study group instead.
        </Notice>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Create Club"
        eyebrow="Campus life"
        description="Set up a club page with its own feed, membership, join requests, chat and events."
        back={{ href: ROUTES.clubs, label: 'Clubs' }}
      />

      <ActionForm
        action={createClub}
        submitLabel="Create club"
        pendingLabel="Creating…"
        successMessage="Club created. You are its owner."
        cancelHref={ROUTES.clubs}
        fields={[
          {
            name: 'name',
            label: 'Club name',
            required: true,
            maxLength: LIMITS.club.name.max,
            placeholder: 'Robotics and Automation Club',
          },
          {
            name: 'slug',
            label: 'Link (optional)',
            maxLength: 60,
            hint: 'Lowercase letters, numbers and dashes. Generated from the name if left empty.',
          },
          {
            name: 'description',
            label: 'Description',
            type: 'textarea',
            required: true,
            rows: 5,
            maxLength: LIMITS.club.description.max,
            placeholder: 'What the club does, who it is for, and when it meets.',
          },
          {
            name: 'club_category',
            label: 'Category',
            type: 'select',
            required: true,
            placeholder: 'Choose a category',
            options: CLUB_CATEGORIES.map((category) => ({ value: category.value, label: category.label })),
          },
          {
            name: 'subject',
            label: 'Interest / subject',
            maxLength: 120,
            placeholder: 'Robotics, embedded systems, drones',
            hint: 'Used by search, so students can find the club by interest.',
          },
          {
            name: 'recruitment_info',
            label: 'Recruiting?',
            maxLength: 400,
            placeholder: 'Open to first and second year students; auditions in August.',
          },
          {
            name: 'meeting_info',
            label: 'Meeting info',
            maxLength: 200,
            placeholder: 'Saturdays, 4 pm, Robotics Lab',
          },
          {
            name: 'contact_info',
            label: 'Contact',
            maxLength: 200,
            hint: 'Text only — no links to personal chats.',
          },
          {
            name: 'external_url',
            label: 'Website',
            placeholder: 'https://…',
          },
          {
            name: 'join_policy',
            label: 'How people join',
            type: 'select',
            defaultValue: 'open',
            options: [
              { value: 'open', label: 'Anyone can join' },
              { value: 'request', label: 'They request, an admin approves' },
            ],
          },
          {
            name: 'visibility',
            label: 'Who can see it',
            type: 'select',
            defaultValue: 'campus',
            options: [
              { value: 'public', label: 'Everyone on Campus+' },
              { value: 'campus', label: 'Campus members' },
              { value: 'private', label: 'Members only' },
            ],
          },
        ]}
      />
    </div>
  );
}
