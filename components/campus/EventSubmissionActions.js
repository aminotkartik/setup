'use client';

/**
 * Review controls for student event submissions.
 *
 * Staff publish (provenance stays community) or decline; the submitter can
 * withdraw their own draft. Every path re-checks server-side through RLS.
 */

import { Button } from '@/components/ui';
import { useFormAction } from '@/lib/forms';
import { publishEventSubmission, rejectEventSubmission, withdrawEventSubmission } from '@/lib/actions/campus';

export function EventReviewActions({ eventId }) {
  const publish = useFormAction(publishEventSubmission, { resetOnSuccess: false });
  const reject = useFormAction(rejectEventSubmission, { resetOnSuccess: false });

  return (
    <span className="flex flex-wrap items-center gap-2">
      <form action={(formData) => { formData.set('id', eventId); publish.run(formData); }}>
        <Button type="submit" size="sm" variant="primary" loading={publish.pending}>
          {publish.pending ? 'Publishing…' : 'Publish as student-organized'}
        </Button>
      </form>
      <form action={(formData) => { formData.set('id', eventId); reject.run(formData); }}>
        <Button type="submit" size="sm" variant="ghost" loading={reject.pending}>
          {reject.pending ? 'Declining…' : 'Decline'}
        </Button>
      </form>
      {publish.error ? <span className="text-2xs text-danger">{publish.error}</span> : null}
      {reject.error ? <span className="text-2xs text-danger">{reject.error}</span> : null}
      {publish.success ? <span className="text-2xs text-success">Published.</span> : null}
      {reject.success ? <span className="text-2xs text-success">Declined.</span> : null}
    </span>
  );
}

export function EventWithdrawAction({ eventId }) {
  const withdraw = useFormAction(withdrawEventSubmission, { resetOnSuccess: false });

  return (
    <form action={(formData) => { formData.set('id', eventId); withdraw.run(formData); }}>
      <Button type="submit" size="sm" variant="ghost" loading={withdraw.pending}>
        {withdraw.pending ? 'Withdrawing…' : 'Withdraw submission'}
      </Button>
      {withdraw.error ? <span className="ml-2 text-2xs text-danger">{withdraw.error}</span> : null}
    </form>
  );
}
