'use client';

/**
 * The action row shared by student campus posts (lost & found, housing, rides,
 * team finder): contact the poster through a normal DM, report the post, and —
 * for lost & found — mark your own report resolved.
 */

import { Button } from '@/components/ui';
import { MessageButton } from '@/components/social/MessageButton';
import { ReportDialog } from '@/components/social/ReportDialog';
import { useFormAction } from '@/lib/forms';
import { resolveLostFound } from '@/lib/actions/campus';

export function PostActionsRow({
  creatorId,
  creatorUsername = null,
  isOwner = false,
  canReport = false,
  canMessage = true,
  reportType = null,
  reportRef = null,
  canResolve = false,
}) {
  const resolve = useFormAction(resolveLostFound, { resetOnSuccess: false });

  return (
    <span className="flex flex-wrap items-center gap-2">
      {!isOwner && canMessage ? <MessageButton profileId={creatorId} label="Message" variant="secondary" size="sm" /> : null}
      {isOwner && canResolve ? (
        <form
          action={(formData) => {
            formData.set('id', reportRef);
            resolve.run(formData);
          }}
        >
          <Button type="submit" size="sm" variant="secondary" disabled={resolve.pending}>
            {resolve.pending ? 'Saving…' : 'Mark as resolved'}
          </Button>
        </form>
      ) : null}
      {!isOwner && canReport && reportType ? (
        <ReportDialog targetType={reportType} targetRef={reportRef} label="this post" />
      ) : null}
      {!isOwner && canReport && !reportType && creatorId ? (
        <ReportDialog targetType="user" targetRef={creatorId} label={creatorUsername ? `@${creatorUsername}` : 'this student'} />
      ) : null}
      {resolve.error ? <span className="text-2xs text-danger">{resolve.error}</span> : null}
    </span>
  );
}
