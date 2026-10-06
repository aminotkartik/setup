import { requireUser } from '@/lib/auth/session';
import { can, toActor } from '@/lib/permissions/authorization';
import { ROUTES, BRANCHES, YEARS, LIMITS } from '@/lib/constants';
import { PageHeader, Notice } from '@/components/ui';
import { ActionForm } from '@/components/forms/ActionForm';
import { createCommunity } from '@/lib/actions/communities';

export const metadata = { title: 'New community' };

/**
 * Create a community, study group or club (spec §26, §28, §33). Student-created
 * spaces are never marked official, and clubs that the campus runs are created
 * by staff from the admin surface.
 */
export default async function NewCommunityPage({ searchParams }) {
  const user = await requireUser();
  const actor = toActor(user);
  const params = await searchParams;
  const kind = ['community', 'study_group', 'club'].includes(String(params?.kind)) ? String(params.kind) : 'community';

  if (!can(actor, 'create_communities')) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Create" back={{ href: ROUTES.communities, label: 'Communities' }} />
        <Notice tone="warning" icon="lock">
          Your account cannot create communities right now.
        </Notice>
      </div>
    );
  }

  const kindLabel = kind === 'study_group' ? 'study group' : kind === 'club' ? 'club' : 'community';

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={`Create a ${kindLabel}`}
        description={
          kind === 'study_group'
            ? 'Find people studying the same subject. The group gets a chat and a shared feed.'
            : 'A shared space with its own feed, members and chat.'
        }
        back={{ href: ROUTES.communities, label: 'Communities' }}
      />

      <div className="flex flex-wrap gap-1.5">
        {[
          { key: 'community', label: 'Community' },
          { key: 'study_group', label: 'Study group' },
          { key: 'club', label: 'Club' },
        ].map((option) => (
          <a
            key={option.key}
            href={`/communities/new?kind=${option.key}`}
            className={`rounded-full border px-3 py-1 text-2xs ${
              kind === option.key ? 'border-accent/40 bg-accent-soft text-ink' : 'border-line bg-white text-muted hover:text-ink'
            }`}
          >
            {option.label}
          </a>
        ))}
      </div>

      <ActionForm
        action={createCommunity}
        hidden={{ kind }}
        submitLabel={`Create ${kindLabel}`}
        pendingLabel="Creating…"
        successMessage="Created. You are the owner."
        cancelHref={ROUTES.communities}
        redirectTo={(result) => result.href || ROUTES.communities}
        fields={[
          { name: 'name', label: 'Name', required: true, maxLength: LIMITS.community.name.max },
          { name: 'slug', label: 'Link (optional)', maxLength: 60, hint: 'Lowercase letters, numbers and dashes. Generated from the name if left empty.' },
          { name: 'description', label: 'Description', type: 'textarea', required: true, maxLength: LIMITS.community.description.max },
          ...(kind === 'study_group'
            ? [
                { name: 'subject', label: 'Subject', required: true, maxLength: 120, placeholder: 'Data Structures' },
                { name: 'meeting_info', label: 'Meeting info', maxLength: 200, placeholder: 'Saturdays, library discussion room' },
              ]
            : []),
          { name: 'branch', label: 'Branch', type: 'select', options: BRANCHES.map((branch) => ({ value: branch, label: branch })) },
          { name: 'year', label: 'Year', type: 'select', options: YEARS.map((year) => ({ value: year, label: year })) },
          ...(kind === 'community'
            ? [
                { name: 'subject', label: 'Topic', maxLength: 120, placeholder: 'Robotics, placements, campus life…' },
                { name: 'meeting_info', label: 'Meeting info', maxLength: 200 },
                { name: 'contact_info', label: 'Contact', maxLength: 200, hint: 'Text only — no links to personal chats.' },
                { name: 'external_url', label: 'Website', placeholder: 'https://…' },
              ]
            : []),
          {
            name: 'join_policy',
            label: 'How people join',
            type: 'select',
            defaultValue: 'open',
            options: [
              { value: 'open', label: 'Anyone can join' },
              { value: 'request', label: 'They request, you approve' },
            ],
          },
          {
            name: 'visibility',
            label: 'Visibility',
            type: 'select',
            defaultValue: 'campus',
            options: [
              { value: 'campus', label: 'PCCOE students' },
              { value: 'public', label: 'Anyone signed in' },
            ],
          },
        ]}
      />

      <Notice tone="neutral" icon="shield">
        Everything here is text. Do not paste personal contact numbers or other people&apos;s details into a
        community description.
      </Notice>
    </div>
  );
}
