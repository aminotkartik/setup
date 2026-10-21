'use client';

/**
 * The controls on a gig detail page.
 *
 * Three audiences, one component:
 *   - the poster manages the lifecycle (open → closed → completed), edits and
 *     deletes their own gig;
 *   - a signed-in student applies once and then sees the outcome;
 *   - a moderator gets the report path (rendered by the page) and nothing else.
 *
 * Every mutation is a server action; RLS and the guard trigger decide whether
 * it is allowed.
 */

import { useState } from 'react';
import { Badge, Button, DeleteButton, KeycapButton, LinkButton, Notice } from '@/components/ui';
import { MessageButton } from '@/components/social/MessageButton';
import { useFormAction } from '@/lib/forms';
import {
  applyToGig,
  decideGigApplication,
  deleteGig,
  setGigState,
  withdrawGigApplication,
} from '@/lib/actions/marketplace';
import { ROUTES, GIG_STATES } from '@/lib/constants';

const APPLICATION_LABEL = {
  pending: 'Application sent — the poster will reply in Messages.',
  accepted: 'Your application was accepted. Coordinate the details in Messages.',
  declined: 'The poster declined this application.',
  withdrawn: 'You withdrew this application.',
};

export function GigActions({ gig, creatorId, canApply, myApplication = null }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const state = useFormAction(setGigState);
  const remove = useFormAction(deleteGig, { redirectTo: ROUTES.gigs });
  const apply = useFormAction(applyToGig, { resetOnSuccess: true });
  const withdraw = useFormAction(withdrawGigApplication);
  const [writing, setWriting] = useState(false);

  const move = (next) => {
    const formData = new FormData();
    formData.set('id', gig.id);
    formData.set('state', next);
    state.run(formData);
  };

  const canAccept = gig.status === 'published' && gig.state !== 'completed';

  return (
    <div className="flex flex-col gap-3">
      {creatorId === gig.creator_id ? (
        <section aria-label="Manage this gig" className="flex flex-wrap items-center gap-2">
          <LinkButton href={ROUTES.gigEdit(gig.id)} size="sm" variant="secondary" icon="sliders">
            Edit gig
          </LinkButton>

          {gig.state === 'open' ? (
            <Button type="button" size="sm" variant="ghost" loading={state.pending} onClick={() => move('closed')}>
              Mark closed
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={!canAccept}
              loading={state.pending}
              onClick={() => move('open')}
            >
              Reopen
            </Button>
          )}

          {gig.state !== 'completed' ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              icon="checkCircle"
              loading={state.pending}
              onClick={() => move('completed')}
            >
              Mark completed
            </Button>
          ) : null}

          {confirmDelete ? (
            <span className="flex items-center gap-2">
              <span className="text-2xs font-medium text-muted">Delete this gig?</span>
              <Button type="button" size="sm" variant="danger" loading={remove.pending} onClick={() => remove.run(new FormData())}>
                Yes, delete
              </Button>
              <KeycapButton type="button" onClick={() => setConfirmDelete(false)} aria-label="Cancel delete">
                Esc
              </KeycapButton>
            </span>
          ) : (
            <DeleteButton size="sm" onClick={() => setConfirmDelete(true)}>
              Delete
            </DeleteButton>
          )}

          {state.error ? <Notice tone="danger">{state.error}</Notice> : null}
          {remove.error ? <Notice tone="danger">{remove.error}</Notice> : null}
          <p className="w-full text-2xs text-muted">
            {GIG_STATES.find((entry) => entry.value === gig.state)?.description}. Closed and completed gigs stay on
            the board with their status, so nobody applies to work that has ended.
          </p>
        </section>
      ) : null}

      {canApply && creatorId !== gig.creator_id ? (
        <section id="apply" aria-label="Apply to this gig" className="card scroll-mt-24 flex flex-col gap-2 p-3">
          {myApplication ? (
            <>
              <p className="text-[0.8125rem]">
                <strong className="font-semibold">{APPLICATION_LABEL[myApplication.status] || 'Application sent.'}</strong>
              </p>
              {myApplication.status === 'pending' || myApplication.status === 'accepted' ? (
                <form
                  action={(formData) => {
                    formData.set('id', myApplication.id);
                    withdraw.run(formData);
                  }}
                >
                  <Button type="submit" size="sm" variant="ghost" loading={withdraw.pending}>
                    {withdraw.pending ? 'Withdrawing…' : 'Withdraw application'}
                  </Button>
                </form>
              ) : null}
              {withdraw.error ? <Notice tone="danger">{withdraw.error}</Notice> : null}
            </>
          ) : gig.status === 'published' && gig.state === 'open' ? (
            writing ? (
              <form
                className="flex flex-col gap-2"
                action={(formData) => {
                  formData.set('gig_id', gig.id);
                  apply.run(formData);
                }}
              >
                <label htmlFor="gig-application-message" className="field-label">
                  Why you are a good fit
                </label>
                <textarea
                  id="gig-application-message"
                  name="message"
                  rows={4}
                  required
                  minLength={5}
                  maxLength={1000}
                  className="control control-textarea"
                  placeholder="What you can do, when you are free, and how to reach you."
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="submit" size="sm" tone="accent" loading={apply.pending}>
                    {apply.pending ? 'Sending…' : 'Send application'}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setWriting(false)}>
                    Cancel
                  </Button>
                </div>
                {apply.fieldErrors?.message ? <p className="field-error">{apply.fieldErrors.message}</p> : null}
                {apply.error ? <Notice tone="danger">{apply.error}</Notice> : null}
              </form>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[0.8125rem] text-muted">
                  Send a short application. The poster sees it here and in their notifications.
                </p>
                <Button type="button" size="sm" tone="accent" icon="send" onClick={() => setWriting(true)}>
                  Apply for this gig
                </Button>
              </div>
            )
          ) : (
            <p className="text-[0.8125rem] text-muted">
              {gig.state === 'completed' ? 'This gig has been completed.' : 'This gig is closed to new applications.'}
            </p>
          )}
        </section>
      ) : null}
    </div>
  );
}

/**
 * The poster's inbox for one gig: who applied, what they said, and the decision.
 * Accepting or declining notifies the applicant through the one notification
 * system.
 */
export function GigApplications({ applications = [], gigId }) {
  const decide = useFormAction(decideGigApplication);

  if (!applications.length) {
    return (
      <p className="text-[0.8125rem] text-muted">
        No applications yet. Students who apply from this page appear here.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {applications.map((application) => (
        <li key={application.id} className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-line p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[0.8125rem] font-semibold">
              {application.display_name || 'Student'}
              {application.username ? <span className="ml-1 font-normal text-muted">@{application.username}</span> : null}
            </span>
            <Badge
              tone={
                application.status === 'accepted'
                  ? 'success'
                  : application.status === 'declined'
                    ? 'danger'
                    : application.status === 'withdrawn'
                      ? 'neutral'
                      : 'info'
              }
            >
              {application.status}
            </Badge>
            <span className="ml-auto text-2xs text-muted">{new Date(application.created_at).toLocaleDateString('en-IN')}</span>
          </div>
          <p className="user-text text-[0.8125rem] leading-relaxed text-muted">{application.message}</p>
          {application.status === 'pending' ? (
            <div className="flex flex-wrap items-center gap-2">
              {['accepted', 'declined'].map((decision) => (
                <form
                  key={decision}
                  action={(formData) => {
                    formData.set('id', application.id);
                    formData.set('decision', decision);
                    decide.run(formData);
                  }}
                >
                  <Button
                    type="submit"
                    size="sm"
                    variant={decision === 'accepted' ? 'primary' : 'ghost'}
                    tone={decision === 'accepted' ? 'accent' : undefined}
                    disabled={decide.pending}
                  >
                    {decision === 'accepted' ? 'Accept' : 'Decline'}
                  </Button>
                </form>
              ))}
              <MessageButton profileId={application.applicant_id} label="Message applicant" variant="ghost" />
            </div>
          ) : null}
        </li>
      ))}
      {decide.error ? <Notice tone="danger">{decide.error}</Notice> : null}
      <li className="text-2xs text-muted">
        Accepting notifies the applicant. Contact continues in Messages — gig {gigId ? 'details stay on this page' : ''}.
      </li>
    </ul>
  );
}
