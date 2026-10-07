'use client';

/**
 * Thread-level safety actions (spec §21, §24, §60): report the conversation,
 * report the other student, or block them through the central block path.
 */

import { useState } from 'react';
import { Button, KeycapButton } from '@/components/ui';
import { ReportDialog } from '@/components/social/ReportDialog';
import { useFormAction } from '@/lib/forms';
import { blockProfile } from '@/lib/actions/profile';
import { ROUTES } from '@/lib/constants';

export function ConversationActions({
  conversationId,
  otherProfileId = null,
  canReport = true,
  canBlock = false,
}) {
  const [confirming, setConfirming] = useState(false);
  const block = useFormAction(blockProfile, { redirectTo: ROUTES.chat });

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {/*
        One report entry point for the whole thread (not one more for "the
        other student" too, and not one per message in the thread below).
        It also has to be "conversation", not "user": staff can only read
        conversation/message rows while a report with target_type
        'conversation' or 'message' is open against them
        (messages_select_staff_on_report / conversations_select_staff_on_report
        in migration 007) — a target_type 'user' report never unlocks that
        window, so it would let someone report a DM without a moderator ever
        being able to see what was actually said.
      */}
      {canReport ? (
        <ReportDialog targetType="conversation" targetRef={conversationId} label="this conversation" />
      ) : null}
      {canBlock && otherProfileId ? (
        confirming ? (
          <form
            action={(formData) => {
              formData.set('profile_id', otherProfileId);
              block.run(formData);
            }}
            className="flex flex-wrap items-center gap-2"
          >
            <span className="text-2xs font-medium text-muted">Block this student?</span>
            <Button type="submit" size="sm" variant="danger" loading={block.pending}>
              {block.pending ? 'Blocking…' : 'Yes, block'}
            </Button>
            <KeycapButton type="button" onClick={() => setConfirming(false)} aria-label="Cancel blocking">
              Esc
            </KeycapButton>
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
