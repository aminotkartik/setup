'use client';

import { useSignOut } from '@/lib/auth/client-actions';
import { Button } from '@/components/ui';

export function SignOutButton({ variant = 'secondary', label = 'Sign out' }) {
  const { signOut, pending, error } = useSignOut();
  return (
    <div className="flex flex-col gap-1 w-full" onClick={(e) => e.stopPropagation()}>
      <Button variant={variant} onClick={signOut} disabled={pending} icon="logout" className="w-full justify-start">
        {pending ? 'Signing out…' : label}
      </Button>
      {error ? <p className="text-2xs text-danger px-1">{error}</p> : null}
    </div>
  );
}
