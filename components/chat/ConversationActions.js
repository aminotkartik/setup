'use client';

/**
 * Thread-level safety actions (spec §21, §24, §60): report the conversation,
 * report the other student, or block them through the central block path.
 */

import { useState } from 'react';
import { Button } from '@/components/ui';
import { ReportDialog } from '@/components/social/ReportDialog';
import { useFormAction } from '@/lib/forms';
import { blockProfile } from '@/lib/actions/profile';
import { ROUTES } from '@/lib/constants';

export function ConversationActions({
  conversationId,
  otherProfileId = null,
  otherUsername = null,
  canReport = true,
  canBlock = false,
}) {
  const [confirming, setConfirming] = useState(false);
  const block = useFormAction(blockProfile, { redirectTo: ROUTES.chat });

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {canReport ? (
        <ReportDialog targetType="conversation" targetRef={conversationId} label="this conversation" />
      ) : null}
      {canReport && otherProfileId ? (
        <ReportDialog targetType="user" targetRef={otherProfileId} label={otherUsername ? `@${otherUsername}` : 'this student'} />
      ) : null}
      {canBlock && otherProfileId ? (
        confirming ? (
          <form
            action={(formData) => {
              formData.set('profile_id', otherProfileId);
              block.run(formData);
            }}
            className="flex items-center gap-2"
          >
            <span className="text-2xs text-muted">Block this student?</span>
            <Button type="submit" size="sm" variant="danger" disabled={block.pending}>
              {block.pending ? 'Blocking…' : 'Yes, block'}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </form>
        ) : (
          <Button size="sm" variant="ghost" icon="lock" onClick={() => setConfirming(true)}>
            Block
          </Button>
        )
      ) : null}
      {block.error ? <p className="text-2xs text-danger">{block.error}</p> : null}
    </div>
  );
}
