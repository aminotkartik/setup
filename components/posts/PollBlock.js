'use client';

import { useState } from 'react';
import { useFormAction } from '@/lib/forms';
import { votePoll } from '@/lib/actions/social';
import { compactNumber } from '@/lib/utils';

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
  // server also enforces `poll_closes_at` on every vote (migration 005), so a
  // stale `closed` flag here is a display nicety, never a way to vote late.
  const [closed] = useState(() => (poll.closes_at ? new Date(poll.closes_at).getTime() < Date.now() : false));
  const showResults = Boolean(myOption) || closed;

  return (
    <div className="mt-3 rounded-lg border border-line p-3">
      <ul className="flex flex-col gap-2">
        {options.map((option) => {
          const count = option.vote_count || 0;
          const share = total ? Math.round((count / total) * 100) : 0;
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
                className="w-full rounded-md border border-line px-2.5 py-1.5 text-left text-[0.8125rem] hover:border-muted disabled:cursor-default"
                aria-pressed={myOption === option.id}
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate">
                    {option.label}
                    {myOption === option.id ? <span className="ml-1.5 text-2xs text-muted">your vote</span> : null}
                  </span>
                  {showResults ? <span className="shrink-0 text-2xs text-muted">{share}%</span> : null}
                </span>
                {showResults ? (
                  <span className="mt-1.5 block h-1 w-full overflow-hidden rounded-full bg-canvas">
                    <span className="block h-full rounded-full bg-accent" style={{ width: `${share}%` }} />
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-2xs text-muted">
        {compactNumber(total)} vote{total === 1 ? '' : 's'} · {closed ? 'Poll closed' : 'One vote per student'}
      </p>
      {error ? <p className="mt-1 text-2xs text-danger">{error}</p> : null}
    </div>
  );
}
