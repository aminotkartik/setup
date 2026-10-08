/**
 * Surfaces and structure primitives.
 */

import Link from 'next/link';
import { cn } from '@/lib/utils';
import { Icon } from '@/components/ui/icons';

export function Card({ className = '', as: Tag = 'div', interactive = false, children, ...props }) {
  return (
    <Tag className={cn('card', interactive ? 'card-interactive' : null, className)} {...props}>
      {children}
    </Tag>
  );
}

/** Glass is a material accent, in four deliberate levels (see surfaces.css). */
export function GlassSurface({ className = '', tone = 'default', as: Tag = 'div', rounded = true, children, ...props }) {
  const tones = {
    default: 'glass',
    soft: 'glass-soft',
    strong: 'glass-strong',
    floating: 'glass-floating',
    featured: 'glass-featured',
    cinematic: 'glass-cinematic',
  };
  return (
    <Tag className={cn(tones[tone] || tones.default, rounded ? 'rounded-[var(--radius-lg)]' : null, className)} {...props}>
      {children}
    </Tag>
  );
}

export function PageHeader({ title, eyebrow = null, description = null, action = null, back = null, className = '' }) {
  return (
    <header className={cn('flex flex-col gap-3', className)}>
      {back ? (
        <Link
          href={back.href}
          className="inline-flex w-fit items-center gap-1 text-2xs font-medium text-muted transition-colors hover:text-ink hover:no-underline"
        >
          <Icon name="chevronLeft" size={13} />
          {back.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          {eyebrow ? <p className="t-label mb-1.5">{eyebrow}</p> : null}
          <h1 className="t-page break-anywhere">{title}</h1>
          {description ? <p className="t-secondary mt-1.5 max-w-2xl">{description}</p> : null}
        </div>
        {action ? <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div> : null}
      </div>
    </header>
  );
}

export function SectionHeader({ title, description = null, action = null, icon = null, className = '', id = undefined }) {
  return (
    <div className={cn('section-head', className)}>
      <div className="min-w-0">
        <h2 id={id} className="t-section flex items-center gap-2">
          {icon ? <Icon name={icon} size={16} className="text-muted" /> : null}
          {title}
        </h2>
        {description ? <p className="t-caption mt-1 max-w-2xl">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Badges, dots and small labels                                               */
/* -------------------------------------------------------------------------- */

const BADGE_TONES = {
  neutral: 'badge',
  accent: 'badge badge-accent',
  danger: 'badge badge-danger',
  success: 'badge badge-success',
  warning: 'badge badge-warning',
  info: 'badge badge-info',
  live: 'badge badge-live',
};

export function Badge({ children, tone = 'neutral', className = '', title = undefined, icon = null }) {
  return (
    <span title={title} className={cn(BADGE_TONES[tone] || BADGE_TONES.neutral, className)}>
      {icon ? <Icon name={icon} size={11} /> : null}
      {children}
    </span>
  );
}

/** The small "Official" label. Never decorative — it is a claim. */
export function OfficialBadge({ className = '' }) {
  return (
    <Badge tone="accent" className={className} icon="checkCircle" title="Published by the campus team">
      Official
    </Badge>
  );
}

/**
 * Role dot for Moderators/Admins. Students get nothing at all.
 * There is no online/presence dot anywhere in Campus+.
 */
export function StaffDot({ tone = 'danger', label, className = '' }) {
  return (
    <span
      className={cn('inline-block h-1.5 w-1.5 shrink-0 rounded-full', className)}
      style={{ backgroundColor: tone === 'danger' ? 'var(--c-danger)' : 'var(--c-warning)' }}
      role="img"
      aria-label={label || 'Staff member'}
      title={label || 'Staff member'}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Notices                                                                     */
/* -------------------------------------------------------------------------- */

const NOTICE_TONES = {
  neutral: { border: 'var(--c-line)', background: 'var(--c-surface-2)', color: 'var(--c-ink)', icon: 'var(--c-muted)' },
  accent: { border: 'color-mix(in oklab, var(--c-accent) 30%, transparent)', background: 'var(--c-accent-soft)', color: 'var(--c-ink)', icon: 'var(--c-accent-ink)' },
  danger: { border: 'color-mix(in oklab, var(--c-danger) 32%, transparent)', background: 'var(--c-danger-soft)', color: 'var(--c-ink)', icon: 'var(--c-danger)' },
  success: { border: 'color-mix(in oklab, var(--c-success) 32%, transparent)', background: 'var(--c-success-soft)', color: 'var(--c-ink)', icon: 'var(--c-success)' },
  warning: { border: 'color-mix(in oklab, var(--c-warning) 32%, transparent)', background: 'var(--c-warning-soft)', color: 'var(--c-ink)', icon: 'var(--c-warning)' },
};

export function Notice({ tone = 'neutral', children, className = '', icon = null }) {
  const palette = NOTICE_TONES[tone] || NOTICE_TONES.neutral;
  return (
    <div
      className={cn('notice', className)}
      style={{ borderColor: palette.border, backgroundColor: palette.background, color: palette.color }}
    >
      {icon ? <Icon name={icon} size={16} className="mt-0.5 shrink-0" style={{ color: palette.icon }} /> : null}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Identity                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The text-first avatar: the first letter, in a quiet material square.
 * `size` is in pixels; `tone="accent"` marks the signed-in student.
 */
export function IdentityMark({ name, size = 32, tone = 'neutral', className = '', square = false }) {
  const initial = (name || '?').trim().slice(0, 1).toUpperCase() || '?';
  return (
    <span
      aria-hidden="true"
      className={cn('identity-mark', tone === 'accent' ? 'identity-mark-accent' : null, className)}
      style={{
        width: size,
        height: size,
        borderRadius: square ? 'var(--radius-sm)' : 999,
        fontSize: size <= 26 ? '0.6875rem' : size <= 34 ? '0.8125rem' : '0.9375rem',
      }}
    >
      {initial}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Contextual rail                                                             */
/* -------------------------------------------------------------------------- */

/** Sticky contextual column (xl and up) — real campus information only. */
export function Rail({ children, className = '', label = 'Campus information' }) {
  return (
    <aside className={cn('rail', className)} aria-label={label}>
      {children}
    </aside>
  );
}

export function RailCard({ title, icon = null, action = null, children, className = '' }) {
  return (
    <section className={cn('card p-3.5', className)}>
      <header className="flex items-center justify-between gap-2">
        <h2 className="t-label flex items-center gap-1.5">
          {icon ? <Icon name={icon} size={13} /> : null}
          {title}
        </h2>
        {action}
      </header>
      <div className="mt-2.5">{children}</div>
    </section>
  );
}
