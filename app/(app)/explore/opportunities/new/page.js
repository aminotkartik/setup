import { requireUser } from '@/lib/auth/session';
import { can, toActor } from '@/lib/permissions/authorization';
import { PageHeader, Notice } from '@/components/ui';
import { ActionForm } from '@/components/forms/ActionForm';
import { submitOpportunity } from '@/lib/actions/campus';

export const metadata = { title: 'Submit an opportunity' };

/** Submit an opportunity (spec §35). Marked community-submitted until staff verify it. */
export default async function NewOpportunityPage() {
  const user = await requireUser();
  const actor = toActor(user);

  if (!can(actor, 'submit_opportunities')) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Submit an opportunity" back={{ href: '/explore/opportunities', label: 'Opportunities' }} />
        <Notice tone="warning" icon="lock">Your account cannot submit opportunities right now.</Notice>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Submit an opportunity"
        description="Link to the original posting. Student submissions stay labelled as community-submitted."
        back={{ href: '/explore/opportunities', label: 'Opportunities' }}
      />
      <ActionForm
        action={submitOpportunity}
        submitLabel="Submit"
        successMessage="Submitted. It is marked community-submitted until staff review it."
        redirectTo="/explore/opportunities"
        resetOnSuccess={false}
        cancelHref="/explore/opportunities"
        fields={[
          { name: 'title', label: 'Title', required: true, maxLength: 140 },
          { name: 'organization', label: 'Organization', required: true, maxLength: 140 },
          { name: 'url', label: 'Link', required: true, placeholder: 'https://…' },
          { name: 'description', label: 'Description', type: 'textarea', required: true, maxLength: 2000 },
          { name: 'eligibility', label: 'Eligibility', type: 'textarea', maxLength: 1000 },
          { name: 'deadline', label: 'Deadline', type: 'date' },
          { name: 'location', label: 'Location', maxLength: 140 },
          {
            name: 'mode',
            label: 'Mode',
            type: 'select',
            defaultValue: 'onsite',
            options: [
              { value: 'onsite', label: 'On site' },
              { value: 'remote', label: 'Remote' },
              { value: 'hybrid', label: 'Hybrid' },
            ],
          },
        ]}
      />
    </div>
  );
}
