'use client';

import { useFormAction } from '@/lib/forms';
import { sendLoginCode } from '@/lib/actions/auth';
import { Button, Field, Input, Notice } from '@/components/ui';
import { Icon } from '@/components/ui/icons';

/**
 * Step 1 of sign-in: institutional email → one-time code.
 * The domain rule is enforced server-side; the hint is only a hint.
 */
export function LoginForm({ next = null }) {
  const { run, pending, error, fieldErrors } = useFormAction(sendLoginCode);

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
      <Field
        label="Institutional email"
        htmlFor="email"
        required
        error={fieldErrors?.email}
        hint="For example: yourname@pccoepune.org"
      >
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder="yourname@pccoepune.org"
          required
          autoFocus
          aria-invalid={fieldErrors?.email ? 'true' : undefined}
        />
      </Field>

      {error ? (
        <Notice tone="danger" icon="flag">
          {error}
        </Notice>
      ) : null}

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? 'Sending code…' : 'Send one-time code'}
        {!pending ? <Icon name="chevronRight" size={16} /> : null}
      </Button>

      <p className="text-2xs text-muted">
        The code is valid for a short time and can only be used once. If you do not see the email,
        check your spam folder before requesting another.
      </p>
    </form>
  );
}
