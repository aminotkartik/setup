'use client';

import { useState } from 'react';
import { useFormAction } from '@/lib/forms';
import { votePoll } from '@/lib/actions/social';
import { compactNumber } from '@/lib/utils';
import { Icon } from '@/components/ui/icons';
import { Badge } from '@/components/ui';
import { cn } from '@/lib/utils';

/**
 * Poll rendering + voting. Totals come from the database (`poll_options.vote_count`
 * maintained by a trigger); a student sees their own vote, never a list of voters.
 */
export function PollBlock({ postId, poll, canVote = true }) {
  const { run, pending, error } = useFormAction(votePoll);
  const options = poll.options || [];
  const total = options.reduce((sum, option) => sum + (option.vote_count || 0), 0);
  const myOption = options.find((option) => option.mine)?.id || null;
  // Evaluated once when the component mounts: a render must stay pure. The
  // server also enforces `poll_closes_at` on every vote, so a stale `closed`
  // flag here is a display nicety, never a way to vote late.
  const [closed] = useState(() => (poll.closes_at ? new Date(poll.closes_at).getTime() < Date.now() : false));
  const showResults = Boolean(myOption) || closed;

  return (
    <div className="card-flush mt-3 p-3">
      <ul className="flex flex-col gap-2">
        {options.map((option) => {
          const count = option.vote_count || 0;
          const share = total ? Math.round((count / total) * 100) : 0;
          const mine = myOption === option.id;
          return (
            <li key={option.id}>
              <button
                type="button"
                disabled={!canVote || Boolean(myOption) || closed || pending || !option.id}
                onClick={() => {
                  const data = new FormData();
                  data.set('post_id', postId);
                  data.set('option_id', option.id);
                  run(data);
                }}
                className={cn(
                  'cp-poll-option group w-full overflow-hidden rounded-[var(--radius-sm)] border px-3 py-2 text-left transition-all',
                  mine ? 'cp-poll-option--selected' : null,
                  !canVote || myOption || closed ? 'cursor-default' : 'cursor-pointer active:scale-[0.995]',
                )}
                aria-pressed={mine}
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="min-w-0 truncate text-[0.8125rem] font-medium">{option.label}</span>
                    {mine ? <Icon name="check" size={13} className="shrink-0 text-accent" /> : null}
                  </span>
                  {showResults ? <span className="shrink-0 text-2xs font-semibold text-muted t-numeric">{share}%</span> : null}
                </span>
                {showResults ? (
                  <span className="cp-poll-track mt-2 block h-1.5 w-full overflow-hidden rounded-full">
                    <span
                      className={cn('cp-poll-fill block h-full rounded-full transition-[width] duration-500', mine ? 'cp-poll-fill--selected' : null)}
                      style={{ width: `${share}%` }}
                    />
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-2.5 flex flex-wrap items-center gap-1.5 text-2xs text-muted">
        <span className="t-numeric">
          {compactNumber(total)} vote{total === 1 ? '' : 's'}
        </span>
        <span aria-hidden="true">·</span>
        {closed ? <Badge tone="warning">Poll closed</Badge> : <span>One vote per student</span>}
      </p>
      {error ? <p className="mt-1 text-2xs text-danger">{error}</p> : null}
    </div>
  );
}
