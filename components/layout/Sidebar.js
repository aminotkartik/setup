'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PRIMARY_NAV, ROUTES } from '@/lib/constants';
import { IdentityMark, StaffDot } from '@/components/ui';
import { Icon } from '@/components/ui/icons';
import { BrandLockup } from '@/components/brand/Brand';
import { CreateMenu } from '@/components/layout/CreateMenu';
import { cn } from '@/lib/utils';

/**
 * Desktop navigation: a light rail with the Campus+ identity at the top, one
 * clear primary group, the secondary destinations (messages, notifications,
 * staff panels) and the signed-in student at the bottom.
 *
 * It is a client component only because it highlights the active route; it
 * renders no data of its own.
 */
export function Sidebar({ user = null, unreadNotifications = 0, isStaff = false, canModerate = false, canAdmin = false, createItems = [] }) {
  const pathname = usePathname();
  const active = (href) => pathname === href || (href !== '/' && pathname.startsWith(`${href}/`));

  const secondary = [
    { href: ROUTES.chat, label: 'Messages', icon: 'chat', count: 0 },
    { href: ROUTES.notifications, label: 'Notifications', icon: 'bell', count: unreadNotifications },
  ];

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[17rem] flex-col overflow-y-auto border-r border-line bg-canvas/80 px-3 pb-4 pt-5 backdrop-blur-xl lg:flex">
      <BrandLockup className="px-2" />

      <div className="mt-5">
        <CreateMenu items={createItems} />
      </div>

      <nav aria-label="Primary" className="mt-4 flex flex-col gap-0.5">
        {PRIMARY_NAV.map((item) => (
          <Link key={item.href} href={item.href} aria-current={active(item.href) ? 'page' : undefined} className="nav-item">
            <Icon name={item.icon} size={18} className="nav-icon" />
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="rule my-4" />

      <nav aria-label="Secondary" className="flex flex-col gap-0.5">
        {secondary.map((item) => (
          <Link key={item.href} href={item.href} aria-current={active(item.href) ? 'page' : undefined} className="nav-item">
            <Icon name={item.icon} size={18} className="nav-icon" />
            <span className="flex-1">{item.label}</span>
            {item.count > 0 ? <span className="nav-count">{item.count > 99 ? '99+' : item.count}</span> : null}
          </Link>
        ))}

        {canModerate ? (
          <Link href={ROUTES.moderator} aria-current={active(ROUTES.moderator) ? 'page' : undefined} className="nav-item">
            <Icon name="shield" size={18} className="nav-icon" />
            Moderation
          </Link>
        ) : null}

        {canAdmin ? (
          <Link href={ROUTES.admin} aria-current={active(ROUTES.admin) ? 'page' : undefined} className="nav-item">
            <Icon name="eye" size={18} className="nav-icon" />
            Admin
          </Link>
        ) : null}
      </nav>

      <div className="mt-auto pt-4">
        {user ? (
          <Link href={ROUTES.profile} className="flex items-center gap-2.5 rounded-[var(--radius-md)] border border-line bg-surface p-2 shadow-[var(--shadow-inset-top)] transition-colors hover:border-line-strong hover:no-underline">
            <IdentityMark name={user.displayName || user.username} size={32} tone="accent" square={false} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 truncate text-[0.8125rem] font-semibold">
                {user.displayName || `@${user.username}`}
                {isStaff ? <StaffDot label={user.staffLabel || 'Staff member'} /> : null}
              </span>
              <span className="block truncate text-2xs text-muted">@{user.username}</span>
            </span>
            <Icon name="chevronRight" size={14} className="text-muted-soft" />
          </Link>
        ) : (
          <Link href="/login" className="nav-item">
            Sign in
          </Link>
        )}
        <p className={cn('px-2 pt-2.5 text-2xs leading-relaxed text-muted-soft')}>
          Unofficial student project. Not affiliated with PCCOE.
        </p>
      </div>
    </aside>
  );
}
