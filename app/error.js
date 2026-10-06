'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui';
import { Icon } from '@/components/ui/icons';

/**
 * Root error boundary. Users see a plain message; the technical detail is
 * logged server-side by lib/errors.js, never rendered here.
 */
export default function GlobalError({ error, reset }) {
  useEffect(() => {
    console.error('[campus+] render error', error?.digest || error?.message);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-14 text-center">
      <Icon name="flag" size={22} className="mx-auto text-muted" />
      <h1 className="mt-3 text-xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="mt-2 text-[0.9375rem] text-muted">
        The page could not be loaded. Nothing was lost — try again.
      </p>
      <div className="mt-6 flex justify-center">
        <Button onClick={reset} icon="refresh">
          Try again
        </Button>
      </div>
    </div>
  );
}
