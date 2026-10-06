'use client';

import { useSignOut } from '@/lib/auth/client-actions';
import { Button } from '@/components/ui';

export function SignOutButton({ variant = 'secondary', label = 'Sign out' }) {
  const { signOut, pending } = useSignOut();
  return (
    <Button variant={variant} onClick={signOut} disabled={pending} icon="logout">
      {pending ? 'Signing out…' : label}
    </Button>
  );
}
