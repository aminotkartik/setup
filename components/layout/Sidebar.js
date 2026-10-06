'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PRIMARY_NAV, ROUTES } from '@/lib/constants';
import { Icon } from '@/components/ui/icons';
import { StaffDot } from '@/components/ui';
import { cn } from '@/lib/utils';

/**
 * Desktop navigation (spec §5): Home · Explore · Market · Communities · Campus ·
 * Profile, plus the secondary destinations that have no mobile tab.
 *
 * The sidebar is a client component only because it highlights the active
 * route; it renders no data of its own.
 */
export function Sidebar({ user = null, unreadNotifications = 0, isStaff = false, canModerate = false, canAdmin = false }) {
  const pathname = usePathname();
  const active = (href) => pathname === href || (href !== '/' && pathname.startsWith(`${href}/`));

  const secondary = [
    { href: ROUTES.chat, label: 'Messages', icon: 'chat' },
    { href: ROUTES.random, label: 'Random', icon: 'sparkle' },
    { href: ROUTES.notifications, label: 'Notifications', icon: 'bell', count: unreadNotifications },
    { href: ROUTES.settings, label: 'Settings', icon: 'settings' },
  ];

  return (
    <aside className="fixed inset-y-0 left-0 hidden w-60 shrink-0 flex-col border-r border-line bg-canvas px-3 py-5 lg:flex">
      <Link href={ROUTES.home} className="mb-5 flex items-center gap-2 px-2 hover:no-underline">
        <span className="text-base font-semibold tracking-tight">Campus+</span>
        <span className="text-2xs text-muted">PCCOE</span>
      </Link>

      <nav aria-label="Primary" className="flex flex-col gap-0.5">
        {PRIMARY_NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active(item.href) ? 'page' : undefined}
            className={cn(
              'flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm hover:no-underline',
              active(item.href) ? 'bg-white font-medium text-ink' : 'text-muted hover:bg-white/70 hover:text-ink',
            )}
          >
            <Icon name={item.icon} size={18} />
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="my-4 border-t border-line" />

      <nav aria-label="Secondary" className="flex flex-col gap-0.5">
        {secondary.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active(item.href) ? 'page' : undefined}
            className={cn(
              'flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm hover:no-underline',
              active(item.href) ? 'bg-white font-medium text-ink' : 'text-muted hover:bg-white/70 hover:text-ink',
            )}
          >
            <Icon name={item.icon} size={18} />
            <span className="flex-1">{item.label}</span>
            {item.count > 0 ? (
              <span className="rounded-full bg-accent px-1.5 text-2xs font-medium text-white">{item.count > 99 ? '99+' : item.count}</span>
            ) : null}
          </Link>
        ))}

        {canModerate ? (
          <Link
            href={ROUTES.moderator}
            className={cn(
              'flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm hover:no-underline',
              active(ROUTES.moderator) ? 'bg-white font-medium text-ink' : 'text-muted hover:bg-white/70 hover:text-ink',
            )}
          >
            <Icon name="shield" size={18} />
            Moderation
          </Link>
        ) : null}

        {canAdmin ? (
          <Link
            href={ROUTES.admin}
            className={cn(
              'flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm hover:no-underline',
              active(ROUTES.admin) ? 'bg-white font-medium text-ink' : 'text-muted hover:bg-white/70 hover:text-ink',
            )}
          >
            <Icon name="eye" size={18} />
            Admin
          </Link>
        ) : null}
      </nav>

      <div className="mt-auto border-t border-line pt-3">
        {user ? (
          <Link href={ROUTES.profile} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white hover:no-underline">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-2xs font-medium text-muted">
              {(user.displayName || user.username || '?').slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 truncate text-[0.8125rem] font-medium">
                {user.displayName || `@${user.username}`}
                {isStaff ? <StaffDot label={user.staffLabel || 'Staff member'} /> : null}
              </span>
              <span className="block truncate text-2xs text-muted">@{user.username}</span>
            </span>
          </Link>
        ) : (
          <Link href="/login" className="block rounded-lg px-2 py-2 text-sm text-muted hover:text-ink">
            Sign in
          </Link>
        )}
        <p className="px-2 pt-2 text-2xs text-muted">
          Unofficial student project. Not affiliated with PCCOE.
        </p>
      </div>
    </aside>
  );
}
