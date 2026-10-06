'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormAction } from '@/lib/forms';
import { reportContent } from '@/lib/actions/social';
import { REPORT_REASONS } from '@/lib/constants';
import { Button, Field, Notice, Select, Textarea } from '@/components/ui';
import { Icon } from '@/components/ui/icons';

/**
 * The single report dialog (spec §49).
 *
 * One component, one data shape, every target type: posts, comments, users,
 * listings, communities, messages, gigs, projects, opportunities, Random
 * sessions. It never changes UI based on who is looking — reporting a blocked
 * person stays available on purpose (a safety path, not an interaction).
 */
export function ReportDialog({
  targetType,
  targetRef,
  label,
  sessionId = null,
  variant = 'ghost',
  size = 'sm',
  className = '',
}) {
  const [open, setOpen] = useState(false);
  const { run, pending, error, success } = useFormAction(reportContent, {
    onSuccess: () => setTimeout(() => setOpen(false), 1200),
  });
  const panelRef = useRef(null);
  const triggerRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    panelRef.current?.querySelector('select')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <Button
        ref={triggerRef}
        type="button"
        variant={variant}
        size={size}
        className={className}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        Report
      </Button>

      {open ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/20 p-0 sm:items-center sm:p-4">
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={`Report ${label || targetType}`}
            className="card w-full max-w-md rounded-b-none p-5 sm:rounded-b-xl"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">Report {label || 'content'}</h2>
                <p className="mt-0.5 text-2xs text-muted">
                  A moderator reviews every report. Your identity is visible to them, not to the
                  person you are reporting.
                </p>
              </div>
              <Button variant="ghost" size="sm" icon="close" aria-label="Close" onClick={() => setOpen(false)} />
            </div>

            {success ? (
              <Notice tone="success" className="mt-4" icon="check">
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

                <Field label="Anything the moderator should know" htmlFor={`report-details-${targetType}`} hint="Optional · 1000 characters">
                  <Textarea id={`report-details-${targetType}`} name="details" rows={3} maxLength={1000} />
                </Field>

                {error ? (
                  <Notice tone="danger" icon="flag">
                    {error}
                  </Notice>
                ) : null}

                <div className="flex justify-end gap-2">
                  <Button variant="ghost" type="button" onClick={() => setOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={pending}>
                    {pending ? 'Sending…' : 'Submit report'}
                    {!pending ? <Icon name="flag" size={15} /> : null}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
