'use client';

import { useEffect } from 'react';
import { Button, ErrorState } from '@/components/ui';

/**
 * Root error boundary. Users see one plain sentence and one action; the
 * technical detail is logged and never rendered.
 */
export default function GlobalError({ error, reset }) {
  useEffect(() => {
    console.error('[campus+] render error', error?.digest || error?.message);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-14">
      <ErrorState
        title="Something went wrong"
        description="This page could not be loaded. Nothing was lost — try again, and if it keeps happening tell a moderator."
        action={
          <Button onClick={reset} icon="refresh" tone="accent">
            Try again
          </Button>
        }
      />
    </div>
  );
}
