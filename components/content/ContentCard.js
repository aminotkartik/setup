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
}) {
  const inner = (
    <>
      {icon ? (
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-sm)] border border-line bg-surface-2 text-muted transition-colors">
          <Icon name={icon} size={15} />
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="t-card leading-snug">{title}</span>
          {official ? <OfficialBadge /> : null}
          {!official && community ? <Badge>Community submitted</Badge> : null}
          {badges.map((badge) => (
            <Badge key={badge.label} tone={badge.tone || 'neutral'}>
              {badge.label}
            </Badge>
          ))}
        </span>
        {description ? (
          <span className="mt-1 block text-[0.8125rem] leading-relaxed text-muted">{truncate(description, 220)}</span>
        ) : null}
        {meta.filter(Boolean).length ? (
          <span className="mt-1.5 block text-2xs text-muted-soft">{meta.filter(Boolean).join(' · ')}</span>
        ) : null}
        {timestamp ? (
          <span className="mt-0.5 block text-2xs text-muted-soft">
            <time dateTime={timestamp}>{relativeTime(timestamp)}</time>
          </span>
        ) : null}
        {footer}
      </span>
      {emphasis ? <span className="shrink-0 self-center text-right">{emphasis}</span> : null}
    </>
  );

  const classes = cn('card flex items-start gap-3 p-4', href ? 'group' : null, className);

  if (!href) {
    return <article className={classes}>{inner}</article>;
  }

  return (
    <Link href={href} className={classes}>
      {inner}
    </Link>
  );
}
