import { describe, expect, it } from 'vitest';

import {
  isSafeExternalUrl,
  normalizeUsername,
  initials,
  handle,
  formatPrice,
  relativeTime,
  formatDateRange,
  formatDate,
  formatDateTime,
  formatTime,
  formatCalendarBadge,
  slugify,
  compactNumber,
  pluralize,
} from '@/lib/utils';
import { extractMentionUsernames, mentionUrl, segmentMentions } from '@/lib/mentions';
import { gifRefValidator, GIPHY_HOSTS } from '@/lib/validation/schemas';

/**
 * Shared helpers. These run against the same functions the application uses, so
 * a regression here is a regression in the product.
 */

describe('username handling', () => {
  it('lowercases and trims', () => {
    expect(normalizeUsername('  Asha.E2E  ')).toBe('asha.e2e');
  });

  it('renders a handle with the @ prefix exactly once', () => {
    expect(handle('asha_e2e')).toBe('@asha_e2e');
    expect(handle('@asha_e2e')).toBe('@asha_e2e');
  });

  it('derives initials from the display name, falling back to the username', () => {
    expect(initials('Asha Kulkarni', 'asha_e2e')).toBe('AK');
    expect(initials(null, 'asha_e2e')).toBe('AS');
    expect(initials('', '')).toBe('?');
  });

  it('builds url-safe slugs', () => {
    expect(slugify('Second Year — Study Group!')).toBe('second-year-study-group');
  });
});

describe('external url safety', () => {
  it('accepts http and https only', () => {
    expect(isSafeExternalUrl('https://pccoepune.org/notice.pdf')).toBe(true);
    expect(isSafeExternalUrl('http://example.com')).toBe(true);
  });

  it('rejects javascript:, data: and protocol-relative urls', () => {
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeExternalUrl('data:text/html,<script>')).toBe(false);
    expect(isSafeExternalUrl('//evil.example.com')).toBe(false);
    expect(isSafeExternalUrl('not a url')).toBe(false);
    expect(isSafeExternalUrl(null)).toBe(false);
  });
});

describe('formatting', () => {
  it('formats prices and free items', () => {
    expect(formatPrice(0)).toBe('Free');
    expect(formatPrice(null)).toBe('Free');
    expect(formatPrice(1250)).toContain('1,250');
  });

  it('formats relative and range dates without inventing values', () => {
    const now = Date.now();
    expect(relativeTime(new Date(now - 60_000).toISOString())).toMatch(/^1m ago$/);
    expect(relativeTime(new Date(now - 5_000).toISOString())).toBe('just now');
    expect(relativeTime('not-a-date')).toBe('');
    expect(formatDateRange('2026-10-05', '2026-10-07')).toContain('2026');
    expect(formatDateRange('2026-10-05', '2026-10-05')).not.toContain('–');
    expect(formatDateRange('2026-10-05', null)).toBe(formatDateRange('2026-10-05', null));
  });

  it('pluralises counts and compacts large numbers', () => {
    expect(pluralize(1, 'reply', 'replies')).toBe('1 reply');
    expect(pluralize(2, 'reply', 'replies')).toBe('2 replies');
    expect(compactNumber(1250)).toMatch(/K|k/);
  });
});

describe('mentions', () => {
  it('extracts unique usernames in lower case, capped at ten', () => {
    expect(extractMentionUsernames('hey @Asha_E2E and @asha_e2e and @rahul')).toEqual(['asha_e2e', 'rahul']);
    const many = Array.from({ length: 14 }, (_, index) => `@user${index}`).join(' ');
    expect(extractMentionUsernames(many)).toHaveLength(10);
  });

  it('ignores mention-shaped text inside other words or without a body', () => {
    expect(extractMentionUsernames('mail me at a@b.com')).toEqual([]);
    expect(extractMentionUsernames('@')).toEqual([]);
  });

  it('segments text so mentions render as links and never as raw html', () => {
    const segments = segmentMentions('hi @asha_e2e, see you');
    expect(segments).toEqual([
      { type: 'text', value: 'hi ' },
      { type: 'mention', value: 'asha_e2e' },
      { type: 'text', value: ', see you' },
    ]);
    expect(mentionUrl('asha_e2e')).toBe('/user/asha_e2e');
  });
});

describe('gif references (the only media Campus+ accepts)', () => {
  it('accepts a provider reference with an id and a GIPHY-hosted url', () => {
    const result = gifRefValidator({
      id: 'abc123',
      url: 'https://media.giphy.com/media/abc123/giphy.gif',
      preview_url: 'https://media.giphy.com/media/abc123/giphy_s.gif',
      width: 200,
      height: 200,
    });
    expect(result.ok).toBe(true);
  });

  it('rejects arbitrary hosts, javascript urls and inline data', () => {
    expect(gifRefValidator({ id: 'x', url: 'https://evil.example.com/x.gif' }).ok).toBe(false);
    expect(gifRefValidator({ id: 'x', url: 'javascript:alert(1)' }).ok).toBe(false);
    expect(gifRefValidator({ id: 'x', url: 'data:image/gif;base64,AAAA' }).ok).toBe(false);
    expect(gifRefValidator({ id: '', url: GIPHY_HOSTS[0] }).ok).toBe(false);
  });

  it('treats an absent gif as "no gif" rather than an error', () => {
    expect(gifRefValidator(undefined).ok).toBe(true);
    expect(gifRefValidator('').ok).toBe(true);
  });
});

describe('date/time formatting always reads as India Standard Time', () => {
  // Campus+ has one campus, one timezone. `toLocaleDateString`/`toLocaleTimeString`
  // without an explicit `timeZone` use the *host's* local zone, not IST — on a
  // UTC server (confirmed to be this sandbox's and Vercel's default) a moment
  // just after midnight IST is still "yesterday evening" in UTC, so every
  // formatter must pin `timeZone: 'Asia/Kolkata'` or dates silently shift.
  const runnerTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  it('sanity-checks that this suite is actually exercising a non-IST host clock', () => {
    // If this ever fails because the runner itself is IST, the midnight-boundary
    // assertions below would pass even with the historical bug reintroduced —
    // pin it explicitly instead of trusting the environment.
    expect(runnerTz).not.toBe('Asia/Kolkata');
  });

  it('rolls a late-UTC moment forward onto the correct IST calendar day', () => {
    // 2026-10-07T19:00:00Z = 2026-10-08T00:30 IST — after midnight, next day.
    const midnightCrossing = '2026-10-07T19:00:00Z';
    expect(formatDate(midnightCrossing)).toBe('8 Oct 2026');
    expect(formatDateTime(midnightCrossing)).toBe('8 Oct 2026 · 12:30 am');
    expect(formatTime(midnightCrossing)).toBe('12:30 am');
    expect(formatCalendarBadge(midnightCrossing)).toEqual({ month: 'Oct', day: '8' });
  });

  it('keeps a same-day IST moment on the same day (no off-by-one in the other direction)', () => {
    // 2026-10-07T10:00:00Z = 2026-10-07T15:30 IST — same calendar day.
    const sameDay = '2026-10-07T10:00:00Z';
    expect(formatDate(sameDay)).toBe('7 Oct 2026');
    expect(formatDateTime(sameDay)).toBe('7 Oct 2026 · 3:30 pm');
  });

  it('renders a bare SQL `date` (parsed as UTC midnight) on its own IST day, never the previous day', () => {
    // `new Date('2026-10-08')` is 2026-10-08T00:00:00Z = 05:30 IST the same day —
    // IST is always ahead of UTC, so a bare date can never roll backwards.
    expect(formatDate('2026-10-08')).toBe('8 Oct 2026');
    expect(formatCalendarBadge('2026-10-08')).toEqual({ month: 'Oct', day: '8' });
  });

  it('produces identical output no matter what timezone the server process runs in', () => {
    const original = process.env.TZ;
    const midnightCrossing = '2026-10-07T19:00:00Z';
    try {
      process.env.TZ = 'America/New_York';
      expect(formatDate(midnightCrossing)).toBe('8 Oct 2026');
      expect(formatDateTime(midnightCrossing)).toBe('8 Oct 2026 · 12:30 am');

      process.env.TZ = 'Asia/Kolkata';
      expect(formatDate(midnightCrossing)).toBe('8 Oct 2026');
      expect(formatDateTime(midnightCrossing)).toBe('8 Oct 2026 · 12:30 am');
    } finally {
      process.env.TZ = original;
    }
  });

  it('India has no daylight-saving transitions, so there is no seasonal edge case to special-case', () => {
    // Same offset (+05:30) in both the Indian winter and Indian summer.
    expect(formatTime('2026-01-15T18:30:00Z')).toBe(formatTime('2026-07-15T18:30:00Z'));
    expect(formatTime('2026-01-15T18:30:00Z')).toBe('12:00 am');
  });
});
