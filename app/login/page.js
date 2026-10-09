import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/session';
import { isSupabaseConfigured } from '@/lib/config';
import { describeAuthError, safeNextPath } from '@/lib/auth/oauth';
import { ROUTES } from '@/lib/constants';
import { Icon } from '@/components/ui/icons';
import { GlassSurface, Notice } from '@/components/ui';
import { BrandLockup, CollegeCrest } from '@/components/brand/Brand';
import { LoginForm } from '@/components/auth/LoginForm';
import { ParticleField } from '@/components/atmosphere/ParticleField';

export const metadata = { title: 'Sign in' };

/**
 * Sign-in (spec §7). Google OAuth only: the student picks their institutional
 * Google account, and the domain rule is enforced server-side after the
 * callback — never by anything typed on this screen.
 *
 * `/auth/callback` sends failures back here as `?error=<code>`; old one-time
 * code links arrive as `?notice=google` (see /login/verify).
 *
 * The layout is the product's front door: the brand, one blue call to action
 * and the three facts that matter. A cinematic stage — the blue particle sky
 * (atmosphere, paused whenever the tab hides) with a single theme-paired glass
 * panel floating over it. This is the only place besides Home allowed to run
 * the full atmosphere.
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
    <div className="cinematic-stage min-h-dvh">
      <ParticleField density={1} interactive />
      <div className="relative z-10 mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center px-5 py-10 sm:py-14">
      {/* Brand area — the logo carries the identity before a single word is read. */}
      <div className="login-sky flex flex-col items-start">
        <BrandLockup href="/" size="lg" className="login-halo w-fit" wordClass="text-[1.3125rem]" />
        <div className="mt-6 flex items-center gap-3">
          <CollegeCrest size={56} />
          <p className="t-label">Unofficial student project</p>
        </div>
        <h1 className="t-display mt-2">The campus, in one place</h1>
        <p className="t-secondary mt-2.5 max-w-md">
          Sign in with your PCCOE Google account. There is no password and no code to remember.
        </p>
      </div>

      <GlassSurface tone="cinematic" rounded className="glass-sheen mt-7 flex flex-col gap-4 p-5 sm:p-6">
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
      </GlassSurface>

      <ul className="login-sky mt-7 flex flex-col gap-2.5 text-[0.8125rem] text-muted">
        <li className="flex items-start gap-2.5">
          <span className="login-fact">
            <Icon name="mail" size={15} />
          </span>
          <span>
            Only <span className="font-semibold text-ink">@pccoepune.org</span> accounts can sign in.
          </span>
        </li>
        <li className="flex items-start gap-2.5">
          <span className="login-fact">
            <Icon name="lock" size={15} />
          </span>
          <span>Your email stays private. Other students only ever see your @username.</span>
        </li>
        <li className="flex items-start gap-2.5">
          <span className="login-fact">
            <Icon name="users" size={15} />
          </span>
          <span>Text-first by design: posts, discussions, communities and messages.</span>
        </li>
      </ul>

      <p className="login-sky mt-8 text-2xs leading-relaxed text-muted">
        Campus+ is not affiliated with or endorsed by PCCOE. By continuing you agree to keep the space
        respectful and to follow the{' '}
        <Link href="/rules" className="font-semibold text-ink underline">
          community rules
        </Link>
        .
      </p>
      </div>
    </div>
  );
}
