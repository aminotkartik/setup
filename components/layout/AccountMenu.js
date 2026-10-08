'use client';

/**
 * The single place to reach "my account": avatar, profile, settings and sign
 * out, in the same top-right corner on every screen size.
 */

import Link from 'next/link';
import { ROUTES } from '@/lib/constants';
import { Dropdown, IdentityMark, MenuLink, StaffDot, ThemeSwitch } from '@/components/ui';
import { SignOutButton } from '@/components/auth/SignOutButton';
import { Icon } from '@/components/ui/icons';

export function AccountMenu({ user = null, isStaff = false, theme = 'dark' }) {
  if (!user) {
    return (
      <Link href="/login" className="btn btn-secondary btn-sm hover:no-underline">
        Sign in
      </Link>
    );
  }

  const name = user.displayName || `@${user.username}`;

  return (
    <Dropdown
      label="Account menu"
      trigger={({ open, toggle }) => (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label="Account menu"
          className="flex items-center gap-2 rounded-full border border-line bg-surface p-0.5 pr-2 text-[0.8125rem] font-medium text-ink shadow-[var(--shadow-inset-top)] transition-colors hover:border-line-strong"
        >
          <IdentityMark name={name} size={26} square={false} />
          <span className="hidden max-w-24 truncate sm:block">{name}</span>
          <Icon name="chevronDown" size={14} className="text-muted" />
        </button>
      )}
    >
      <div className="flex items-center gap-2.5 border-b border-line px-3 py-2.5">
        <IdentityMark name={name} size={34} tone="accent" square={false} />
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 truncate text-[0.8125rem] font-semibold text-ink">
            <span className="truncate">{name}</span>
            {isStaff ? <StaffDot label={user.staffLabel || 'Staff member'} /> : null}
          </p>
          <p className="truncate text-2xs text-muted">@{user.username}</p>
        </div>
      </div>

      <MenuLink href={ROUTES.profile} icon="user">
        Profile
      </MenuLink>
      <MenuLink href={ROUTES.settings} icon="settings">
        Settings
      </MenuLink>
      <MenuLink href={ROUTES.notifications} icon="bell">
        Notifications
      </MenuLink>

      <div className="mt-1 flex items-center justify-between gap-3 border-t border-line px-3 py-2.5">
        <span className="text-2xs font-medium text-muted">Appearance</span>
        <ThemeSwitch theme={theme} />
      </div>
      <div className="border-t border-line p-1.5">
        <SignOutButton variant="ghost" />
      </div>
    </Dropdown>
  );
}
