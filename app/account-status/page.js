import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser, BLOCKED_STATUSES } from '@/lib/auth/session';
import { isSupabaseConfigured } from '@/lib/config';
import { formatDateTime } from '@/lib/utils';
import { Notice } from '@/components/ui';
import { PublicShell } from '@/components/layout/PublicShell';
import { Icon } from '@/components/ui/icons';
import { SignOutButton } from '@/components/auth/SignOutButton';

export const metadata = { title: 'Account unavailable' };

/**
 * Where suspended/banned/deactivated students land (spec §83).
 *
 * The message is deliberately plain: the account state is enforced server-side
 * everywhere, so there is nothing to work around and nothing to hide.
 */
export default async function AccountStatusPage() {
  if (!isSupabaseConfigured()) redirect('/setup');
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!BLOCKED_STATUSES.includes(user.accountStatus)) redirect(user.needsProfileSetup ? '/onboarding' : '/home');

  const copy = {
    suspended: 'Your account is suspended.',
    banned: 'Your account has been banned.',
    deactivated: 'Your account is deactivated.',
    deleted: 'Your account is closed.',
  };

  return (
    <PublicShell
      eyebrow="Account unavailable"
      title={copy[user.accountStatus] || 'Account unavailable'}
      description="You can still see this message, but Campus+ is read-only or unavailable for this account."
      width="sm"
    >

      {user.profile?.status_reason ? (
        <Notice tone="warning" className="mt-5" icon="shield">
          <p className="font-medium text-ink">Reason given</p>
          <p className="mt-1">{user.profile.status_reason}</p>
        </Notice>
      ) : null}

      {user.suspendedUntil ? (
        <p className="mt-4 text-[0.8125rem] text-muted">
          The suspension lifts automatically on {formatDateTime(user.suspendedUntil)}.
        </p>
      ) : null}

      <Notice tone="neutral" className="mt-5" icon="mail">
        Think this is a mistake? Use the contact details in the{' '}
        <Link href="/campus/help" className="text-ink underline">
          help directory
        </Link>{' '}
        to reach the campus team.
      </Notice>

      <p className="mt-6 flex items-center gap-2 text-2xs text-muted">
        <Icon name="lock" size={14} />
        Account state is enforced by the database, not by this screen.
      </p>

      <div className="mt-8">
        <SignOutButton />
      </div>
    </PublicShell>
  );
}
