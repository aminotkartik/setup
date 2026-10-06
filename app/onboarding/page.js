import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/session';
import { isSupabaseConfigured } from '@/lib/config';
import { Icon } from '@/components/ui/icons';
import { OnboardingForm } from '@/components/auth/OnboardingForm';

export const metadata = { title: 'Set up your profile' };

/**
 * First login (spec §8): pick a username and fill in the public profile.
 *
 * Only fields the schema actually stores are asked for. No PRN, no password,
 * no email confirmation (the code already proved the address).
 */
export default async function OnboardingPage() {
  if (!isSupabaseConfigured()) redirect('/setup');

  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!user.needsProfileSetup) redirect('/home');

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center px-5 py-12">
      <p className="text-2xs uppercase tracking-widest text-muted">First sign-in</p>
      <h1 className="mt-2 text-xl font-semibold tracking-tight">Set up your profile</h1>
      <p className="mt-2 text-[0.9375rem] text-muted">
        Your username is how other students will find and mention you. It is public; your email is not.
      </p>

      <div className="card mt-6 p-5">
        <OnboardingForm />
      </div>

      <ul className="mt-6 flex flex-col gap-2 text-[0.8125rem] text-muted">
        <li className="flex items-start gap-2">
          <Icon name="user" size={16} className="mt-0.5 shrink-0" />
          Usernames use lowercase letters, numbers and underscores (3–24 characters).
        </li>
        <li className="flex items-start gap-2">
          <Icon name="settings" size={16} className="mt-0.5 shrink-0" />
          You can change it later from Settings, subject to the platform cooldown.
        </li>
      </ul>
    </div>
  );
}
