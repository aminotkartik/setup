/**
 * Event display helpers. Client-safe: constants only, no data access.
 */

import { EVENT_CATEGORIES } from '@/lib/constants';

export function categoryLabel(value) {
  if (!value) return null;
  return EVENT_CATEGORIES.find((entry) => entry.value === value)?.label || value;
}

/**
 * Parse a `YYYY-MM` month parameter. Falls back to the current month when the
 * value is missing or malformed — the calendar never 404s on a bad query.
 */
export function parseMonthParam(value, now = new Date()) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(value || ''));
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (year >= 2020 && year <= 2100 && month >= 1 && month <= 12) return { year, month };
  }
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

export function monthParam(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function shiftMonth(year, month, delta) {
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

export function monthLabel(year, month) {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
}

/**
 * The six-week grid for a month view: leading days from the previous month,
 * the month itself, then trailing days. Weeks start on Monday.
 */
export function monthGrid(year, month) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7; // Monday-first offset
  const start = new Date(first);
  start.setUTCDate(start.getUTCDate() - lead);
  const days = [];
  for (let i = 0; i < 42; i += 1) {
    const day = new Date(start);
    day.setUTCDate(start.getUTCDate() + i);
    days.push(day.toISOString().slice(0, 10));
  }
  return days;
}

export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
