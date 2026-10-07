'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ROUTES } from '@/lib/constants';
import { Icon } from '@/components/ui/icons';
import { StaffDot } from '@/components/ui';
import { SignOutButton } from '@/components/auth/SignOutButton';

/**
 * The one account control (top-right, every layout).
 *
 * Previously there was no single place to reach "my account": desktop had an
 * identity card at the bottom of the sidebar with no sign-out action, mobile
 * had nothing in the header at all, and Settings had two separate "Sign out"
 * buttons on its own page. This is the single, consistent entry point —
 * avatar, profile, settings, sign out — rendered in the same top-right corner
 * on every screen size.
 */
export function AccountMenu({ user = null, isStaff = false }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onClick = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  if (!user) {
    return (
      <Link href="/login" className="text-sm font-medium text-ink hover:no-underline">
        Sign in
      </Link>
    );
  }

  const initial = (user.displayName || user.username || '?').trim().slice(0, 1).toUpperCase();

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Account menu"
        className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-white text-[0.8125rem] font-medium text-muted hover:text-ink"
      >
        {initial}
      </button>
      {open ? (
        <div role="menu" className="card absolute right-0 top-11 z-30 w-56 py-1 shadow-sm">
          <div className="border-b border-line px-3 py-2">
            <p className="flex items-center gap-1.5 truncate text-[0.8125rem] font-medium text-ink">
              <span className="truncate">{user.displayName || `@${user.username}`}</span>
              {isStaff ? <StaffDot label={user.staffLabel || 'Staff member'} /> : null}
            </p>
            <p className="truncate text-2xs text-muted">@{user.username}</p>
          </div>
          <Link
            href={ROUTES.profile}
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-3 px-3 py-2 text-sm text-ink hover:bg-canvas hover:no-underline"
          >
            <Icon name="user" size={17} />
            Profile
          </Link>
          <Link
            href={ROUTES.settings}
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-3 px-3 py-2 text-sm text-ink hover:bg-canvas hover:no-underline"
          >
            <Icon name="settings" size={17} />
            Settings
          </Link>
          <div className="px-3 pb-1 pt-2">
            <SignOutButton variant="ghost" />
          </div>
        </div>
      ) : null}
    </div>
  );
}
