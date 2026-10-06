'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ROUTES } from '@/lib/constants';
import { Icon } from '@/components/ui/icons';

/**
 * The mobile "everything else" menu: Chat and Profile live in the bottom bar,
 * so this holds Random, Notifications, Settings and (for staff) the panels.
 * A plain <dialog>-less disclosure with Escape/outside-click handling keeps it
 * accessible without a dependency.
 */
export function MobileMenu({ canModerate = false, canAdmin = false }) {
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

  const items = [
    { href: ROUTES.random, label: 'Random', icon: 'sparkle' },
    { href: ROUTES.notifications, label: 'Notifications', icon: 'bell' },
    { href: ROUTES.settings, label: 'Settings', icon: 'settings' },
    ...(canModerate ? [{ href: ROUTES.moderator, label: 'Moderation', icon: 'shield' }] : []),
    ...(canAdmin ? [{ href: ROUTES.admin, label: 'Admin', icon: 'eye' }] : []),
  ];

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="More"
        className="p-2 text-muted hover:text-ink"
      >
        <Icon name="dots" size={20} />
      </button>
      {open ? (
        <div
          role="menu"
          className="card absolute left-0 top-11 z-30 w-52 py-1 shadow-sm"
        >
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 px-3 py-2 text-sm text-ink hover:bg-canvas hover:no-underline"
            >
              <Icon name={item.icon} size={17} />
              {item.label}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
