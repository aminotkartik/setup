'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MOBILE_NAV } from '@/lib/constants';
import { Icon } from '@/components/ui/icons';
import { GlassSurface } from '@/components/ui';

/**
 * Mobile navigation: Home · Explore · Market · Chat · Profile.
 *
 * The same routes render on both form factors — this is one responsive
 * codebase, not a separate mobile app. The bar is a floating glass pill with
 * the safe area respected, so a glimpse of content shows underneath and the
 * thumb always lands on the same five targets.
 */
export function BottomNav({ unreadNotifications = 0 }) {
  const pathname = usePathname();

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden">
      <GlassSurface
        as="nav"
        tone="floating"
        aria-label="Primary"
        className="mx-auto flex max-w-md rounded-2xl border border-glass-border"
      >
        <div className="flex w-full items-stretch">
          {MOBILE_NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className="tab-item rounded-2xl"
              >
                <span className="relative">
                  <Icon name={item.icon} size={20} className="tab-icon" />
                  {item.icon === 'bell' && unreadNotifications > 0 ? <span className="unread-dot absolute -right-1.5 -top-1" /> : null}
                </span>
                {item.label}
              </Link>
            );
          })}
        </div>
      </GlassSurface>
    </div>
  );
}
