/**
 * Consistent error handling (spec §70).
 *
 * Domain errors carry a user-safe `message` and an HTTP-ish `code`. Technical
 * details are logged server-side and never returned to the browser.
 */

export const ERROR_CODES = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  validation: 422,
  configuration: 503,
  internal: 500,
};

export class AppError extends Error {
  constructor(code, message, { details = null, cause = null, log = true } = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_CODES[code] || 500;
    this.details = details;
    this.cause = cause ?? undefined;
    this.expose = true;
    if (log) logError(this, { silent: code === 'validation' });
  }
}

export const errors = {
  unauthenticated: (message = 'Sign in to continue.') => new AppError('unauthenticated', message),
  forbidden: (message = 'You do not have permission to do that.') => new AppError('forbidden', message),
  notFound: (message = 'That item could not be found.') => new AppError('not_found', message),
  conflict: (message = 'That conflicts with something that already exists.') => new AppError('conflict', message),
  rateLimited: (message, details) => new AppError('rate_limited', message, { details }),
  validation: (message = 'Please check the highlighted fields.', details) =>
    new AppError('validation', message, { details }),
  configuration: (message = 'This feature is not configured yet.') =>
    new AppError('configuration', message),
  internal: (message = 'Something went wrong on our side. Please try again.', cause) =>
    new AppError('internal', message, { cause }),
};

/** Structured server-side logging; never leaks stack traces to users. */
export function logError(error, { route, userId, silent = false } = {}) {
  if (silent) return;
  const payload = {
    level: 'error',
    at: new Date().toISOString(),
    code: error?.code || 'internal',
    message: error?.message,
    route,
    userId,
  };
  console.error('[campus+]', JSON.stringify(payload), error?.cause || error?.stack || '');
}

/**
 * Normalise anything thrown into the `{ ok, error, code }` shape used by
 * server actions, and `{ status, body }` for route handlers.
 */
export function toActionError(error, fallback = 'Something went wrong. Please try again.') {
  if (error instanceof AppError) {
    return { ok: false, error: error.message, code: error.code, details: error.details || null };
  }
  logError(error);
  return { ok: false, error: fallback, code: 'internal', details: null };
}

export function toHttpResponse(error) {
  if (error instanceof AppError) {
    return Response.json(
      { ok: false, error: error.message, code: error.code, details: error.details || null },
      { status: error.status },
    );
  }
  logError(error);
  return Response.json(
    { ok: false, error: 'Something went wrong. Please try again.', code: 'internal' },
    { status: 500 },
  );
}

/** Postgres error → friendly domain error. */
export function fromPostgresError(error, overrides = {}) {
  const code = error?.code;
  if (code === '23505' || code === '23505' /* unique_violation */) {
    return errors.conflict(overrides.unique || 'That already exists.');
  }
  if (code === '23503') return errors.validation(overrides.foreignKey || 'A referenced item no longer exists.');
  if (code === '23514') return errors.validation(overrides.check || 'Some values are out of the allowed range.');
  if (code === '42501' || code === 'PGRST301' || /row-level security/i.test(error?.message || '')) {
    return errors.forbidden(overrides.rls || 'You do not have permission to do that.');
  }
  if (code === 'PGRST116') return errors.notFound();
  // `22023` (invalid_parameter_value) is how every `RAISE EXCEPTION ... using
  // errcode = '22023'` business-rule message in the database functions is
  // surfaced (e.g. "That listing is no longer available.", "Choose the
  // student the item was handed to."). These messages are deliberately
  // written to be shown to the student verbatim — they never include table
  // names, ids, or anything else a user shouldn't see — so without this
  // mapping every one of them fell through to the generic internal-error
  // fallback below instead of the specific, actionable message the database
  // function raised.
  if (code === '22023') {
    return errors.validation(error?.message || overrides.check || 'Please check your request and try again.');
  }
  // `42901` is the project's custom errcode for rate-limit messages raised
  // from plpgsql (see supabase/migrations/.../010_random.sql); same reasoning
  // as above — the message is already user-safe.
  if (code === '42901' || /rate limit/i.test(error?.message || '')) {
    return errors.rateLimited(error?.message || overrides.rateLimit || 'You are doing that too often. Please slow down.');
  }
  logError(error);
  return errors.internal();
}
