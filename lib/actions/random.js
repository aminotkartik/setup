'use server';

/**
 * Random — anonymous paired conversations (spec §21).
 *
 * Identity rules are enforced below the application: participants can read only
 * `random_session_view` / `random_messages_view`, which carry no identities, and
 * `send_random_message()` is the only write path. This module never receives,
 * returns or logs who the other participant is — a moderator's view is a
 * separate, permission-gated surface.
 */

import { getServerClient } from '@/lib/supabase/server';
import { getActiveUser } from '@/lib/auth/session';
import { fromPostgresError, errors, toActionError } from '@/lib/errors';
import { validate, gifRefValidator } from '@/lib/validation/schemas';

export async function joinRandomQueue() {
  try {
    if (!(await getActiveUser())) throw errors.unauthenticated();
    const supabase = await getServerClient();
    const { data, error } = await supabase.rpc('join_random_queue');
    if (error) throw fromPostgresError(error, { rls: 'Random is not available for your account.' });
    return { ok: true, state: data };
  } catch (error) {
    return toActionError(error, 'Random could not be started.');
  }
}

export async function leaveRandomQueue() {
  try {
    if (!(await getActiveUser())) throw errors.unauthenticated();
    const supabase = await getServerClient();
    const { error } = await supabase.rpc('leave_random_queue');
    if (error) throw fromPostgresError(error);
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

export async function randomQueueState() {
  try {
    if (!(await getActiveUser())) throw errors.unauthenticated();
    const supabase = await getServerClient();
    const { data, error } = await supabase.rpc('random_queue_state');
    if (error) throw fromPostgresError(error);
    return { ok: true, state: data };
  } catch (error) {
    return toActionError(error);
  }
}

export async function randomSessionState(sessionId) {
  try {
    if (!(await getActiveUser())) throw errors.unauthenticated();
    const supabase = await getServerClient();
    const { data, error } = await supabase.rpc('random_session_state', { p_session: sessionId });
    if (error) throw fromPostgresError(error);
    return { ok: true, state: data };
  } catch (error) {
    return toActionError(error);
  }
}

export async function sendRandomMessage(formData) {
  try {
    if (!(await getActiveUser())) throw errors.unauthenticated();
    const sessionId = String(formData.get('session_id') || '');
    const checked = validate(
      { body: formData.get('body') || '', gif: formData.get('gif') || null },
      {
        body: (value) => {
          const text = String(value ?? '').trim();
          if (text.length > 2000) return { ok: false, error: 'That message is too long.' };
          return { ok: true, value: text };
        },
        gif: gifRefValidator,
      },
    );
    if (!checked.ok) throw errors.validation('Write a message or pick a GIF.', checked.errors);
    if (!checked.data.body && !checked.data.gif) throw errors.validation('Write a message or pick a GIF.');

    const supabase = await getServerClient();
    const { data, error } = await supabase.rpc('send_random_message', {
      p_session: sessionId,
      p_body: checked.data.body || null,
      p_gif: checked.data.gif || null,
    });
    if (error) throw fromPostgresError(error, { rls: 'That conversation is over.' });
    return { ok: true, message: data };
  } catch (error) {
    return toActionError(error, 'That message was not sent.');
  }
}

export async function endRandomSession(formData) {
  try {
    if (!(await getActiveUser())) throw errors.unauthenticated();
    const sessionId = String(formData.get('session_id') || '');
    const reason = ['left', 'ended', 'blocked'].includes(String(formData.get('reason')))
      ? String(formData.get('reason'))
      : 'ended';
    const supabase = await getServerClient();
    const { error } = await supabase.rpc('end_random_session', { p_session: sessionId, p_reason: reason });
    if (error) throw fromPostgresError(error);
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Report and block from inside a Random session. Reporting goes through
 * `report_random_session()` (which keeps the reporter's identity for
 * moderators); blocking is the normal block path.
 */
export async function reportRandomSession(formData) {
  try {
    if (!(await getActiveUser())) throw errors.unauthenticated();
    const sessionId = String(formData.get('session_id') || '');
    const reason = String(formData.get('reason') || 'other');
    const details = formData.get('details') ? String(formData.get('details')).slice(0, 1000) : null;
    const supabase = await getServerClient();
    const { error } = await supabase.rpc('report_random_session', {
      p_session: sessionId,
      p_reason: reason,
      p_details: details,
    });
    if (error) throw fromPostgresError(error);
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

export async function blockRandomPartner(formData) {
  try {
    const user = await getActiveUser();
    if (!user) throw errors.unauthenticated();
    const sessionId = String(formData.get('session_id') || '');
    const supabase = await getServerClient();

    // The partner id is resolved *inside the database* — the caller never sees it.
    const { data: partner, error: partnerError } = await supabase.rpc('random_other_participant', {
      p_session: sessionId,
    });
    if (partnerError || !partner) throw errors.forbidden('That conversation is no longer active.');

    const { error } = await supabase.from('blocks').insert({
      blocker_id: user.profile.id,
      blocked_id: partner,
      reason: 'Blocked from a Random conversation',
    });
    if (error) throw fromPostgresError(error);

    await supabase.rpc('end_random_session', { p_session: sessionId, p_reason: 'blocked' });
    return { ok: true };
  } catch (error) {
    return toActionError(error, 'That partner could not be blocked.');
  }
}
