import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import { listCategories } from '@/lib/data/marketplace';
import { ROUTES, LIMITS, MARKETPLACE_CONDITIONS } from '@/lib/constants';
import { PageHeader, Notice } from '@/components/ui';
import { ActionForm } from '@/components/forms/ActionForm';
import { createListing, createGig } from '@/lib/actions/marketplace';

export const metadata = { title: 'New listing' };

/**
 * Create a listing or a gig (spec §18). Both are text-only: a title, a
 * description, a price or a rate, an optional location and an optional contact
 * note that only interested students ever see.
 */
export default async function NewListingPage({ searchParams }) {
  const user = await requireUser();
  const supabase = await getServerClient();
  const actor = toActor(user);
  const params = await searchParams;
  const isGig = params?.type === 'gig';

  if (isGig && !can(actor, 'create_gigs')) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Post a gig" back={{ href: ROUTES.market, label: 'Market' }} />
        <Notice tone="warning" icon="lock">
          Your account cannot post gigs right now.
        </Notice>
      </div>
    );
  }
  if (!isGig && !can(actor, 'create_marketplace_listing')) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Sell something" back={{ href: ROUTES.market, label: 'Market' }} />
        <Notice tone="warning" icon="lock">
          Your account cannot create listings right now.
        </Notice>
      </div>
    );
  }

  const categories = await listCategories(supabase, { scope: isGig ? 'gig' : 'marketplace' });
  const options = categories.map((category) => ({ value: category.id, label: category.name }));

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={isGig ? 'Post a gig' : 'Sell or give away'}
        description={
          isGig
            ? 'Offer a service — tutoring, repairs, design, coding help. Text only.'
            : 'Describe the item honestly. Text only — Campus+ has no photo uploads.'
        }
        back={{ href: ROUTES.market, label: 'Market' }}
      />

      {isGig ? (
        <ActionForm
          action={createGig}
          submitLabel="Publish gig"
          pendingLabel="Publishing…"
          successMessage="Your gig is live."
          cancelHref={ROUTES.market}
          fields={[
            { name: 'title', label: 'Title', required: true, maxLength: LIMITS.gig.title.max, placeholder: 'Maths tutoring for first year' },
            { name: 'description', label: 'Description', type: 'textarea', required: true, maxLength: LIMITS.gig.description.max },
            { name: 'category', label: 'Category', required: true, maxLength: 60, placeholder: 'Tutoring' },
            { name: 'category_id', label: 'Listing category', type: 'select', options, hint: 'Optional — keeps gigs discoverable next to the right listings.' },
            { name: 'compensation', label: 'Compensation', maxLength: 120, placeholder: '₹500 per session' },
            { name: 'availability', label: 'Availability', maxLength: 200, placeholder: 'Weekday evenings, campus library' },
          ]}
        />
      ) : (
        <ActionForm
          action={createListing}
          submitLabel="Publish listing"
          pendingLabel="Publishing…"
          successMessage="Your listing is live. Interested students can now reach you."
          cancelHref={ROUTES.market}
          fields={[
            { name: 'title', label: 'Title', required: true, maxLength: LIMITS.listing.title.max, placeholder: 'Casio FX-991 calculator' },
            { name: 'description', label: 'Description', type: 'textarea', required: true, maxLength: LIMITS.listing.description.max },
            { name: 'category_id', label: 'Category', type: 'select', required: true, options },
            { name: 'price', label: 'Price (₹)', type: 'number', min: 0, step: '1', hint: 'Leave empty for free items — tick the free box below.' },
            { name: 'is_free', label: 'This is a free item', type: 'checkbox' },
            { name: 'is_negotiable', label: 'Price is negotiable', type: 'checkbox' },
            {
              name: 'condition',
              label: 'Condition',
              type: 'select',
              options: MARKETPLACE_CONDITIONS.filter((item) => item.value !== 'not_applicable'),
              defaultValue: 'good',
            },
            { name: 'location', label: 'Location', maxLength: LIMITS.listing.location.max, placeholder: 'PCCOE library, Block A' },
            {
              name: 'contact_note',
              label: 'Note for interested students',
              maxLength: 200,
              hint: 'Only shown after someone taps "I\'m interested". Still, keep it campus-appropriate.',
            },
          ]}
        />
      )}

      <Notice tone="neutral" icon="shield">
        Never share passwords or banking details in a listing. Campus+ is a campus marketplace — no
        payments are processed here.
      </Notice>
    </div>
  );
}
