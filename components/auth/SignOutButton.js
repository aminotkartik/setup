'use client';

/**
 * The one sign-out control, wherever it is mounted (account menu, mobile menu,
 * settings, account status).
 *
 * It owns exactly three things: the click, the pending state and the error. The
 * flow itself lives in `lib/auth/client-actions.js` — the button never decides
 * that sign-out succeeded.
 *
 * Accessibility: the button reports `aria-busy` while the request is in flight
 * and is disabled then, so a second click cannot start a second sign-out; the
 * error is a `role="alert"` live region, so a screen reader announces a failure
 * that a sighted student sees. Click propagation is stopped because the account
 * menu closes on any click inside it — closing the menu mid-sign-out would
 * unmount this component and drop the error message before it could be read.
 */

import { useSignOut } from '@/lib/auth/client-actions';
import { Button } from '@/components/ui';

export function SignOutButton({ variant = 'secondary', label = 'Sign out' }) {
  const { signOut, pending, error } = useSignOut();

  return (
    <div className="flex w-full flex-col gap-1" onClick={(event) => event.stopPropagation()}>
      <Button
        variant={variant}
        onClick={signOut}
        loading={pending}
        icon="logout"
        className="w-full justify-start"
      >
        {pending ? 'Signing out…' : label}
      </Button>
      {error ? (
        <p role="alert" className="px-1 text-2xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
