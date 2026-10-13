import Link from 'next/link';
import { Badge, OfficialBadge } from '@/components/ui';
import { Icon } from '@/components/ui/icons';
import { cn, relativeTime, truncate } from '@/lib/utils';

/**
 * One card for every non-post piece of campus content: notices, events, clubs,
 * listings, gigs, lost & found, housing, rides, team posts, resources,
 * opportunities and projects.
 *
 * Official content is labelled; community-submitted content is labelled as such;
 * student content never looks official. No view counts, no engagement theatre.
 */
export function ContentCard({
  href,
  title,
  description = null,
  meta = [],
  badges = [],
  official = false,
  community = false,
  timestamp = null,
  icon = null,
  className = '',
  footer = null,
  emphasis = null,
  variant = 'card',
}) {
  // Two presentations, one component: the default card for grids and detail
  // pages, and the stream entry for a feed column (see app/styles/home.css).
  // The content, the labels and the links are identical in both; only the
  // surface and the type scale change.
  const stream = variant === 'stream';
  const skin = stream
    ? {
        root: cn('stream-card stream-card--row', className),
        glyph: 'stream-card__glyph',
        title: 'stream-card__title',
        body: 'stream-card__body',
        meta: 'stream-card__meta',
        stamp: 'shrink-0',
      }
    : {
        root: cn('card flex items-start gap-3 p-4', href ? 'group' : null, className),
        glyph:
          'grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-sm)] border border-line bg-surface-2 text-muted transition-colors',
        title: 't-card leading-snug',
        body: 'mt-1 block text-[0.8125rem] leading-relaxed text-muted',
        meta: 'mt-1.5 block text-2xs text-muted-soft',
        stamp: 'shrink-0 self-center text-right',
      };

  const inner = (
    <>
      {icon ? (
        <span className={skin.glyph}>
          <Icon name={icon} size={15} />
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className={skin.title}>{title}</span>
          {official ? <OfficialBadge /> : null}
          {!official && community ? <Badge>Community submitted</Badge> : null}
          {badges.map((badge) => (
            <Badge key={badge.label} tone={badge.tone || 'neutral'}>
              {badge.label}
            </Badge>
          ))}
        </span>
        {description ? <span className={skin.body}>{truncate(description, stream ? 260 : 220)}</span> : null}
        {meta.filter(Boolean).length ? (
          <span className={stream ? skin.meta : `${skin.meta} block`}>{meta.filter(Boolean).join(' · ')}</span>
        ) : null}
        {timestamp ? (
          <span className={cn(stream ? skin.meta : `${skin.meta} block`, 'mt-0.5')}>
            <time dateTime={timestamp}>{relativeTime(timestamp)}</time>
          </span>
        ) : null}
        {footer}
      </span>
      {emphasis ? <span className={skin.stamp}>{emphasis}</span> : null}
    </>
  );

  if (!href) {
    return <article className={skin.root}>{inner}</article>;
  }

  return (
    <Link href={href} className={skin.root}>
      {inner}
    </Link>
  );
}
