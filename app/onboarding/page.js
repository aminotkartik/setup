import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/session';
import { isSupabaseConfigured } from '@/lib/config';
import { Icon } from '@/components/ui/icons';
import { PublicShell } from '@/components/layout/PublicShell';
import { OnboardingForm } from '@/components/auth/OnboardingForm';

export const metadata = { title: 'Set up your profile' };

/**
 * First login (spec §8): pick a username and fill in the public profile.
 *
 * Only fields the schema actually stores are asked for. No PRN and no password,
 * and no email to confirm — Google already proved the address.
 */
export default async function OnboardingPage() {
  if (!isSupabaseConfigured()) redirect('/setup');

  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!user.needsProfileSetup) redirect('/home');

  return (
    <PublicShell
      eyebrow="First sign-in"
      title="Set up your profile"
      description="Your username is how other students will find and mention you. It is public; your email is not."
      width="md"
    >
      <div className="card p-4 sm:p-5">
        <OnboardingForm />
      </div>

      <ul className="mt-7 flex flex-col gap-2.5 text-[0.8125rem] text-muted">
        <li className="flex items-start gap-2">
          <Icon name="user" size={16} className="mt-0.5 shrink-0" />
          Usernames use lowercase letters, numbers and underscores (3–24 characters).
        </li>
        <li className="flex items-start gap-2">
          <Icon name="settings" size={16} className="mt-0.5 shrink-0" />
          You can change it later from Settings, subject to the platform cooldown.
        </li>
      </ul>
    </PublicShell>
  );
}
