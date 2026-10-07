/**
 * Campus+ buttons.
 *
 * One visual language, four materials:
 *   - primary  → the animated edge-light (the signature CTAs)
 *   - sheen    → layered reflective light (hero-level secondary actions)
 *   - calm     → secondary / quiet / subtle (everything else)
 *   - tactile  → delete and keycap, used only for destructive or confirmatory
 *                actions
 *
 * Every one of them is a real `<button>` (or a real `<a>` when it navigates),
 * so keyboard, screen readers and disabled semantics behave normally.
 */

import Link from 'next/link';
import { cn } from '@/lib/utils';
import { Icon } from '@/components/ui/icons';

const SIZE = { sm: 'btn-sm', md: 'btn-md', lg: 'btn-lg' };

const VARIANT = {
  secondary: 'btn-secondary',
  ghost: 'btn-quiet',
  subtle: 'btn-subtle',
  danger: 'btn-danger',
};

function iconSize(size) {
  if (size === 'sm') return 15;
  if (size === 'lg') return 18;
  return 16;
}

export function Button({
  variant = 'primary',
  size = 'md',
  tone = 'ink',
  icon = null,
  iconRight = null,
  loading = false,
  block = false,
  className = '',
  type = 'button',
  as: Tag = 'button',
  children,
  disabled,
  ...props
}) {
  const classes = cn(
    'btn',
    SIZE[size] || SIZE.md,
    variant === 'primary' ? 'btn-primary' : null,
    variant === 'sheen' ? 'btn-sheen' : null,
    VARIANT[variant] || null,
    block ? 'btn-block' : null,
    !children && (icon || iconRight) ? 'btn-icon' : null,
    className,
  );

  const isDisabled = disabled || loading;
  const glyph = iconSize(size);

  const content = (
    <>
      {variant === 'primary' ? (
        <>
          <span className="btn-light" aria-hidden="true" />
          <span className="btn-spin btn-spin-soft" aria-hidden="true" />
          <span className="btn-spin btn-spin-intense" aria-hidden="true" />
          <span className="btn-spin btn-spin-core" aria-hidden="true" />
          <span className="btn-face" aria-hidden="true" />
        </>
      ) : null}
      {variant === 'sheen' ? <span className="btn-sheen-layer" aria-hidden="true" /> : null}
      <span className="btn-label">
        {loading ? <span className="dot-spin" aria-hidden="true" /> : icon ? <Icon name={icon} size={glyph} /> : null}
        {children ? <span>{children}</span> : null}
        {!loading && iconRight ? <Icon name={iconRight} size={glyph} /> : null}
      </span>
    </>
  );

  const common = {
    className: classes,
    'data-tone': variant === 'primary' ? tone : undefined,
    'aria-busy': loading || undefined,
    ...props,
  };

  if (Tag === 'button') {
    return (
      <button type={type} disabled={isDisabled} {...common}>
        {content}
      </button>
    );
  }

  return (
    <Tag {...common} aria-disabled={isDisabled || undefined}>
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

/** The reflective secondary material, used deliberately and rarely. */
export function SheenButton({ size = 'md', className = '', icon = null, children, ...props }) {
  return (
    <Button variant="sheen" size={size} className={className} icon={icon} {...props}>
      {children}
    </Button>
  );
}

export function IconButton({ label, icon, size = 'md', variant = 'quiet', className = '', ...props }) {
  return (
    <Button
      size={size}
      variant={variant}
      icon={icon}
      aria-label={label}
      title={label}
      className={cn(variant === 'quiet' ? 'icon-btn' : null, className)}
      {...props}
    />
  );
}

/**
 * Destructive action: physical depth, inset shading, a pressed state that
 * travels into the surface. Only ever used for delete / remove / block.
 */
export function DeleteButton({ children = 'Delete', icon = 'trash', size = 'md', className = '', ...props }) {
  return (
    <button type="button" className={cn('btn-delete', className)} {...props}>
      {icon ? <Icon name={icon} size={size === 'sm' ? 14 : 15} /> : null}
      <span>{children}</span>
    </button>
  );
}

/**
 * Keycap: a small, deliberate confirmation control for modals and inline
 * confirmations. Compact by design — Campus+ is not a keyboard simulator.
 */
export function KeycapButton({ children = 'OK', tone = 'plain', icon = null, className = '', ...props }) {
  return (
    <button type="button" className={cn('keycap', tone === 'accent' ? 'keycap-accent' : null, className)} {...props}>
      {icon ? <Icon name={icon} size={14} /> : null}
      <span>{children}</span>
    </button>
  );
}
