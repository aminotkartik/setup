/**
 * Small presentation primitives used by every screen.
 *
 * They are plain components (no client hooks) so they can render on the server;
 * anything interactive lives in its own `'use client'` component.
 */

import Link from 'next/link';
import { cn } from '@/lib/utils';
import { Icon } from '@/components/ui/icons';

/* -------------------------------------------------------------------------- */
/* Buttons                                                                     */
/* -------------------------------------------------------------------------- */

const BUTTON_VARIANTS = {
  primary: 'bg-accent text-white border-accent hover:bg-accent-hover',
  secondary: 'bg-surface text-ink border-line hover:border-muted',
  ghost: 'bg-transparent text-ink border-transparent hover:bg-white',
  danger: 'bg-surface text-danger border-danger hover:bg-danger-soft',
  subtle: 'bg-canvas text-ink border-line hover:bg-white',
};

const BUTTON_SIZES = {
  sm: 'h-8 px-3 text-[0.8125rem] gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-11 px-5 text-sm gap-2',
};

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  icon = null,
  type = 'button',
  as: Tag = 'button',
  ...props
}) {
  const classes = cn(
    'inline-flex items-center justify-center rounded-lg border font-medium transition-colors',
    'disabled:cursor-not-allowed disabled:opacity-50',
    BUTTON_VARIANTS[variant] || BUTTON_VARIANTS.primary,
    BUTTON_SIZES[size] || BUTTON_SIZES.md,
    className,
  );
  const content = (
    <>
      {icon ? <Icon name={icon} size={size === 'sm' ? 15 : 17} /> : null}
      {props.children}
    </>
  );
  if (Tag === 'button') {
    return (
      <button type={type} className={classes} {...props}>
        {content}
      </button>
    );
  }
  return (
    <Tag className={classes} {...props}>
      {content}
    </Tag>
  );
}

export function LinkButton({ href, children, variant = 'secondary', size = 'md', className = '', icon = null, ...props }) {
  return (
    <Button as={Link} href={href} variant={variant} size={size} className={className} icon={icon} {...props}>
      {children}
    </Button>
  );
}

/* -------------------------------------------------------------------------- */
/* Form fields                                                                 */
/* -------------------------------------------------------------------------- */

export function Field({ label, htmlFor, hint, error, required = false, children, className = '' }) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label ? (
        <label htmlFor={htmlFor} className="text-[0.8125rem] font-medium text-ink">
          {label}
          {required ? <span className="ml-1 text-accent" aria-hidden="true">*</span> : null}
        </label>
      ) : null}
      {children}
      {hint && !error ? <p className="text-2xs text-muted">{hint}</p> : null}
      {error ? (
        <p className="text-2xs text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const CONTROL =
  'w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm placeholder:text-muted/80 ' +
  'focus:border-accent focus:outline-none focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-60';

export function Input({ className = '', ...props }) {
  return <input className={cn(CONTROL, 'h-10', className)} {...props} />;
}

export function Textarea({ className = '', rows = 4, ...props }) {
  return <textarea rows={rows} className={cn(CONTROL, 'resize-y leading-relaxed', className)} {...props} />;
}

export function Select({ className = '', children, ...props }) {
  return (
    <select className={cn(CONTROL, 'h-10 pr-8', className)} {...props}>
      {children}
    </select>
  );
}

export function Checkbox({ label, id, className = '', ...props }) {
  return (
    <label htmlFor={id} className={cn('flex cursor-pointer items-start gap-2 text-sm text-ink', className)}>
      <input
        id={id}
        type="checkbox"
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-line accent-[var(--color-accent)]"
        {...props}
      />
      <span>{label}</span>
    </label>
  );
}

/* -------------------------------------------------------------------------- */
/* Surfaces                                                                    */
/* -------------------------------------------------------------------------- */

export function Card({ className = '', as: Tag = 'div', children, ...props }) {
  return (
    <Tag className={cn('card', className)} {...props}>
      {children}
    </Tag>
  );
}

export function SectionHeader({ title, description = null, action = null, className = '' }) {
  return (
    <div className={cn('flex items-start justify-between gap-3', className)}>
      <div>
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        {description ? <p className="mt-0.5 text-[0.8125rem] text-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, description = null, action = null, back = null }) {
  return (
    <header className="hairline mb-5 flex items-start justify-between gap-4 pb-4">
      <div className="min-w-0">
        {back ? (
          <Link href={back.href} className="mb-1 inline-flex items-center gap-1 text-2xs text-muted hover:text-ink">
            <Icon name="chevronLeft" size={13} />
            {back.label}
          </Link>
        ) : null}
        <h1 className="truncate text-xl font-semibold">{title}</h1>
        {description ? <p className="mt-1 text-[0.8125rem] text-muted">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}

/* -------------------------------------------------------------------------- */
/* Badges, dots and small labels                                               */
/* -------------------------------------------------------------------------- */

export function Badge({ children, tone = 'neutral', className = '', title = undefined }) {
  const tones = {
    neutral: 'border-line bg-canvas text-muted',
    accent: 'border-accent/30 bg-accent-soft text-accent-ink',
    danger: 'border-danger/30 bg-danger-soft text-danger',
    success: 'border-success/30 bg-success-soft text-success',
    warning: 'border-warning/30 bg-warning-soft text-warning',
  };
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs font-medium',
        tones[tone] || tones.neutral,
        className,
      )}
    >
      {children}
    </span>
  );
}

/** The small "Official" label (spec §11). Never decorative — it is a claim. */
export function OfficialBadge({ className = '' }) {
  return (
    <Badge tone="accent" className={className} title="Published by the campus team">
      Official
    </Badge>
  );
}

/**
 * Role dot for Moderators/Admins. Students get nothing at all (spec §13).
 * There is no online/presence dot anywhere in Campus+.
 */
export function StaffDot({ tone = 'danger', label, className = '' }) {
  return (
    <span className={cn('inline-block h-1.5 w-1.5 shrink-0 rounded-full', className)}
      style={{ backgroundColor: tone === 'danger' ? 'var(--color-danger)' : 'var(--color-warning)' }}
      role="img"
      aria-label={label || 'Staff member'}
      title={label || 'Staff member'}
    />
  );
}

export function Notice({ tone = 'neutral', children, className = '', icon = null }) {
  const tones = {
    neutral: 'border-line bg-canvas text-ink',
    accent: 'border-accent/30 bg-accent-soft text-ink',
    danger: 'border-danger/30 bg-danger-soft text-ink',
    success: 'border-success/30 bg-success-soft text-ink',
    warning: 'border-warning/30 bg-warning-soft text-ink',
  };
  return (
    <div className={cn('flex items-start gap-2 rounded-lg border px-3 py-2.5 text-[0.8125rem]', tones[tone], className)}>
      {icon ? <Icon name={icon} size={16} className="mt-0.5 shrink-0 text-muted" /> : null}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* States: empty, loading, error                                               */
/* -------------------------------------------------------------------------- */

export function EmptyState({ title, description = null, action = null, icon = 'sparkle', className = '' }) {
  return (
    <div className={cn('card flex flex-col items-center justify-center gap-2 px-6 py-12 text-center', className)}>
      <Icon name={icon} size={22} className="text-muted" />
      <p className="text-sm font-medium text-ink">{title}</p>
      {description ? <p className="max-w-sm text-[0.8125rem] text-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ title = 'Something went wrong', description = null, action = null, className = '' }) {
  return (
    <div className={cn('card border-danger/30 bg-danger-soft px-4 py-3', className)} role="alert">
      <p className="text-sm font-medium text-danger">{title}</p>
      {description ? <p className="mt-0.5 text-[0.8125rem] text-ink">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function SkeletonList({ rows = 3, className = '' }) {
  return (
    <div className={cn('flex flex-col gap-3', className)} aria-hidden="true">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="card flex flex-col gap-2 p-4">
          <div className="skeleton h-3 w-32" />
          <div className="skeleton h-3 w-full" />
          <div className="skeleton h-3 w-4/5" />
        </div>
      ))}
    </div>
  );
}

export function Spinner({ label = 'Loading', className = '' }) {
  return (
    <span className={cn('inline-flex items-center gap-2 text-[0.8125rem] text-muted', className)} role="status">
      <span
        className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-line border-t-accent"
        aria-hidden="true"
      />
      {label}
    </span>
  );
}
