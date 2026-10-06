import Link from 'next/link';
import { cn } from '@/lib/utils';
import { ROUTES } from '@/lib/constants';
import { StaffDot } from '@/components/ui';
import { relativeTime } from '@/lib/utils';

/**
 * The single identity line used everywhere a person is shown (spec §50).
 *
 * Text-first: the "avatar" is the display name's first letter in a quiet square
 * — no uploaded images exist on Campus+ and none are invented here. The staff
 * marker comes from `public_profiles.is_staff` (migration 019); students show
 * nothing at all. There is intentionally no online/presence indicator.
 */
export function IdentityLine({
  username,
  displayName = null,
  isStaff = false,
  size = 'md',
  timestamp = null,
  linkToProfile = true,
  className = '',
  badge = null,
}) {
  const name = displayName || (username ? `@${username}` : 'Unknown');
  const initial = (name || '?').trim().slice(0, 1).toUpperCase();
  const dimensions = size === 'sm' ? 'h-6 w-6 text-2xs' : 'h-8 w-8 text-[0.8125rem]';

  const body = (
    <>
      <span
        aria-hidden="true"
        className={cn(
          'flex shrink-0 items-center justify-center rounded-md border border-line bg-white font-medium text-muted',
          dimensions,
        )}
      >
        {initial}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[0.8125rem] font-medium text-ink">{name}</span>
          {isStaff ? <StaffDot label={isStaff === true ? 'Staff member' : isStaff} /> : null}
          {badge}
        </span>
        <span className="flex items-center gap-1.5 text-2xs text-muted">
          {username ? <span className="truncate">@{username}</span> : null}
          {timestamp ? <span aria-hidden="true">·</span> : null}
          {timestamp ? <time dateTime={timestamp}>{relativeTime(timestamp)}</time> : null}
        </span>
      </span>
    </>
  );

  if (linkToProfile && username) {
    return (
      <Link href={ROUTES.user(username)} className={cn('flex min-w-0 items-center gap-2 hover:no-underline', className)}>
        {body}
      </Link>
    );
  }
  return <div className={cn('flex min-w-0 items-center gap-2', className)}>{body}</div>;
}

/** Small role label shown on staff profiles ("Moderator", "Admin"). */
export function RoleLabel({ role, className = '' }) {
  const labels = {
    moderator: 'Moderator',
    admin: 'Administrator',
    super_admin: 'Super Admin',
  };
  if (!labels[role]) return null;
  return (
    <span className={cn('rounded-full border border-line bg-canvas px-2 py-0.5 text-2xs font-medium text-muted', className)}>
      {labels[role]}
    </span>
  );
}
