import Link from 'next/link';
import { ROUTES } from '@/lib/constants';
import { Icon } from '@/components/ui/icons';
import { Sidebar } from '@/components/layout/Sidebar';
import { BottomNav } from '@/components/layout/BottomNav';
import { MobileMenu } from '@/components/layout/MobileMenu';
import { AccountMenu } from '@/components/layout/AccountMenu';

/**
 * The one application frame (spec §5).
 *
 * Desktop: fixed sidebar, centred content column (max 44rem for reading comfort).
 * Mobile: a compact sticky header plus the bottom tab bar.
 *
 * `user` is the shape returned by lib/auth/session.js; pass `null` for public
 * screens such as /login.
 */
export function AppShell({ user = null, unreadNotifications = 0, canModerate = false, canAdmin = false, children }) {
  const isStaff = Boolean(user?.roles?.some((role) => ['moderator', 'admin', 'super_admin'].includes(role)));

  return (
    <div className="min-h-dvh">
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:border focus:border-line focus:bg-white focus:px-3 focus:py-2 focus:text-sm"
      >
        Skip to content
      </a>

      <Sidebar
        user={user}
        unreadNotifications={unreadNotifications}
        isStaff={isStaff}
        canModerate={canModerate}
        canAdmin={canAdmin}
      />

      <div className="lg:pl-60">
        {/* Mobile: compact sticky header. Account control lives top-right,
            the same corner it occupies on desktop below. */}
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-line bg-canvas/95 px-4 backdrop-blur-sm lg:hidden">
          <MobileMenu canModerate={canModerate} canAdmin={canAdmin} />
          <Link href={ROUTES.home} className="flex items-baseline gap-1.5 hover:no-underline">
            <span className="text-sm font-semibold tracking-tight">Campus+</span>
            <span className="text-2xs text-muted">PCCOE</span>
          </Link>
          <div className="flex items-center gap-1">
            <Link href={ROUTES.notifications} className="relative p-2 text-muted hover:text-ink" aria-label="Notifications">
              <Icon name="bell" size={20} />
              {unreadNotifications > 0 ? (
                <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
              ) : null}
            </Link>
            <AccountMenu user={user} isStaff={isStaff} />
          </div>
        </header>

        {/* Desktop: the sidebar carries primary nav and branding, so this bar
            exists only to hold the one account control, top-right, every time. */}
        <header className="sticky top-0 z-20 hidden h-14 items-center justify-end border-b border-line bg-canvas/95 px-6 backdrop-blur-sm lg:flex">
          <AccountMenu user={user} isStaff={isStaff} />
        </header>

        <main id="content" className="mx-auto w-full max-w-3xl px-4 pb-24 pt-5 lg:pb-16">
          {children}
        </main>
      </div>

      <BottomNav />
    </div>
  );
}
