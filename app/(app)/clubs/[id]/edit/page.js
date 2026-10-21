import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import { getCommunityById, getCommunityMembership } from '@/lib/data/campus';
import { ROUTES, UUID_REGEX, LIMITS, CLUB_CATEGORIES } from '@/lib/constants';
import { PageHeader, Notice } from '@/components/ui';
import { ActionForm } from '@/components/forms/ActionForm';
import { updateClub } from '@/lib/actions/communities';

export const metadata = { title: 'Manage club' };

/**
 * Edit a club's public information.
 *
 * Owners and moderators of this club, plus staff. RLS enforces the same rule on
 * the update (`communities_update_owner` / `communities_update_staff`); the
 * check here only decides whether the form is shown at all.
 */
export default async function EditClubPage({ params }) {
  const { id } = await params;
  if (!UUID_REGEX.test(id)) notFound();

  const user = await requireUser();
  const supabase = await getServerClient();
  const actor = toActor(user);

  const club = await getCommunityById(supabase, id);
  if (!club || club.kind !== 'club') notFound();

  const membership = await getCommunityMembership(supabase, club.id, user.profile.id);
  const isStaff = can(actor, 'manage_clubs') || can(actor, 'moderate_communities') || can(actor, 'moderate_all');
  const canManage = isStaff || membership?.role === 'owner' || membership?.role === 'moderator' || club.created_by === user.profile.id;
  if (!canManage) notFound();

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Manage club"
        eyebrow={club.name}
        description="Update what students see on the club page. The club link never changes, so bookmarks and notifications keep working."
        back={{ href: ROUTES.club(club.id), label: 'Back to the club' }}
      />

      {club.status !== 'published' ? (
        <Notice tone="warning" icon="flag">
          This club is {club.status}. It stays hidden from the board until staff publish it.
        </Notice>
      ) : null}

      <ActionForm
        action={updateClub}
        hidden={{ id: club.id }}
        submitLabel="Save club"
        pendingLabel="Saving…"
        successMessage="Club updated."
        cancelHref={ROUTES.club(club.id)}
        fields={[
          {
            name: 'name',
            label: 'Club name',
            required: true,
            maxLength: LIMITS.club.name.max,
            defaultValue: club.name,
          },
          {
            name: 'description',
            label: 'Description',
            type: 'textarea',
            required: true,
            rows: 5,
            maxLength: LIMITS.club.description.max,
            defaultValue: club.description,
          },
          {
            name: 'club_category',
            label: 'Category',
            type: 'select',
            required: true,
            defaultValue: club.club_category || '',
            placeholder: 'Choose a category',
            options: CLUB_CATEGORIES.map((category) => ({ value: category.value, label: category.label })),
          },
          {
            name: 'subject',
            label: 'Interest / subject',
            maxLength: 120,
            defaultValue: club.subject || '',
          },
          {
            name: 'recruitment_info',
            label: 'Recruiting?',
            maxLength: 400,
            defaultValue: club.recruitment_info || '',
          },
          {
            name: 'meeting_info',
            label: 'Meeting info',
            maxLength: 200,
            defaultValue: club.meeting_info || '',
          },
          {
            name: 'contact_info',
            label: 'Contact',
            maxLength: 200,
            defaultValue: club.contact_info || '',
          },
          {
            name: 'external_url',
            label: 'Website',
            placeholder: 'https://…',
            defaultValue: club.external_url || '',
          },
          {
            name: 'join_policy',
            label: 'How people join',
            type: 'select',
            defaultValue: club.join_policy || 'open',
            options: [
              { value: 'open', label: 'Anyone can join' },
              { value: 'request', label: 'They request, an admin approves' },
            ],
          },
          {
            name: 'visibility',
            label: 'Who can see it',
            type: 'select',
            defaultValue: club.visibility || 'campus',
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
