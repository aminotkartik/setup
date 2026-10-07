'use client';

/**
 * Actions available on another student's profile (spec §12, §22, §60).
 *
 * Message reuses the single DM system, Block uses the central block logic
 * (server-side, via `blockProfile`) and Report uses the one ReportDialog.
 * Nothing here is a UI-only guarantee: every button calls a server action that
 * re-checks permissions and relationships.
 */

import { useState } from 'react';
import { Button, KeycapButton, LinkButton } from '@/components/ui';
import { ReportDialog } from '@/components/social/ReportDialog';
import { useFormAction } from '@/lib/forms';
import { startConversation } from '@/lib/actions/messaging';
import { blockProfile, unblockProfile } from '@/lib/actions/profile';
import { ROUTES } from '@/lib/constants';

export function ProfileActions({
  profileId,
  username,
  isSelf = false,
  isBlocked = false,
  canMessage = false,
  canBlock = false,
  canReport = false,
}) {
  // Confirming a *block* (the destructive direction); unblocking runs directly.
  const [confirmBlock, setConfirmBlock] = useState(false);

  const message = useFormAction(startConversation, { redirectTo: (result) => result.href || ROUTES.chat });
  const block = useFormAction(blockProfile, { redirectTo: ROUTES.home });
  const unblock = useFormAction(unblockProfile, {
    onSuccess: () => setConfirmBlock(false),
  });

  if (isSelf) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <LinkButton href={ROUTES.settings} variant="secondary" size="sm" icon="settings">
          Edit profile
        </LinkButton>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {canMessage ? (
          <form
            action={(formData) => {
              formData.set('profile_id', profileId);
              message.run(formData);
            }}
          >
            <Button type="submit" size="sm" icon="send" disabled={message.pending}>
              {message.pending ? 'Opening…' : 'Message'}
            </Button>
          </form>
        ) : null}

        {canBlock && isBlocked ? (
          <form
            action={(formData) => {
              formData.set('profile_id', profileId);
              unblock.run(formData);
            }}
          >
            <Button type="submit" variant="secondary" size="sm" disabled={unblock.pending}>
              {unblock.pending ? 'Unblocking…' : 'Unblock'}
            </Button>
          </form>
        ) : null}

        {canBlock && !isBlocked && !confirmBlock ? (
          <Button variant="secondary" size="sm" icon="lock" onClick={() => setConfirmBlock(true)}>
            Block
          </Button>
        ) : null}

        {canReport ? <ReportDialog targetType="user" targetRef={profileId} label={`@${username}`} /> : null}
      </div>

      {canBlock && !isBlocked && confirmBlock ? (
        <form
          action={(formData) => {
            formData.set('profile_id', profileId);
            block.run(formData);
          }}
          className="card max-w-xs p-3.5 text-left"
        >
          <p className="text-[0.8125rem] leading-relaxed">
            Blocking hides @{username} from you and stops messages in both directions. They are not told.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button type="submit" variant="danger" size="sm" loading={block.pending}>
              {block.pending ? 'Blocking…' : `Block @${username}`}
            </Button>
            <KeycapButton type="button" onClick={() => setConfirmBlock(false)} aria-label="Cancel blocking">
              Esc
            </KeycapButton>
          </div>
        </form>
      ) : null}

      {message.error ? <p className="text-2xs text-danger">{message.error}</p> : null}
      {block.error ? <p className="text-2xs text-danger">{block.error}</p> : null}
      {unblock.error ? <p className="text-2xs text-danger">{unblock.error}</p> : null}
    </div>
  );
}
