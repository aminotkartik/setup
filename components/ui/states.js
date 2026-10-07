/**
 * Loading, empty and error states — part of the design system, not leftovers.
 *
 * Every state answers three questions: what happened, why, and what the student
 * can do next.
 */

import Link from 'next/link';
import { cn } from '@/lib/utils';
import { Icon } from '@/components/ui/icons';

/* -------------------------------------------------------------------------- */
/* Loading                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The word loader: a short, calm cycle of the four or five things Campus+ is
 * actually loading. The last word repeats the first so the loop never jumps.
 */
export function WordLoader({ words = ['campus', 'posts', 'communities', 'conversations', 'marketplace'], size = 'md', className = '' }) {
  const cycle = words.slice(0, 5);
  const sequence = [...cycle, cycle[0]];
  return (
    <span className={cn('word-loader', size === 'lg' ? 'word-loader-lg' : null, className)} role="status">
      <span>Loading</span>
      <span className="word-loader__viewport" aria-hidden="true">
        <span className="word-loader__track">
          {sequence.map((word, index) => (
            <span className="word-loader__word" key={`${word}-${index}`}>
              {word}
            </span>
          ))}
        </span>
      </span>
      <span className="sr-only">{`Loading ${cycle.join(', ')}`}</span>
    </span>
  );
}

/** Compact orbital loader for async actions and inline waiting states. */
export function OrbLoader({ size = 'sm', className = '', label = 'Loading' }) {
  return (
    <span className={cn('orb-loader', size === 'lg' ? 'orb-loader-lg' : null, className)} role="status" aria-label={label}>
      <span className="orb-loader__dot" />
      <span className="orb-loader__dot" />
      <span className="orb-loader__dot" />
    </span>
  );
}

/** Legacy-compatible inline spinner: a label plus the orbital loader. */
export function Spinner({ label = 'Loading', className = '', size = 'sm' }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5 text-[0.8125rem] text-muted', className)} role="status">
      <OrbLoader size={size} label={label} />
      {label}
    </span>
  );
}

/** Full-surface loading panel used by route-level `loading.js` files. */
export function LoadingPanel({ words, rows = 0, className = '' }) {
  return (
    <div className={cn('flex flex-col gap-4', className)} aria-busy="true">
      <div className="flex flex-col gap-2">
        <div className="skeleton skeleton-title" />
        <WordLoader words={words} size="lg" />
      </div>
      {rows > 0 ? <SkeletonList rows={rows} /> : null}
    </div>
  );
}

export function Skeleton({ className = '', as: Tag = 'div' }) {
  return <Tag className={cn('skeleton', className)} aria-hidden="true" />;
}

export function SkeletonList({ rows = 3, className = '', variant = 'card' }) {
  if (variant === 'rows') {
    return (
      <div className={cn('card divide-y divide-line', className)} aria-hidden="true">
        {Array.from({ length: rows }).map((_, index) => (
          <div key={index} className="flex items-center gap-3 p-3.5">
            <div className="skeleton h-9 w-9 rounded-full" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="skeleton skeleton-line w-40 max-w-full" />
              <div className="skeleton skeleton-line w-64 max-w-full" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col gap-3', className)} aria-hidden="true">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="card flex flex-col gap-2.5 p-4">
          <div className="flex items-center gap-2.5">
            <div className="skeleton h-8 w-8 rounded-full" />
            <div className="skeleton skeleton-line w-36" />
          </div>
          <div className="skeleton skeleton-line w-full" />
          <div className="skeleton skeleton-line w-4/5" />
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Empty and error                                                             */
/* -------------------------------------------------------------------------- */

export function EmptyState({ title, description = null, action = null, icon = 'sparkle', className = '' }) {
  return (
    <div className={cn('state-block', className)}>
      <span className="state-icon">
        <Icon name={icon} size={20} />
      </span>
      <p className="state-title">{title}</p>
      {description ? <p className="state-copy">{description}</p> : null}
      {action ? <div className="mt-2.5">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ title = 'Something went wrong', description = null, action = null, className = '' }) {
  return (
    <div className={cn('error-block', className)} role="alert">
      <p className="flex items-center gap-2 text-[0.875rem] font-semibold">
        <Icon name="alert" size={16} />
        {title}
      </p>
      {description ? <p className="mt-1 text-[0.8125rem] leading-relaxed">{description}</p> : null}
      {action ? <div className="mt-2.5">{action}</div> : null}
    </div>
  );
}

/** Quiet inline link home — used by the 404 and error surfaces. */
export function BackHomeLink({ className = '' }) {
  return (
    <Link href="/home" className={cn('text-[0.8125rem] font-medium underline', className)}>
      Back to Home
    </Link>
  );
}
