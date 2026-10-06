import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/session';
import { isSupabaseConfigured } from '@/lib/config';
import { ROUTES } from '@/lib/constants';
import { Icon } from '@/components/ui/icons';
import { LoginForm } from '@/components/auth/LoginForm';

export const metadata = { title: 'Sign in' };

/**
 * Sign-in (spec §7). Passwordless: an institutional address and a one-time
 * code. The screen explains the domain rule up front; the database enforces it.
 */
export default async function LoginPage({ searchParams }) {
  if (!isSupabaseConfigured()) redirect('/setup');

  const user = await getCurrentUser();
  if (user && !user.needsProfileSetup) redirect(ROUTES.home);
  if (user && user.needsProfileSetup) redirect('/onboarding');

  const params = await searchParams;
  const next = typeof params?.next === 'string' ? params.next : null;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-12">
      <div className="mb-8">
        <p className="text-2xs uppercase tracking-widest text-muted">Unofficial student project</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Campus+</h1>
        <p className="mt-2 text-[0.9375rem] text-muted">
          Sign in with your PCCOE email address. We send a one-time code — there is no password.
        </p>
      </div>

      <div className="card p-5">
        <LoginForm next={next} />
      </div>

      <ul className="mt-6 flex flex-col gap-2 text-[0.8125rem] text-muted">
        <li className="flex items-start gap-2">
          <Icon name="mail" size={16} className="mt-0.5 shrink-0" />
          Only <span className="text-ink">@pccoepune.org</span> addresses can sign in.
        </li>
        <li className="flex items-start gap-2">
          <Icon name="lock" size={16} className="mt-0.5 shrink-0" />
          Your email stays private. Other students only ever see your @username.
        </li>
      </ul>

      <p className="mt-8 text-2xs text-muted">
        Campus+ is not affiliated with or endorsed by PCCOE. By continuing you agree to keep the
        space respectful and to follow the community rules.{' '}
        <Link href="/rules" className="text-ink underline">
          Read the rules
        </Link>
        .
      </p>
    </div>
  );
}
