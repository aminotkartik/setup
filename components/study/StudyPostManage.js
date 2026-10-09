'use client';

/**
 * Owner controls for a study request: close it when the group is full, reopen
 * it when plans change. The server re-checks ownership; RLS enforces it.
 */

import { Button } from '@/components/ui';
import { useFormAction } from '@/lib/forms';
import { closeStudyPost, reopenStudyPost } from '@/lib/actions/campus';

export function StudyPostManage({ postId, closed }) {
  const close = useFormAction(closeStudyPost, { resetOnSuccess: false });
  const reopen = useFormAction(reopenStudyPost, { resetOnSuccess: false });
  const state = closed ? reopen : close;

  return (
    <form
      action={(formData) => {
        formData.set('id', postId);
        state.run(formData);
      }}
      className="flex flex-wrap items-center gap-2"
    >
      <Button type="submit" size="sm" variant="secondary" loading={state.pending}>
        {state.pending ? 'Saving…' : closed ? 'Reopen request' : 'Close request'}
      </Button>
      {state.error ? <span className="text-2xs text-danger">{state.error}</span> : null}
      {state.success ? <span className="text-2xs text-success">{closed ? 'Reopened.' : 'Closed.'}</span> : null}
    </form>
  );
}
