'use client';

import { useState } from 'react';
import { useFormAction } from '@/lib/forms';
import { reportContent } from '@/lib/actions/social';
import { REPORT_REASONS } from '@/lib/constants';
import { Button, Field, Modal, Notice, Select, Textarea } from '@/components/ui';

/**
 * The single report dialog.
 *
 * One component, one data shape, every target type: posts, comments, users,
 * listings, communities, messages, gigs, projects, opportunities. It never
 * changes UI based on who is looking — reporting a blocked person stays
 * available on purpose (a safety path, not an interaction).
 *
 * On phones this is a bottom sheet; on desktop it is a centred dialog. The same
 * `Modal` primitive handles focus, Escape and the backdrop.
 */
export function ReportDialog({ targetType, targetRef, label, sessionId = null, variant: _variant = 'ghost', size: _size = 'sm', className = '' }) {
  const [open, setOpen] = useState(false);
  const { run, pending, error, success } = useFormAction(reportContent, {
    onSuccess: () => setTimeout(() => setOpen(false), 1400),
  });

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className={
          className ||
          'rounded-full border border-line px-2 py-0.5 text-2xs font-semibold text-muted transition-colors hover:border-line-strong hover:text-ink'
        }
      >
        Report
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Report ${label || targetType}`}
        description="A moderator reviews every report. Your identity is visible to them, not to the person you are reporting."
        size="md"
      >
        {success ? (
          <Notice tone="success" className="mt-4" icon="checkCircle">
            Thanks — the report is in the moderation queue.
          </Notice>
        ) : (
          <form
            action={run}
            className="mt-4 flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              data.set('target_type', targetType);
              data.set('target_ref', targetRef);
              if (sessionId) data.set('session_id', sessionId);
              run(data);
            }}
          >
            <Field label="Reason" htmlFor={`report-reason-${targetType}`} required>
              <Select id={`report-reason-${targetType}`} name="reason" required defaultValue="">
                <option value="" disabled>
                  Choose a reason
                </option>
                {REPORT_REASONS.map((reason) => (
                  <option key={reason.value} value={reason.value}>
                    {reason.label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label="Anything the moderator should know"
              htmlFor={`report-details-${targetType}`}
              hint="Optional · 1000 characters"
            >
              <Textarea id={`report-details-${targetType}`} name="details" rows={3} maxLength={1000} />
            </Field>

            {error ? (
              <Notice tone="danger" icon="flag">
                {error}
              </Notice>
            ) : null}

            <div className="dialog-actions">
              <Button variant="ghost" type="button" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" icon="flag" loading={pending}>
                {pending ? 'Sending…' : 'Submit report'}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
