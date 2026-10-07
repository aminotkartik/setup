'use client';

import { useState } from 'react';
import { useFormAction } from '@/lib/forms';
import { deletePost, restorePost } from '@/lib/actions/social';
import { Button, DeleteButton, KeycapButton, Notice } from '@/components/ui';

/**
 * Author controls for a post: soft delete (evidence-preserving) and restore.
 * A moderator's own controls live in the moderation panel, not here.
 *
 * Destructive intent gets the tactile delete material; the confirmation itself
 * is a deliberate keycap, never a second destructive-looking button.
 */
export function PostActions({ postId, status = 'published', canManage = false }) {
  const { run, pending, error } = useFormAction(deletePost);
  const { run: runRestore, pending: restoring, error: restoreError } = useFormAction(restorePost);
  const [confirming, setConfirming] = useState(false);

  if (!canManage) return null;

  if (status === 'deleted') {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" icon="refresh" disabled={restoring} onClick={() => runRestore(form(postId))}>
          Restore
        </Button>
        {restoreError ? <span className="text-2xs text-danger">{restoreError}</span> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {confirming ? (
        <>
          <span className="text-2xs font-medium text-muted">Delete this post?</span>
          <KeycapButton
            tone="accent"
            disabled={pending}
            aria-label="Confirm delete"
            onClick={() => run(form(postId))}
          >
            {pending ? '…' : 'OK'}
          </KeycapButton>
          <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </>
      ) : (
        <DeleteButton size="sm" onClick={() => setConfirming(true)}>
          Delete
        </DeleteButton>
      )}
      {error ? (
        <Notice tone="danger" className="w-full">
          {error}
        </Notice>
      ) : null}
    </div>
  );
}

function form(id) {
  const data = new FormData();
  data.set('id', id);
  return data;
}
