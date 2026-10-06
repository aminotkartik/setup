import { requireUser } from '@/lib/auth/session';
import { can, toActor } from '@/lib/permissions/authorization';
import { PageHeader, Notice } from '@/components/ui';
import { ActionForm } from '@/components/forms/ActionForm';
import { createLostFound } from '@/lib/actions/campus';

export const metadata = { title: 'Report an item' };

/** Report a lost or found item (spec §31). Text only — describe it clearly. */
export default async function NewLostFoundPage({ searchParams }) {
  const user = await requireUser();
  const actor = toActor(user);
  const params = await searchParams;
  const kind = params?.kind === 'found' ? 'found' : 'lost';

  if (!can(actor, 'create_lost_found')) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Report an item" back={{ href: '/campus/lost-found', label: 'Lost & found' }} />
        <Notice tone="warning" icon="lock">
          Your account cannot create lost &amp; found posts right now.
        </Notice>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={kind === 'found' ? 'Report a found item' : 'Report a lost item'}
        description="No photos — describe the item, where and when, and how to reach you."
        back={{ href: '/campus/lost-found', label: 'Lost & found' }}
      />
      <ActionForm
        action={createLostFound}
        hidden={{ kind }}
        submitLabel="Post report"
        successMessage="Posted. Anyone who recognises the item can message you."
        cancelHref="/campus/lost-found"
        resetOnSuccess={false}
        redirectTo="/campus/lost-found"
        fields={[
          { name: 'title', label: 'What is it?', required: true, maxLength: 140, placeholder: 'Black Casio calculator' },
          { name: 'description', label: 'Details', type: 'textarea', required: true, maxLength: 1000, hint: 'Do not include personal contact details — people can message you here.' },
          { name: 'location', label: 'Where', maxLength: 120, placeholder: 'Block C, second floor' },
          { name: 'occurred_on', label: 'When', type: 'date' },
        ]}
      />
      <Notice tone="neutral" icon="shield">
        Claiming an item? Ask a question only the owner could answer rather than describing it first.
      </Notice>
    </div>
  );
}
