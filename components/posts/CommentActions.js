'use client';

import { useState } from 'react';
import { useFormAction } from '@/lib/forms';
import { deleteComment } from '@/lib/actions/social';
import { Button } from '@/components/ui';

/** Delete your own comment (soft delete — moderation evidence is preserved). */
export function CommentActions({ commentId, postId }) {
  const { run, pending, error } = useFormAction(deleteComment);
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
        Delete
      </Button>
    );
  }

  return (
    <span className="flex items-center gap-2">
      <span className="text-2xs text-muted">Delete?</span>
      <Button
        variant="danger"
        size="sm"
        disabled={pending}
        onClick={() => {
          const data = new FormData();
          data.set('id', commentId);
          data.set('post_id', postId);
          run(data);
        }}
      >
        Yes
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
        No
      </Button>
      {error ? <span className="text-2xs text-danger">{error}</span> : null}
    </span>
  );
}
