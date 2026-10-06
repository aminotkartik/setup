import Link from 'next/link';
import { Badge, OfficialBadge } from '@/components/ui';
import { Icon } from '@/components/ui/icons';
import { cn, relativeTime, truncate } from '@/lib/utils';

/**
 * One card for every non-post piece of campus content (spec §16–§46): notices,
 * events, clubs, listings, gigs, lost & found, housing, rides, team posts,
 * resources, opportunities and projects.
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
}) {
  const inner = (
    <>
      {icon ? (
        <span className="mt-0.5 shrink-0 text-muted">
          <Icon name={icon} size={16} />
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-[0.9375rem] font-medium leading-snug">{title}</span>
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
          <span className="mt-1 block text-2xs text-muted">{meta.filter(Boolean).join(' · ')}</span>
        ) : null}
        {timestamp ? (
          <span className="mt-0.5 block text-2xs text-muted">
            <time dateTime={timestamp}>{relativeTime(timestamp)}</time>
          </span>
        ) : null}
        {footer}
      </span>
    </>
  );

  if (!href) {
    return <article className={cn('card flex items-start gap-3 p-4', className)}>{inner}</article>;
  }

  return (
    <Link href={href} className={cn('card flex items-start gap-3 p-4 hover:no-underline', className)}>
      {inner}
    </Link>
  );
}
