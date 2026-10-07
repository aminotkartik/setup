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
 * Put the supplied asset in `public/brand/` (SVG preferred; PNG/WEBP with a
 * transparent background otherwise) and point `LOGO_SRC` at it. Every
 * placement follows automatically, at three responsive sizes, with the
 * original proportions preserved (`object-fit: contain`). Until the asset
 * exists, the plus-tile below stands in — it is never shown alongside a real
 * logo, because `LOGO_SRC` is the single switch.
 *
 * `LOGO_PLATE` is for a raster mark that ships on its own opaque background
 * (a crest on white, for example): the mark then sits on a soft white plate so
 * it stays legible on the dark theme instead of floating as a white square.
 */

export const LOGO_SRC = null;
export const LOGO_PLATE = false;

/**
 * The college crest — context, not identity.
 *
 * Campus+ keeps its own mark as the product identity (and as the app icon).
 * The crest belongs exactly where the product states who it is *for*: the
 * sign-in brand area, the sidebar's affiliation line and the public footer.
 * It always renders next to the words that keep the positioning honest —
 * "unofficial student project" / "not affiliated with PCCOE" — so it reads as
 * context rather than endorsement.
 *
 * Drop the crest in `public/brand/` and point CREST_SRC at it. Until then it
 * renders nothing at all: no empty plate, no placeholder.
 */
export const CREST_SRC = null;

export function CollegeCrest({ size = 28, className = '', label = 'PCCOE crest' }) {
  if (!CREST_SRC) return null;

  return (
    <span className={cn('brand-crest', className)} style={{ '--crest-size': `${size}px` }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a static brand asset, not content */}
      <img src={CREST_SRC} alt={label} width={size} height={size} decoding="async" loading="lazy" />
    </span>
  );
}

const MARK_SIZE = { sm: 28, md: 34, lg: 44 };
const GLYPH_SIZE = { sm: 14, md: 18, lg: 22 };

/** The mark on its own. Decorative by default — the wordmark names the product. */
export function BrandMark({ size = 'md', className = '' }) {
  const px = MARK_SIZE[size] || MARK_SIZE.md;

  if (LOGO_SRC) {
    return (
      <span
        className={cn('brand-mark brand-mark-img', className)}
        data-size={size}
        data-plate={LOGO_PLATE ? 'true' : undefined}
        aria-hidden="true"
      >
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
