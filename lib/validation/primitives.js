/**
 * Validation primitives.
 *
 * Every validator returns a plain result object:
 *   { ok: boolean, value?: any, error?: string }
 *
 * They are pure and dependency-free so the exact same code runs in a React
 * Server Action, a Route Handler and a Vitest test (spec §71, §98).
 */

export const ok = (value) => ({ ok: true, value });
export const fail = (error) => ({ ok: false, error });

/** Collapse whitespace, trim, and drop zero-width/control characters. */
export function cleanText(input) {
  return String(input ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200D\uFEFF]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function vString(input, { min = 0, max = 10_000, label = 'Value', allowNewlines = true, trim = true } = {}) {
  let value = trim ? cleanText(input) : String(input ?? '');
  if (!allowNewlines) value = value.replace(/\n+/g, ' ');
  const length = [...value].length;
  if (length < min) return fail(`${label} must be at least ${min} character${min === 1 ? '' : 's'}.`);
  if (length > max) return fail(`${label} must be at most ${max} characters.`);
  return ok(value);
}

export function vOptionalString(input, { max = 10_000, label = 'Value', allowNewlines = true } = {}) {
  const raw = input === null || input === undefined ? '' : String(input);
  if (!raw.trim()) return ok(null);
  const result = vString(raw, { min: 0, max, label, allowNewlines });
  if (!result.ok) return result;
  return ok(result.value || null);
}

export function vEnum(input, allowed, { label = 'Value', required = true } = {}) {
  if (input === null || input === undefined || input === '') {
    return required ? fail(`${label} is required.`) : ok(null);
  }
  const value = String(input);
  if (!allowed.includes(value)) return fail(`${label} is not one of the allowed options.`);
  return ok(value);
}

export function vNumber(input, { min = -Infinity, max = Infinity, label = 'Value', integer = false, required = true } = {}) {
  if (input === null || input === undefined || input === '') {
    return required ? fail(`${label} is required.`) : ok(null);
  }
  const numeric = typeof input === 'number' ? input : Number(String(input).replace(/,/g, ''));
  if (!Number.isFinite(numeric)) return fail(`${label} must be a number.`);
  if (integer && !Number.isInteger(numeric)) return fail(`${label} must be a whole number.`);
  if (numeric < min) return fail(`${label} must be at least ${min}.`);
  if (numeric > max) return fail(`${label} must be at most ${max}.`);
  return ok(numeric);
}

export function vBoolean(input) {
  if (typeof input === 'boolean') return ok(input);
  if (input === 'true' || input === 'on' || input === 1 || input === '1') return ok(true);
  if (input === 'false' || input === 'off' || input === 0 || input === '0' || input === null || input === undefined) {
    return ok(false);
  }
  return fail('Value must be true or false.');
}

export function vUrl(input, { required = false, label = 'Link', allowedHosts = null } = {}) {
  if (input === null || input === undefined || String(input).trim() === '') {
    return required ? fail(`${label} is required.`) : ok(null);
  }
  let url;
  try {
    url = new URL(String(input).trim());
  } catch {
    return fail(`${label} must be a valid URL starting with https://`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return fail(`${label} must use http or https.`);
  }
  if (url.protocol === 'http:' && url.hostname !== 'localhost') {
    return fail(`${label} must use https://`);
  }
  if (allowedHosts && !allowedHosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) {
    return fail(`${label} must point to ${allowedHosts.join(' or ')}.`);
  }
  return ok(url.toString());
}

export function vDate(input, { required = false, label = 'Date', allowPast = true } = {}) {
  if (input === null || input === undefined || String(input).trim() === '') {
    return required ? fail(`${label} is required.`) : ok(null);
  }
  const value = String(input).trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00Z`) : new Date(value);
  if (Number.isNaN(date.getTime())) return fail(`${label} must be a valid date.`);
  if (!allowPast && date.getTime() < Date.now() - 86_400_000) {
    return fail(`${label} cannot be in the past.`);
  }
  return ok(/^\d{4}-\d{2}-\d{2}$/.test(value) ? value : date.toISOString());
}

export function vTime(input, { required = false, label = 'Time' } = {}) {
  if (input === null || input === undefined || String(input).trim() === '') {
    return required ? fail(`${label} is required.`) : ok(null);
  }
  const value = String(input).trim();
  const match = value.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return fail(`${label} must look like HH:MM.`);
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return fail(`${label} must be a valid time of day.`);
  return ok(`${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`);
}

/** `@name`, `name`, or a raw uuid. Returns a normalised identifier + kind. */
export function vActorRef(input, { label = 'User' } = {}) {
  const value = cleanText(input).replace(/^@/, '');
  if (!value) return fail(`${label} is required.`);
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    return ok({ kind: 'id', value });
  }
  if (!/^[a-z0-9_]{3,24}$/i.test(value)) return fail(`${label} is not a valid username.`);
  return ok({ kind: 'username', value: value.toLowerCase() });
}

export function vUuid(input, { label = 'Identifier', required = true } = {}) {
  if (input === null || input === undefined || String(input).trim() === '') {
    return required ? fail(`${label} is required.`) : ok(null);
  }
  const value = String(input).trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    return fail(`${label} is not valid.`);
  }
  return ok(value);
}

export function vArrayOf(input, itemValidator, { min = 0, max = 100, label = 'Items' } = {}) {
  const list = Array.isArray(input) ? input : [];
  if (list.length < min) return fail(`${label}: at least ${min} required.`);
  if (list.length > max) return fail(`${label}: at most ${max} allowed.`);
  const values = [];
  for (let i = 0; i < list.length; i += 1) {
    const result = itemValidator(list[i], i);
    if (!result.ok) return fail(result.error);
    values.push(result.value);
  }
  return ok(values);
}

/** Run a schema map over an input object; returns { ok, data, errors }. */
export function validate(input, schema) {
  const data = {};
  const errors = {};
  for (const [field, validator] of Object.entries(schema)) {
    const result = validator(input?.[field], input);
    if (!result.ok) errors[field] = result.error;
    else data[field] = result.value;
  }
  const okFlag = Object.keys(errors).length === 0;
  return { ok: okFlag, data: okFlag ? data : null, errors, firstError: Object.values(errors)[0] || null };
}
