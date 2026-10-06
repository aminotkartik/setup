'use client';

import { useState } from 'react';
import { useFormAction } from '@/lib/forms';
import { verifyLoginCode, resendLoginCode } from '@/lib/actions/auth';
import { Button, Field, Input, Notice } from '@/components/ui';

/** Step 2 of sign-in: verify the one-time code (and resend if it never arrived). */
export function VerifyForm({ email }) {
  const { run, pending, error, fieldErrors } = useFormAction(verifyLoginCode);
  const { run: resend, pending: resending, error: resendError } = useFormAction(resendLoginCode);
  const [sent, setSent] = useState(false);

  return (
    <form
      action={run}
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        run(new FormData(event.currentTarget));
      }}
    >
      <input type="hidden" name="email" value={email} />

      <Field label="Six-digit code" htmlFor="token" required error={fieldErrors?.token}>
        <Input
          id="token"
          name="token"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          placeholder="000000"
          required
          autoFocus
          className="tracking-[0.4em]"
          aria-invalid={fieldErrors?.token ? 'true' : undefined}
        />
      </Field>

      {error ? (
        <Notice tone="danger" icon="flag">
          {error}
        </Notice>
      ) : null}
      {sent && !resendError ? (
        <Notice tone="success" icon="check">
          A new code is on its way to {email}.
        </Notice>
      ) : null}
      {resendError ? (
        <Notice tone="danger" icon="flag">
          {resendError}
        </Notice>
      ) : null}

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? 'Verifying…' : 'Verify and continue'}
      </Button>

      <button
        type="button"
        className="text-2xs text-muted underline hover:text-ink disabled:opacity-50"
        disabled={resending || pending}
        onClick={() => {
          const data = new FormData();
          data.set('email', email);
          resend(data);
          setSent(true);
        }}
      >
        {resending ? 'Sending a new code…' : 'Didn’t get it? Send a new code'}
      </button>
    </form>
  );
}
