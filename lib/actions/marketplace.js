'use server';

/**
 * Marketplace, gigs and free stuff (spec §22–§25).
 *
 * The funnel is server-side by design: browsing never exposes `contact_note`;
 * "I'm interested" goes through `record_listing_interest()`, which records the
 * interaction, notifies the seller once and only then returns the note. Seller
 * contact continues in the normal DM system — there is no marketplace chat.
 */

import { revalidatePath } from 'next/cache';
import { getServerClient } from '@/lib/supabase/server';
import { getActiveUser } from '@/lib/auth/session';
import { fromPostgresError, errors, toActionError } from '@/lib/errors';
import { enforceRateLimit } from '@/lib/ratelimit';
import { ROUTES } from '@/lib/constants';
import { validate, listingSchema, gigSchema, ratingSchema } from '@/lib/validation/schemas';

export async function createListing(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const supabase = await getServerClient();
    await enforceRateLimit(supabase, 'listing_create', user.profile.id);

    const payload = {
      title: formData.get('title'),
      description: formData.get('description'),
      price: formData.get('price'),
      is_free: formData.get('is_free') !== null,
      is_negotiable: formData.get('is_negotiable') !== null,
      condition: formData.get('condition') || 'not_applicable',
      location: formData.get('location'),
      contact_note: formData.get('contact_note'),
      category_id: formData.get('category_id'),
    };
    const checked = validate(payload, listingSchema);
    if (!checked.ok) throw errors.validation('Please check the listing details.', checked.errors);
    const values = checked.data;

    // Approval mode is a platform setting: pre-moderation parks the listing in
    // `pending`, post-moderation publishes immediately (default).
    const { data: approval } = await supabase.rpc('marketplace_requires_approval');
    const status = approval ? 'pending' : 'active';

    const { data, error } = await supabase
      .from('marketplace_listings')
      .insert({
        seller_id: user.profile.id,
        category_id: values.category_id,
        title: values.title,
        description: values.description,
        price: values.is_free ? null : values.price ?? null,
        is_free: Boolean(values.is_free),
        is_negotiable: Boolean(values.is_negotiable),
        condition: values.condition || 'not_applicable',
        location: values.location || null,
        contact_note: values.contact_note || null,
        status,
      })
      .select('id')
      .single();
    if (error) throw fromPostgresError(error, { rls: 'You cannot create a listing right now.' });

    revalidatePath(ROUTES.market);
    revalidatePath(`${ROUTES.market}/free`);
    return { ok: true, id: data.id, href: ROUTES.listing(data.id), pending: status === 'pending' };
  } catch (error) {
    return toActionError(error, 'That listing could not be created.');
  }
}

export async function updateListing(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const id = String(formData.get('id') || '');
    const checked = validate(
      {
        title: formData.get('title'),
        description: formData.get('description'),
        price: formData.get('price'),
        is_free: formData.get('is_free') !== null,
        is_negotiable: formData.get('is_negotiable') !== null,
        condition: formData.get('condition') || 'not_applicable',
        location: formData.get('location'),
        contact_note: formData.get('contact_note'),
        category_id: formData.get('category_id'),
      },
      listingSchema,
    );
    if (!checked.ok) throw errors.validation('Please check the listing details.', checked.errors);
    const values = checked.data;

    const supabase = await getServerClient();
    const { error } = await supabase
      .from('marketplace_listings')
      .update({
        title: values.title,
        description: values.description,
        price: values.is_free ? null : values.price ?? null,
        is_free: Boolean(values.is_free),
        is_negotiable: Boolean(values.is_negotiable),
        condition: values.condition || 'not_applicable',
        location: values.location || null,
        contact_note: values.contact_note || null,
        category_id: values.category_id,
      })
      .eq('id', id);
    if (error) throw fromPostgresError(error);
    revalidatePath(ROUTES.listing(id));
    revalidatePath(ROUTES.market);
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

export async function setListingStatus(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const id = String(formData.get('id') || '');
    const status = String(formData.get('status') || '');
    if (!['active', 'reserved', 'sold', 'removed'].includes(status)) throw errors.validation('Unknown listing status.');
    const supabase = await getServerClient();
    const { error } = await supabase.from('marketplace_listings').update({ status }).eq('id', id);
    if (error) throw fromPostgresError(error, { rls: 'You cannot change that listing.' });
    revalidatePath(ROUTES.listing(id));
    revalidatePath(ROUTES.market);
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

/** The single path that reveals a seller's contact note (and gets them notified). */
export async function expressInterest(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const listingId = String(formData.get('listing_id') || '');
    const supabase = await getServerClient();
    const { data, error } = await supabase.rpc('record_listing_interest', { p_listing: listingId });
    if (error) throw fromPostgresError(error, { rls: 'You cannot contact this seller.' });
    revalidatePath(ROUTES.listing(listingId));
    return { ok: true, result: data };
  } catch (error) {
    return toActionError(error, 'That seller could not be reached.');
  }
}

export async function markListingSold(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const id = String(formData.get('id') || '');
    const buyer = String(formData.get('buyer_id') || '') || null;
    const supabase = await getServerClient();
    const { error } = await supabase.rpc('mark_listing_completed', { p_listing: id, p_buyer: buyer });
    if (error) throw fromPostgresError(error, { rls: 'Only the seller can complete a listing.' });
    revalidatePath(ROUTES.listing(id));
    revalidatePath(ROUTES.market);
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

export async function rateCounterparty(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const id = String(formData.get('listing_id') || '');
    const checked = validate(
      { listing_id: id, score: formData.get('score'), comment: formData.get('comment') },
      { ...ratingSchema, listing_id: ratingSchema.listing_id },
    );
    if (!checked.ok) throw errors.validation('Please choose a rating.', checked.errors);
    const supabase = await getServerClient();
    const { error } = await supabase.from('ratings').insert({
      listing_id: checked.data.listing_id,
      rater_id: user.profile.id,
      ratee_id: checked.data.ratee_id,
      role: checked.data.role,
      score: checked.data.score,
      comment: checked.data.comment || null,
    });
    if (error) throw fromPostgresError(error, { unique: 'You have already rated this exchange.' });
    revalidatePath(ROUTES.listing(id));
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

export async function createGig(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const checked = validate(
      {
        title: formData.get('title'),
        description: formData.get('description'),
        category: formData.get('category'),
        compensation: formData.get('compensation'),
        availability: formData.get('availability'),
        category_id: formData.get('category_id'),
      },
      gigSchema,
    );
    if (!checked.ok) throw errors.validation('Please check the gig details.', checked.errors);
    const supabase = await getServerClient();
    const { data, error } = await supabase
      .from('gigs')
      .insert({
        creator_id: user.profile.id,
        title: checked.data.title,
        description: checked.data.description,
        category: checked.data.category,
        compensation: checked.data.compensation || null,
        availability: checked.data.availability || null,
        category_id: checked.data.category_id || null,
        status: 'published',
      })
      .select('id')
      .single();
    if (error) throw fromPostgresError(error, { rls: 'You cannot post a gig right now.' });
    revalidatePath(`${ROUTES.market}/gigs`);
    return { ok: true, id: data.id, href: ROUTES.gig(data.id) };
  } catch (error) {
    return toActionError(error);
  }
}

export async function closeGig(formData) {
  try {
    if (!(await getActiveUser())) throw errors.unauthenticated();
    const id = String(formData.get('id') || '');
    const supabase = await getServerClient();
    const { error } = await supabase.rpc('delete_own_content', { p_target_type: 'gig', p_target_id: id });
    if (error) throw fromPostgresError(error);
    revalidatePath(`${ROUTES.market}/gigs`);
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}
