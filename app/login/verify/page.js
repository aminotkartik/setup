import Link from 'next/link';
import { redirect } from 'next/navigation';
import { isSupabaseConfigured } from '@/lib/config';
import { Icon } from '@/components/ui/icons';
import { VerifyForm } from '@/components/auth/VerifyForm';

export const metadata = { title: 'Enter your code' };

/** Step 2 of sign-in: the six-digit code. */
export default async function VerifyPage({ searchParams }) {
  if (!isSupabaseConfigured()) redirect('/setup');
  const params = await searchParams;
  const email = typeof params?.email === 'string' ? params.email.toLowerCase() : '';

  if (!email) redirect('/login');

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-12">
      <Link href="/login" className="mb-6 inline-flex items-center gap-1 text-2xs text-muted hover:text-ink">
        <Icon name="chevronLeft" size={13} />
        Use a different address
      </Link>

      <h1 className="text-xl font-semibold tracking-tight">Enter your code</h1>
      <p className="mt-2 text-[0.9375rem] text-muted">
        We sent a six-digit code to <span className="break-anywhere text-ink">{email}</span>.
      </p>

      <div className="card mt-6 p-5">
        <VerifyForm email={email} />
      </div>
    </div>
  );
}
