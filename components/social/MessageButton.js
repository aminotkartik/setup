'use client';

/**
 * "Message @someone" — the single way every surface starts a DM:
 * marketplace sellers, event organizers, club contacts, project creators, gig
 * posters, lost & found posters and team finders all use this same button.
 */

import { Button } from '@/components/ui';
import { useFormAction } from '@/lib/forms';
import { startConversation } from '@/lib/actions/messaging';
import { ROUTES } from '@/lib/constants';

export function MessageButton({
  profileId,
  label = 'Message',
  variant = 'primary',
  size = 'sm',
  icon = 'send',
  disabledReason = null,
  className = '',
}) {
  const start = useFormAction(startConversation, { redirectTo: (result) => result.href || ROUTES.chat });

  if (!profileId || disabledReason) {
    return (
      <span className={`text-2xs text-muted ${className}`} title={disabledReason || undefined}>
        {disabledReason || 'Messaging unavailable'}
      </span>
    );
  }

  return (
    <form
      action={(formData) => {
        formData.set('profile_id', profileId);
        start.run(formData);
      }}
      className={className}
    >
      <Button type="submit" variant={variant} size={size} icon={icon} loading={start.pending}>
        {start.pending ? 'Opening…' : label}
      </Button>
      {start.error ? <span className="ml-2 text-2xs text-danger">{start.error}</span> : null}
    </form>
  );
}
