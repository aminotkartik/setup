import Link from 'next/link';
import { Icon } from '@/components/ui/icons';
import { ROUTES } from '@/lib/constants';
import { cn } from '@/lib/utils';

/**
 * The single brand surface.
 *
 * Every placement — the sidebar, the mobile header, the public/login frame —
 * renders through this module, so the Campus+ identity is defined once and the
 * mark never drifts between screens.
 *
 * ── Dropping in the official logo ─────────────────────────────────────────
 * Put the supplied asset in `public/brand/` (SVG preferred; PNG with a
 * transparent background otherwise) and point `LOGO_SRC` at it. Every
 * placement follows automatically, at three responsive sizes, with the
 * original proportions preserved (`object-fit: contain`). Until the asset
 * exists, the plus-tile below stands in — it is never shown alongside a real
 * logo, because `LOGO_SRC` is the single switch.
 */

export const LOGO_SRC = null;

const MARK_SIZE = { sm: 28, md: 34, lg: 44 };
const GLYPH_SIZE = { sm: 14, md: 18, lg: 22 };

/** The mark on its own. Decorative by default — the wordmark names the product. */
export function BrandMark({ size = 'md', className = '' }) {
  const px = MARK_SIZE[size] || MARK_SIZE.md;

  if (LOGO_SRC) {
    return (
      <span className={cn('brand-mark brand-mark-img', className)} data-size={size} aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element -- a static brand asset, not content */}
        <img src={LOGO_SRC} alt="" width={px} height={px} decoding="async" />
      </span>
    );
  }

  return (
    <span className={cn('brand-mark', className)} data-size={size} aria-hidden="true">
      <Icon name="plus" size={GLYPH_SIZE[size] || GLYPH_SIZE.md} />
    </span>
  );
}

/** Mark + wordmark in one labelled link — the standard identity lockup. */
export function BrandLockup({ size = 'md', subtitle = 'PCCOE', wordClass = '', className = '', href = ROUTES.home }) {
  return (
    <Link href={href} className={cn('brand min-w-0', className)} aria-label="Campus+ home">
      <BrandMark size={size} />
      <span className="flex min-w-0 flex-col leading-tight">
        <span className={cn('brand-word truncate', wordClass)}>Campus+</span>
        {subtitle ? <span className="brand-sub">{subtitle}</span> : null}
      </span>
    </Link>
  );
}
