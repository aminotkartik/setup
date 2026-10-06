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
 * @param {Function} action  async (formData) => { ok, error?, ... }
 * @param {{ onSuccess?: Function, redirectTo?: string|Function, resetOnSuccess?: boolean }} options
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
        if (redirectTo) {
          const target = typeof redirectTo === 'function' ? redirectTo(result) : redirectTo;
          if (target) router.push(target);
        }
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
