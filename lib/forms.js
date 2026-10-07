'use client';

/**
 * Form state helpers shared by every client form in Campus+.
 * Keeps loading / success / error handling consistent (spec §70).
 */

import { useCallback, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Wrap a server action returning `{ ok, error, details, ... }`.
 *
 * `redirectTo` may be a string, a function `(result) => string`, or omitted.
 * The function form is safe here because `useFormAction` is a client hook —
 * every caller that passes a closure (`ConversationActions`, `MessageButton`,
 * `ListingActions`, …) already constructs it inside a `'use client'` module,
 * so it never crosses the server/client boundary.
 *
 * The one place this used to break was `ActionForm`, which is a Client
 * Component rendered *from Server Component pages*: a page like
 * `/communities/new` (no `'use client'`) cannot hand `ActionForm` a closure
 * prop — React rejects passing plain functions across that boundary ("Functions
 * cannot be passed directly to Client Components unless you explicitly expose
 * it by marking it with 'use server'"), which crashed the whole page. The fix
 * is on the caller side: when the action itself returns `{ ok: true, href }`
 * (every creation action does), that `href` is now used automatically whenever
 * `redirectTo` is not given, so Server Component pages never need to pass a
 * closure at all.
 *
 * @param {Function} action  async (formData) => { ok, error?, href?, ... }
 * @param {{ onSuccess?: Function, redirectTo?: string|((result: object) => string), resetOnSuccess?: boolean }} options
 */
export function useFormAction(action, { onSuccess, redirectTo, resetOnSuccess = false } = {}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState(null);
  const [success, setSuccess] = useState(false);

  const run = useCallback(
    (formData) => {
      setError(null);
      setFieldErrors(null);
      setSuccess(false);
      const shouldReset = resetOnSuccess;
      startTransition(async () => {
        let result;
        try {
          result = await action(formData);
        } catch (thrown) {
          setError(thrown?.message || 'Something went wrong. Please try again.');
          return;
        }
        if (!result || result.ok === false) {
          setError(result?.error || 'Something went wrong. Please try again.');
          setFieldErrors(result?.details || null);
          return;
        }
        setSuccess(true);
        if (shouldReset && formData instanceof FormData) formData = null;
        if (onSuccess) onSuccess(result);
        // Explicit redirectTo (string or function) wins; otherwise follow the
        // action's own `href` (the convention every create/navigate action
        // returns), so Server Component pages never need to pass a closure.
        const target = typeof redirectTo === 'function' ? redirectTo(result) : redirectTo || result?.href || null;
        if (target) router.push(target);
        router.refresh();
      });
    },
    [action, onSuccess, redirectTo, resetOnSuccess, router],
  );

  return { run, pending, error, fieldErrors, success, setError, reset: () => { setError(null); setSuccess(false); } };
}

/** Read a FormData object as a plain object (first value wins). */
export function formToObject(formData) {
  const output = {};
  for (const [key, value] of formData.entries()) {
    if (key.endsWith('[]')) {
      const clean = key.slice(0, -2);
      output[clean] = [...(output[clean] || []), value];
    } else if (output[key] === undefined) {
      output[key] = value;
    }
  }
  return output;
}
