'use client';

import { useState } from 'react';
import { useFormAction } from '@/lib/forms';
import { toggleReaction } from '@/lib/actions/social';
import { cn, compactNumber } from '@/lib/utils';
import { Icon } from '@/components/ui/icons';

/**
 * One reaction control. Optimistic count, then the database's trigger
 * recomputes the stored counter — the number shown is never client-invented.
 */
export function ReactionBar({ targetType, targetId, count = 0, reactedByMe = false, canReact = true, className = '' }) {
  const [state, setState] = useState({ count, reacted: reactedByMe });
  const { run, pending } = useFormAction(toggleReaction);

  return (
    <button
      type="button"
      disabled={!canReact || pending}
      aria-pressed={state.reacted}
      aria-label={state.reacted ? 'Remove reaction' : 'React to this'}
      className={cn('chip chip-toggle', !canReact ? 'cursor-default opacity-70' : null, className)}
      onClick={() => {
        const next = { count: state.count + (state.reacted ? -1 : 1), reacted: !state.reacted };
        setState(next);
        const data = new FormData();
        data.set('target_type', targetType);
        data.set('target_id', targetId);
        run(data);
      }}
    >
      <Icon name="heart" size={13} className={cn('transition-transform', state.reacted ? 'scale-110' : null)} />
      {state.count > 0 ? compactNumber(state.count) : 'Like'}
    </button>
  );
}
