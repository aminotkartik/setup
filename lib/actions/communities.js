'use server';

/**
 * Communities, clubs and study groups (spec §18, §35).
 *
 * One table (`communities`) with three kinds, one membership table, one chat
 * room per community. Community owners get *community* moderation through
 * `is_community_moderator()` — never platform-level staff powers.
 */

import { revalidatePath } from 'next/cache';
import { getServerClient } from '@/lib/supabase/server';
import { getActiveUser } from '@/lib/auth/session';
import { can, toActor } from '@/lib/permissions/authorization';
import { fromPostgresError, errors, toActionError } from '@/lib/errors';
import { enforceRateLimit } from '@/lib/ratelimit';
import { ROUTES, UUID_REGEX } from '@/lib/constants';
import { slugify } from '@/lib/utils';
import { validate, communitySchema, clubSchema, studyGroupSchema } from '@/lib/validation/schemas';

export async function createCommunity(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const supabase = await getServerClient();
    await enforceRateLimit(supabase, 'community_create', user.profile.id);

    const kind = ['community', 'study_group', 'club'].includes(String(formData.get('kind')))
      ? String(formData.get('kind'))
      : 'community';

    // Defense in depth: the database is the authority (communities_insert_own
    // requires `manage_clubs` for kind = 'club'), but failing here keeps the
    // error message readable instead of surfacing a raw RLS 42501.
    const actor = toActor(user);
    const requiredPermission = kind === 'club' ? 'manage_clubs' : 'create_communities';
    if (!can(actor, requiredPermission)) {
      throw errors.forbidden(
        kind === 'club'
          ? 'Clubs are campus-run spaces. Your account cannot create one.'
          : 'Your account cannot create communities right now.',
      );
    }

    const payload = {
      name: formData.get('name'),
      slug: formData.get('slug') || slugify(formData.get('name')),
      description: formData.get('description'),
      subject: formData.get('subject'),
      branch: formData.get('branch'),
      year: formData.get('year'),
      meeting_info: formData.get('meeting_info'),
      contact_info: formData.get('contact_info'),
      external_url: formData.get('external_url'),
      visibility: kind === 'study_group' ? 'community' : formData.get('visibility') || 'campus',
      join_policy: formData.get('join_policy') || 'open',
    };

    const checked = validate(payload, kind === 'study_group' ? studyGroupSchema : communitySchema);
    if (!checked.ok) throw errors.validation('Please check the community details.', checked.errors);

    const { data, error } = await supabase
      .from('communities')
      .insert({
        kind,
        name: checked.data.name,
        slug: checked.data.slug,
        description: checked.data.description,
        subject: checked.data.subject || null,
        branch: checked.data.branch || null,
        year: checked.data.year || null,
        meeting_info: checked.data.meeting_info || null,
        contact_info: checked.data.contact_info || null,
        external_url: checked.data.external_url || null,
        visibility: checked.data.visibility || 'campus',
        join_policy: checked.data.join_policy || 'open',
        status: 'published',
        is_official: false,
        created_by: user.profile.id,
      })
      .select('id, slug')
      .single();
    if (error) throw fromPostgresError(error, { unique: 'That name or link is already taken.', rls: 'You cannot create a community right now.' });

    // The creator joins as the owner (a database trigger also guarantees an
    // owner row exists for study groups and communities).
    revalidatePath(ROUTES.communities);
    return { ok: true, id: data.id, href: ROUTES.community(data.slug) };
  } catch (error) {
    return toActionError(error, 'That community could not be created.');
  }
}

export async function joinCommunity(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const communityId = String(formData.get('community_id') || '');
    const supabase = await getServerClient();

    const { data: community } = await supabase
      .from('communities')
      .select('id, join_policy, slug')
      .eq('id', communityId)
      .maybeSingle();
    if (!community) throw errors.notFound('That community could not be found.');

    const status = community.join_policy === 'open' ? 'active' : 'pending';
    const { error } = await supabase
      .from('community_members')
      .insert({ community_id: communityId, user_id: user.profile.id, role: 'member', status });
    if (error) throw fromPostgresError(error, { unique: 'You are already a member.', rls: 'You cannot join that community.' });

    revalidatePath(ROUTES.community(community.slug));
    revalidatePath(ROUTES.communities);
    return { ok: true, pending: status === 'pending' };
  } catch (error) {
    return toActionError(error, 'That join request could not be sent.');
  }
}

export async function leaveCommunity(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const communityId = String(formData.get('community_id') || '');
    const slug = String(formData.get('slug') || '');
    const supabase = await getServerClient();
    const { error } = await supabase
      .from('community_members')
      .delete()
      .eq('community_id', communityId)
      .eq('user_id', user.profile.id);
    if (error) throw fromPostgresError(error);
    if (slug) revalidatePath(ROUTES.community(slug));
    revalidatePath(ROUTES.communities);
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

/** Owners/managers decide join requests (community-level moderation only). */
export async function decideJoinRequest(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const requestId = String(formData.get('request_id') || '');
    const decision = String(formData.get('decision') || '');
    const slug = String(formData.get('slug') || '');
    if (!['approved', 'rejected'].includes(decision)) throw errors.validation('Choose approve or reject.');
    const supabase = await getServerClient();
    const { error } = await supabase
      .from('community_join_requests')
      .update({ status: decision, decided_by: user.profile.id, decided_at: new Date().toISOString() })
      .eq('id', requestId);
    if (error) throw fromPostgresError(error, { rls: 'Only community managers can decide requests.' });

    if (decision === 'approved') {
      const { data: request } = await supabase
        .from('community_join_requests')
        .select('community_id, user_id')
        .eq('id', requestId)
        .maybeSingle();
      if (request) {
        await supabase
          .from('community_members')
          .upsert(
            { community_id: request.community_id, user_id: request.user_id, role: 'member', status: 'active' },
            { onConflict: 'community_id,user_id' },
          );
      }
    }

    if (slug) revalidatePath(ROUTES.community(slug));
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

/** Open (or create) the community's single chat room. */
export async function openCommunityChat(formData) {
  try {
    if (!(await getActiveUser())) throw errors.unauthenticated();
    const communityId = String(formData.get('community_id') || '');
    const supabase = await getServerClient();
    const { data, error } = await supabase.rpc('open_community_chat', { p_community: communityId });
    if (error) throw fromPostgresError(error, { rls: 'That chat is not open to you.' });
    return { ok: true, conversationId: data, href: ROUTES.conversation(data) };
  } catch (error) {
    return toActionError(error, 'That chat could not be opened.');
  }
}

/* -------------------------------------------------------------------------- */
/* Dedicated clubs section                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Create a club from /clubs/new.
 *
 * Clubs stay `communities` rows with kind = 'club' — same membership, same
 * join requests, same chat. What is new is the discovery category and the fact
 * that this entry point only exists for `manage_clubs` (campus-run clubs), so
 * the row is official and records who approved it. The database enforces all
 * of this in `communities_insert_own` and `guard_community_insert()`.
 */
export async function createClub(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const actor = toActor(user);
    if (!can(actor, 'manage_clubs')) {
      throw errors.forbidden('Clubs are campus-run spaces. Your account cannot create one.');
    }
    const supabase = await getServerClient();
    await enforceRateLimit(supabase, 'community_create', user.profile.id);

    const checked = validate(
      {
        name: formData.get('name'),
        slug: formData.get('slug') || slugify(formData.get('name')),
        description: formData.get('description'),
        subject: formData.get('subject'),
        club_category: formData.get('club_category'),
        recruitment_info: formData.get('recruitment_info'),
        meeting_info: formData.get('meeting_info'),
        contact_info: formData.get('contact_info'),
        external_url: formData.get('external_url'),
        visibility: formData.get('visibility') || 'campus',
        join_policy: formData.get('join_policy') || 'open',
      },
      clubSchema,
    );
    if (!checked.ok) throw errors.validation('Please check the club details.', checked.errors);

    const { data, error } = await supabase
      .from('communities')
      .insert({
        kind: 'club',
        name: checked.data.name,
        slug: checked.data.slug,
        description: checked.data.description,
        subject: checked.data.subject || null,
        club_category: checked.data.club_category,
        recruitment_info: checked.data.recruitment_info || null,
        meeting_info: checked.data.meeting_info || null,
        contact_info: checked.data.contact_info || null,
        external_url: checked.data.external_url || null,
        visibility: checked.data.visibility || 'campus',
        join_policy: checked.data.join_policy || 'open',
        status: 'published',
        is_official: true,
        created_by: user.profile.id,
      })
      .select('id, slug')
      .single();
    if (error) throw fromPostgresError(error, { unique: 'That club name or link is already taken.', rls: 'You cannot create a club right now.' });

    revalidatePath(ROUTES.clubs);
    revalidatePath(ROUTES.communities);
    return { ok: true, id: data.id, href: ROUTES.club(data.id) };
  } catch (error) {
    return toActionError(error, 'That club could not be created.');
  }
}

/**
 * Edit a club's public information. The slug is deliberately immutable: every
 * notification, search result and bookmarked link points at it.
 */
export async function updateClub(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const id = String(formData.get('id') || '');
    if (!UUID_REGEX.test(id)) throw errors.notFound('That club could not be found.');

    const checked = validate(
      {
        name: formData.get('name'),
        slug: formData.get('slug') || null,
        description: formData.get('description'),
        subject: formData.get('subject'),
        club_category: formData.get('club_category'),
        recruitment_info: formData.get('recruitment_info'),
        meeting_info: formData.get('meeting_info'),
        contact_info: formData.get('contact_info'),
        external_url: formData.get('external_url'),
        visibility: formData.get('visibility') || 'campus',
        join_policy: formData.get('join_policy') || 'open',
      },
      clubSchema,
    );
    if (!checked.ok) throw errors.validation('Please check the club details.', checked.errors);

    const supabase = await getServerClient();
    // RLS (`communities_update_owner` / `communities_update_staff`) is the
    // authority; `.select()` proves the row was actually changed.
    const { data, error } = await supabase
      .from('communities')
      .update({
        name: checked.data.name,
        description: checked.data.description,
        subject: checked.data.subject || null,
        club_category: checked.data.club_category,
        recruitment_info: checked.data.recruitment_info || null,
        meeting_info: checked.data.meeting_info || null,
        contact_info: checked.data.contact_info || null,
        external_url: checked.data.external_url || null,
        visibility: checked.data.visibility || 'campus',
        join_policy: checked.data.join_policy || 'open',
      })
      .eq('id', id)
      .eq('kind', 'club')
      .select('id')
      .maybeSingle();
    if (error) throw fromPostgresError(error, { rls: 'Only this club\'s owners and moderators can edit it.' });
    if (!data) throw errors.notFound('Only this club\'s owners and moderators can edit it.');
    revalidatePath(ROUTES.club(id));
    revalidatePath(ROUTES.clubs);
    return { ok: true, id, href: ROUTES.club(id) };
  } catch (error) {
    return toActionError(error, 'That club could not be saved.');
  }
}

/** Owner-only: make a member a moderator, or a moderator a member again. */
export async function setCommunityMemberRole(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const communityId = String(formData.get('community_id') || '');
    const memberId = String(formData.get('user_id') || '');
    const role = String(formData.get('role') || '');
    if (!['member', 'moderator'].includes(role)) throw errors.validation('Choose a valid role.');
    if (memberId === user.profile.id) throw errors.validation('You cannot change your own role.');

    const supabase = await getServerClient();
    const { data: mine } = await supabase
      .from('community_members')
      .select('role, status')
      .eq('community_id', communityId)
      .eq('user_id', user.profile.id)
      .maybeSingle();
    if (mine?.role !== 'owner') throw errors.forbidden('Only the club owner can change member roles.');

    const { data, error } = await supabase
      .from('community_members')
      .update({ role })
      .eq('community_id', communityId)
      .eq('user_id', memberId)
      .neq('role', 'owner')
      .select('user_id, role')
      .maybeSingle();
    if (error) throw fromPostgresError(error, { rls: 'Only the club owner can change member roles.' });
    if (!data) throw errors.notFound('That membership could not be found.');
    revalidatePath(ROUTES.club(communityId));
    return { ok: true, role };
  } catch (error) {
    return toActionError(error);
  }
}

/** Owner/moderator (or staff): remove a member. Owners can never be removed. */
export async function removeCommunityMember(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const communityId = String(formData.get('community_id') || '');
    const memberId = String(formData.get('user_id') || '');
    if (memberId === user.profile.id) throw errors.validation('Use "Leave" to leave a club.');

    const supabase = await getServerClient();
    const { error } = await supabase
      .from('community_members')
      .delete()
      .eq('community_id', communityId)
      .eq('user_id', memberId)
      .neq('role', 'owner');
    if (error) throw fromPostgresError(error, { rls: 'Only club managers can remove members.' });
    revalidatePath(ROUTES.club(communityId));
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}
