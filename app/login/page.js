import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/session';
import { isSupabaseConfigured } from '@/lib/config';
import { describeAuthError, safeNextPath } from '@/lib/auth/oauth';
import { ROUTES } from '@/lib/constants';
import { Icon } from '@/components/ui/icons';
import { Notice } from '@/components/ui';
import { PublicShell } from '@/components/layout/PublicShell';
import { LoginForm } from '@/components/auth/LoginForm';

export const metadata = { title: 'Sign in' };

/**
 * Sign-in (spec §7). Google OAuth only: the student picks their institutional
 * Google account, and the domain rule is enforced server-side after the
 * callback — never by anything typed on this screen.
 *
 * `/auth/callback` sends failures back here as `?error=<code>`; old one-time
 * code links arrive as `?notice=google` (see /login/verify).
 */
export default async function LoginPage({ searchParams }) {
  if (!isSupabaseConfigured()) redirect('/setup');

  const user = await getCurrentUser();
  if (user && !user.needsProfileSetup) redirect(ROUTES.home);
  if (user && user.needsProfileSetup) redirect('/onboarding');

  const params = await searchParams;
  const next = safeNextPath(params?.next);
  const callbackError = describeAuthError(params?.error);
  const notice =
    params?.notice === 'google'
      ? 'Campus+ now signs in with Google. Use the button below with your @pccoepune.org account.'
      : null;

  return (
    <PublicShell
      eyebrow="Unofficial student project"
      title="The campus, in one place"
      description="Sign in with your PCCOE Google account. There is no password and no code to remember."
      width="sm"
      footer={
        <p className="text-2xs leading-relaxed text-muted">
          Campus+ is not affiliated with or endorsed by PCCOE. By continuing you agree to keep the space
          respectful and to follow the{' '}
          <Link href="/rules" className="font-semibold text-ink underline">
            community rules
          </Link>
          .
        </p>
      }
    >
      <div className="glass-strong flex flex-col gap-4 rounded-[var(--radius-xl)] p-5 shadow-[var(--shadow-card)]">
        {callbackError ? (
          <Notice tone="danger" icon="flag">
            {callbackError}
          </Notice>
        ) : null}
        {notice ? (
          <Notice tone="accent" icon="sparkle">
            {notice}
          </Notice>
        ) : null}
        <LoginForm next={next} />
      </div>

      <ul className="mt-7 flex flex-col gap-2.5 text-[0.8125rem] text-muted">
        <li className="flex items-start gap-2.5">
          <Icon name="mail" size={16} className="mt-0.5 shrink-0" />
          <span>
            Only <span className="font-semibold text-ink">@pccoepune.org</span> accounts can sign in.
          </span>
        </li>
        <li className="flex items-start gap-2.5">
          <Icon name="lock" size={16} className="mt-0.5 shrink-0" />
          <span>Your email stays private. Other students only ever see your @username.</span>
        </li>
        <li className="flex items-start gap-2.5">
          <Icon name="users" size={16} className="mt-0.5 shrink-0" />
          <span>Text-first by design: posts, discussions, communities and messages.</span>
        </li>
      </ul>
    </PublicShell>
  );
}
