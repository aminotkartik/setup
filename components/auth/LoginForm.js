'use client';

import { useFormAction } from '@/lib/forms';
import { startGoogleSignIn } from '@/lib/actions/auth';
import { Button, Notice } from '@/components/ui';
import { Icon } from '@/components/ui/icons';

/**
 * Sign-in (spec §7): a single "Continue with Google" button.
 *
 * There is no email field and no code to type any more — the institutional
 * domain rule is enforced after Google authenticates the student, on the
 * server, in `/auth/callback`.
 *
 * The action returns the Google authorization URL and this component navigates
 * to it. That is what fixes the old NEXT_REDIRECT problem: the previous
 * one-time-code action called `redirect()` inside its own `try/catch`, so the
 * `NEXT_REDIRECT` control-flow error was caught and reported as a failure. Now
 * no server action redirects at all — success is a plain return value.
 */
export function LoginForm({ next = null }) {
  const { run, pending, error } = useFormAction(startGoogleSignIn, {
    onSuccess: ({ url }) => {
      // A full browser hop, exactly like clicking a link to Google.
      if (typeof url === 'string' && url) window.location.assign(url);
    },
  });

  return (
    <form
      action={run}
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        if (next) data.set('next', next);
        run(data);
      }}
    >
      {error ? (
        <Notice tone="danger" icon="flag">
          {error}
        </Notice>
      ) : null}

      <Button type="submit" tone="accent" size="lg" disabled={pending} className="w-full" icon="chevronRight">
        {pending ? 'Taking you to Google…' : 'Continue with Google'}
      </Button>

      <p className="text-2xs text-muted">
        You will be sent to Google to choose your account. Campus+ never sees your Google password and
        never posts anything on your behalf.
      </p>

      <p className="flex items-center gap-1.5 text-2xs text-muted">
        <Icon name="lock" size={13} className="shrink-0" />
        Sessions are created on the server, only after Google confirms your address.
      </p>
    </form>
  );
}
