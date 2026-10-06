'use client';

/**
 * Moderator controls (spec §51, §52).
 *
 * Every control calls a server action that re-checks the caller's permission and
 * writes an audit entry. The UI chooses which verbs to offer; the database
 * decides which verbs are allowed.
 */

import { Select, Textarea, Button, Field, Notice } from '@/components/ui';
import { useFormAction } from '@/lib/forms';
import { moderateContent, resolveReport, moderateListing, reviewRandomReport } from '@/lib/actions/moderation';

const VERB_LABELS = {
  hide: 'Hide content',
  remove: 'Remove content',
  restore: 'Restore content',
  approve: 'Approve',
  reject: 'Reject',
  none: 'No action on the content',
};

export function ModerationActions({
  targetType,
  targetRef,
  reportId = null,
  allowed = ['hide', 'remove', 'restore'],
  title = 'Moderate this content',
}) {
  const action = useFormAction(moderateContent, { resetOnSuccess: false });

  return (
    <form
      className="card flex flex-col gap-2 p-3"
      action={(formData) => {
        formData.set('target_type', targetType);
        formData.set('target_ref', targetRef);
        if (reportId) formData.set('report_id', reportId);
        action.run(formData);
      }}
    >
      <h3 className="text-[0.8125rem] font-semibold">{title}</h3>
      <Field label="Action" htmlFor={`moderation-action-${targetRef}`}>
        <Select id={`moderation-action-${targetRef}`} name="action" defaultValue={allowed[0]} required>
          {allowed.map((verb) => (
            <option key={verb} value={verb}>
              {VERB_LABELS[verb] || verb}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Reason for the student" htmlFor={`moderation-reason-${targetRef}`} hint="Shown in the author's notification when content is hidden or removed.">
        <Textarea id={`moderation-reason-${targetRef}`} name="reason" rows={2} maxLength={500} />
      </Field>
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={action.pending}>
          {action.pending ? 'Applying…' : 'Apply'}
        </Button>
      </div>
      {action.error ? <Notice tone="danger">{action.error}</Notice> : null}
      {action.success ? <Notice tone="success">Done. The action is in the audit log.</Notice> : null}
    </form>
  );
}

export function ResolveReportForm({ reportId, allowed = ['hide', 'remove', 'restore', 'none'] }) {
  const resolve = useFormAction(resolveReport, { resetOnSuccess: false });

  return (
    <form
      className="card flex flex-col gap-2 p-3"
      action={(formData) => {
        formData.set('report_id', reportId);
        resolve.run(formData);
      }}
    >
      <h3 className="text-[0.8125rem] font-semibold">Close this report</h3>
      <Field label="Outcome" htmlFor={`report-status-${reportId}`}>
        <Select id={`report-status-${reportId}`} name="status" defaultValue="resolved" required>
          <option value="resolved">Resolved</option>
          <option value="dismissed">Dismissed</option>
          <option value="reviewing">Still reviewing</option>
        </Select>
      </Field>
      <Field label="Action on the content" htmlFor={`report-action-${reportId}`}>
        <Select id={`report-action-${reportId}`} name="target_action" defaultValue="none">
          {allowed.map((verb) => (
            <option key={verb} value={verb}>
              {VERB_LABELS[verb] || verb}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Resolution" htmlFor={`report-resolution-${reportId}`} hint="The reporter is notified with this text.">
        <Textarea id={`report-resolution-${reportId}`} name="resolution" rows={2} maxLength={1000} />
      </Field>
      <Button type="submit" size="sm" disabled={resolve.pending}>
        {resolve.pending ? 'Saving…' : 'Save decision'}
      </Button>
      {resolve.error ? <Notice tone="danger">{resolve.error}</Notice> : null}
      {resolve.success ? <Notice tone="success">Report closed.</Notice> : null}
    </form>
  );
}

export function MarketplaceReviewActions({ listingId, currentStatus }) {
  const review = useFormAction(moderateListing, { resetOnSuccess: false });
  const options = currentStatus === 'pending'
    ? ['approve', 'reject']
    : ['hide', 'restore', 'remove'];

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      action={(formData) => {
        formData.set('listing_id', listingId);
        review.run(formData);
      }}
    >
      <Select name="action" defaultValue={options[0]} aria-label="Listing action" className="w-auto">
        {options.map((verb) => (
          <option key={verb} value={verb}>
            {VERB_LABELS[verb] || verb}
          </option>
        ))}
      </Select>
      <input
        name="reason"
        maxLength={500}
        placeholder="Reason (optional)"
        className="min-w-[10rem] flex-1 rounded-lg border border-line bg-white px-2 py-1.5 text-[0.8125rem]"
      />
      <Button type="submit" size="sm" disabled={review.pending}>
        {review.pending ? 'Applying…' : 'Apply'}
      </Button>
      {review.error ? <Notice tone="danger">{review.error}</Notice> : null}
    </form>
  );
}

export function RandomReportActions({ reportId }) {
  const review = useFormAction(reviewRandomReport, { resetOnSuccess: false });
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      action={(formData) => {
        formData.set('report_id', reportId);
        review.run(formData);
      }}
    >
      <Select name="status" defaultValue="reviewing" aria-label="Random report status" className="w-auto">
        <option value="reviewing">Reviewing</option>
        <option value="resolved">Resolved</option>
        <option value="dismissed">Dismissed</option>
      </Select>
      <input
        name="resolution"
        maxLength={1000}
        placeholder="Resolution note"
        className="min-w-[10rem] flex-1 rounded-lg border border-line bg-white px-2 py-1.5 text-[0.8125rem]"
      />
      <Button type="submit" size="sm" disabled={review.pending}>
        {review.pending ? 'Saving…' : 'Save'}
      </Button>
      {review.error ? <Notice tone="danger">{review.error}</Notice> : null}
    </form>
  );
}
