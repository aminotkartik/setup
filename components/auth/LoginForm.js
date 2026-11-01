'use client';

import { useState } from 'react';
import { startGoogleSignIn } from '@/lib/actions/auth';
import { createGoogleSignInHandler } from '@/lib/auth/sign-in';
import { Button, Notice } from '@/components/ui';
import { Icon } from '@/components/ui/icons';

/**
 * Small official Google mark. Decorative because the adjacent text already
 * names the provider; no external image request or icon font is involved.
 */
function GoogleMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="17"
      height="17"
      className="login-google-mark"
      aria-hidden="true"
      focusable="false"
    >
      <path fill="var(--google-blue)" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82Z" />
      <path fill="var(--google-green)" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24Z" />
      <path fill="var(--google-yellow)" d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.56.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09Z" />
      <path fill="var(--google-red)" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96Z" />
    </svg>
  );
}

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
 *
 * The submission deliberately does NOT use the shared `useFormAction()`
 * helper. That helper serves in-app actions: after `onSuccess` it always
 * refreshes the current route through the Next.js router. Here `onSuccess`
 * starts an external full-page navigation to Google, and refreshing `/login`
 * straight after it races (and on iPhone Safari, visibly wins against) that
 * navigation — the screen reloaded instead of leaving for Google. So this
 * form has its own handler (`lib/auth/sign-in.js`, unit-tested): explicit
 * pending/error state, one guarded submission, `preventDefault`, the
 * validated `next` path carried in the FormData, and nothing at all after
 * the external navigation. The form likewise has no `action` prop — `onSubmit`
 * is the single submission path, so one tap can only ever start one Google
 * round trip (a second would overwrite the PKCE verifier cookie the callback
 * exchanges against).
 *
 * `children` are the page's notices (callback error, old-link notice). They sit
 * after the button so the sign-in action stays directly beneath the
 * introduction, and they are rendered exactly as before.
 */
export function LoginForm({ next = null, children = null }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  // Created once and kept stable across renders: the handler's closure owns
  // the synchronous single-flight guard, which a per-render handler would
  // lose. `next` comes from the server-rendered page and does not change
  // during this form's life; the server action validates it again anyway.
  const [handleSubmit] = useState(() =>
    createGoogleSignInHandler({
      next,
      startSignIn: startGoogleSignIn,
      // A full browser hop, exactly like clicking a link to Google. The
      // Next.js router is not involved — no push, no refresh afterwards.
      navigate: (url) => window.location.assign(url),
      setPending,
      setError,
    }),
  );

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <Button
        type="submit"
        variant="primary"
        size="lg"
        loading={pending}
        className="login-google-button w-full"
      >
        {pending ? (
          'Taking you to Google…'
        ) : (
          <span
            className="login-google-label"
            style={{
              display: 'inline-flex',
              flexDirection: 'row',
              flexWrap: 'nowrap',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 'var(--space-xs, 0.5rem)',
              whiteSpace: 'nowrap',
            }}
          >
            <GoogleMark />
            <span>Continue with Google</span>
          </span>
        )}
      </Button>

      {children}

      {error ? (
        <Notice tone="danger" icon="flag">
          {error}
        </Notice>
      ) : null}

      <p className="text-2xs text-ink-soft">
        You will be sent to Google to choose your account. Campus+ never sees your Google password and
        never posts anything on your behalf.
      </p>

      <p className="flex items-center gap-1.5 text-2xs text-ink-soft">
        <Icon name="lock" size={13} className="shrink-0" />
        Sessions are created on the server, only after Google confirms your address.
      </p>
    </form>
  );
}
