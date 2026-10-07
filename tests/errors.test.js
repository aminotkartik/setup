import { describe, expect, it, vi } from 'vitest';

import { fromPostgresError, AppError } from '@/lib/errors';

/**
 * Regression coverage for the marketplace "Something went wrong" bug: the
 * database raises deliberately user-safe messages with the project's own
 * custom errcodes (22023 for business-rule validation, 42901 for rate
 * limits), and fromPostgresError() must surface them verbatim instead of
 * falling through to the generic internal-error message. This covers ~50
 * call sites across marketplace/messaging/communities/random-chat/moderation,
 * not just the one bug that surfaced it.
 */
describe('fromPostgresError', () => {
  it('surfaces a 22023 business-rule message from the database as a validation error', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const pgError = { code: '22023', message: 'Choose the student the item was handed to.' };
    const result = fromPostgresError(pgError);
    expect(result).toBeInstanceOf(AppError);
    expect(result.code).toBe('validation');
    expect(result.message).toBe('Choose the student the item was handed to.');
    vi.restoreAllMocks();
  });

  it('surfaces a 42901 rate-limit message from the database as a rate_limited error', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const pgError = { code: '42901', message: 'You are sending messages too quickly. Please wait a moment.' };
    const result = fromPostgresError(pgError);
    expect(result.code).toBe('rate_limited');
    expect(result.message).toBe('You are sending messages too quickly. Please wait a moment.');
    vi.restoreAllMocks();
  });

  it('falls back to a safe default message if a 22023 error has no message', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = fromPostgresError({ code: '22023' }, { check: 'Custom fallback.' });
    expect(result.code).toBe('validation');
    expect(result.message).toBe('Custom fallback.');
    vi.restoreAllMocks();
  });

  it('still maps 42501 / RLS denials to forbidden, unaffected by the new codes', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = fromPostgresError({ code: '42501' }, { rls: 'Nope.' });
    expect(result.code).toBe('forbidden');
    expect(result.message).toBe('Nope.');
    vi.restoreAllMocks();
  });

  it('still maps 23505 unique-violations to conflict, unaffected by the new codes', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = fromPostgresError({ code: '23505' }, { unique: 'Already exists.' });
    expect(result.code).toBe('conflict');
    expect(result.message).toBe('Already exists.');
    vi.restoreAllMocks();
  });

  it('falls back to a generic internal error for anything unrecognised', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = fromPostgresError({ code: '55555', message: 'some opaque db detail' });
    expect(result.code).toBe('internal');
    expect(result.message).not.toContain('opaque db detail');
    vi.restoreAllMocks();
  });
});
