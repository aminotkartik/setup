import { Sidebar } from '@/components/layout/Sidebar';
import { ShellHeader } from '@/components/layout/ShellHeader';
import { BottomNav } from '@/components/layout/BottomNav';

/**
 * The one application frame.
 *
 * Desktop: a light rail with the brand, the Create action and navigation, plus
 * a glass header carrying search, notifications, appearance and the account.
 * Mobile: a compact glass header and the bottom tab bar, with everything else
 * behind the menu sheet.
 *
 * The content column is deliberately narrow for reading; pages that need a
 * contextual rail opt in with `.page-grid` and the shell widens itself.
 *
 * `user` is the shape returned by lib/auth/session.js; pass `null` for public
 * screens such as /login.
 */
export function AppShell({
  user = null,
  unreadNotifications = 0,
  canModerate = false,
  canAdmin = false,
  createItems = [],
  theme = 'dark',
  children,
}) {
  const isStaff = Boolean(user?.roles?.some((role) => ['moderator', 'admin', 'super_admin'].includes(role)));

  return (
    <div className="min-h-dvh">
      <a href="#content" className="skip-link">
        Skip to content
      </a>

      <Sidebar
        user={user}
        unreadNotifications={unreadNotifications}
        isStaff={isStaff}
        canModerate={canModerate}
        canAdmin={canAdmin}
        createItems={createItems}
      />

      <div className="lg:pl-[17rem]">
        <ShellHeader
          user={user}
          unreadNotifications={unreadNotifications}
          isStaff={isStaff}
          canModerate={canModerate}
          canAdmin={canAdmin}
          theme={theme}
          createItems={createItems}
        />

        <main id="content" className="shell-content mx-auto w-full px-4 pb-28 pt-6 sm:px-6 lg:pb-16 lg:pt-8">
          {children}
        </main>
      </div>

      <BottomNav unreadNotifications={unreadNotifications} />
    </div>
  );
}
