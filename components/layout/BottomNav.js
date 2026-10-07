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
 * codebase, not a separate mobile app. The bar is a glass surface so content
 * scrolling underneath stays readable.
 */
export function BottomNav({ unreadNotifications = 0 }) {
  const pathname = usePathname();

  return (
    <GlassSurface
      as="nav"
      rounded={false}
      tone="soft"
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line/70 pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <div className="mx-auto flex max-w-lg items-stretch px-1">
        {MOBILE_NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link key={item.href} href={item.href} aria-current={active ? 'page' : undefined} className="tab-item">
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
  );
}
