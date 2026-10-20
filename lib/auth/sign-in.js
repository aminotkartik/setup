/**
 * Starting Google sign-in — pure async logic, no React, no Next.js imports.
 *
 * This is the mirror image of `lib/auth/sign-out.js`: the one piece of
 * behaviour that has to be *right* lives here, where the unit tests can drive
 * it directly with fakes, and `components/auth/LoginForm.js` only wires it to
 * React state and the browser.
 *
 * Why sign-in does not go through the generic `useFormAction()` helper
 * (`lib/forms.js`): that helper is built for in-app actions. After a
 * successful result it follows an internal `href` with the Next.js router and
 * then *always* refreshes the current route. Google sign-in is neither — its
 * success is an external full-page navigation (`window.location.assign` to
 * Google). Refreshing `/login` after starting that navigation races it: the
 * route re-renders instead of leaving, which on iPhone Safari showed up as
 * the login screen reloading / looping instead of opening Google. An external
 * hop must be the last thing that happens, with no router work after it.
 *
 * The rules enforced here, in order:
 *
 *   1. The browser's native form submission is always prevented, and the
 *      FormData is built synchronously from the form (before any `await`,
 *      while `event.currentTarget` is still valid), carrying the
 *      already-validated `next` path. The server action validates `next`
 *      again — this module never decides where OAuth returns to.
 *   2. Exactly one submission is ever in flight. The guard is a closure flag,
 *      not React state: two taps in the same tick both read stale state, but
 *      only the first passes here. This matters beyond tidiness — every call
 *      to the server action asks Supabase for a fresh authorization URL and
 *      overwrites the PKCE code-verifier cookie, so a second call could hand
 *      the browser a Google URL whose challenge no longer matches the cookie
 *      `/auth/callback` will exchange against, failing a good sign-in.
 *   3. On success the caller-supplied `navigate` performs the external hop and
 *      nothing runs after it: no router navigation, no refresh, no second
 *      submission. `pending` deliberately stays on — the browser is leaving,
 *      and on a slow connection the button must stay disabled until it does.
 *   4. On failure the server action's user-friendly error is surfaced as-is
 *      (or a generic message when the call itself threw) and `pending` is
 *      cleared, so the student can simply try again.
 *
 * No session is created here and none could be: this only asks the server
 * action for Google's authorization URL. The session is still created exactly
 * once, server-side, in `app/auth/callback/route.js`.
 */

/** Copy shown when sign-in could not even be started (network, thrown call). */
export const SIGN_IN_FAILED = 'We could not start Google sign-in. Please try again.';

/**
 * Build the submit handler for the "Continue with Google" form.
 *
 * The handler is created once by the component and kept stable across
 * renders, because its closure owns the single-flight guard.
 *
 * @param {object} options
 * @param {string|null} [options.next]
 *   post-sign-in destination, already validated by the page (`safeNextPath`);
 *   the server action re-validates it before building the callback URL
 * @param {(formData: FormData) => Promise<{ok: boolean, url?: string, error?: string}>} options.startSignIn
 *   the `startGoogleSignIn` server action
 * @param {(url: string) => void} options.navigate
 *   performs the external navigation (`window.location.assign` in the browser)
 * @param {(pending: boolean) => void} options.setPending
 * @param {(error: string|null) => void} options.setError
 * @returns {(event: { preventDefault(): void, currentTarget?: HTMLFormElement }) => Promise<void>}
 */
export function createGoogleSignInHandler({ next = null, startSignIn, navigate, setPending, setError }) {
  let inFlight = false;

  return async function handleGoogleSignInSubmit(event) {
    event?.preventDefault();
    if (inFlight) return;
    inFlight = true;
    setError(null);
    setPending(true);

    // Built synchronously: `currentTarget` is only the form during dispatch,
    // and the validated destination rides along for the server action (which
    // validates it again before it reaches the OAuth callback URL).
    const formData = new FormData(event?.currentTarget);
    if (next) formData.set('next', next);

    let result = null;
    try {
      result = await startSignIn(formData);
    } catch {
      result = null;
    }

    if (!result || result.ok === false || typeof result.url !== 'string' || !result.url) {
      // Failure: explain, re-enable the button, allow a retry. The action's
      // messages are written for students; a thrown call gets the generic one.
      setError(result?.error || SIGN_IN_FAILED);
      inFlight = false;
      setPending(false);
      return;
    }

    // Success: a full browser hop to Google, exactly like clicking a link —
    // and the end of this handler. Nothing may follow it (no router push or
    // refresh); `inFlight`/`pending` stay set so the disabled button cannot
    // submit again while a slower browser is still leaving the page.
    navigate(result.url);
  };
}
