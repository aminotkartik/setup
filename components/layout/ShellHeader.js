'use client';

/**
 * The sticky application header.
 *
 * Desktop: search on the left, then notifications, appearance and the account
 * control. Mobile: the brand, search, notifications and account, with the
 * "everything else" sheet behind the menu button.
 *
 * It is a glass surface — one of the few places Campus+ uses the material — so
 * content scrolling underneath stays legible.
 */

import Link from 'next/link';
import { ROUTES } from '@/lib/constants';
import { BrandLockup } from '@/components/brand/Brand';
import { Icon } from '@/components/ui/icons';
import { GlassSurface, ThemeSwitch } from '@/components/ui';
import { AccountMenu } from '@/components/layout/AccountMenu';
import { MobileMenu } from '@/components/layout/MobileMenu';
import { ShellSearch } from '@/components/layout/ShellSearch';

function NotificationBell({ unreadNotifications = 0 }) {
  return (
    <Link
      href={ROUTES.notifications}
      aria-label={unreadNotifications > 0 ? `Notifications, ${unreadNotifications} unread` : 'Notifications'}
      className="icon-btn relative"
    >
      <Icon name="bell" size={19} />
      {unreadNotifications > 0 ? (
        <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[0.5625rem] font-bold text-on-accent">
          {unreadNotifications > 99 ? '99+' : unreadNotifications}
        </span>
      ) : null}
    </Link>
  );
}

export function ShellHeader({ user = null, unreadNotifications = 0, isStaff = false, canModerate = false, canAdmin = false, theme = 'light', createItems = [] }) {
  return (
    <GlassSurface as="header" rounded={false} tone="soft" className="sticky top-0 z-30 border-b border-line/70">
      {/* Mobile */}
      <div className="flex h-14 items-center gap-1.5 px-3 lg:hidden">
        <MobileMenu
          user={user}
          isStaff={isStaff}
          canModerate={canModerate}
          canAdmin={canAdmin}
          theme={theme}
          createItems={createItems}
        />
        <BrandLockup size="sm" subtitle={null} wordClass="text-[0.9375rem]" />
        <div className="ml-auto flex items-center gap-0.5">
          <Link href={ROUTES.explore} aria-label="Search Campus+" className="icon-btn">
            <Icon name="search" size={19} />
          </Link>
          <NotificationBell unreadNotifications={unreadNotifications} />
          <AccountMenu user={user} isStaff={isStaff} theme={theme} />
        </div>
      </div>

      {/* Desktop */}
      <div className="hidden h-16 items-center gap-4 px-6 lg:flex">
        <ShellSearch />
        <div className="ml-auto flex items-center gap-2">
          <NotificationBell unreadNotifications={unreadNotifications} />
          <span className="rule h-6 w-px" />
          <ThemeSwitch theme={theme} />
          <AccountMenu user={user} isStaff={isStaff} theme={theme} />
        </div>
      </div>
    </GlassSurface>
  );
}
