/**
 * Small shared helpers. Pure functions only — no React, no database access.
 */

/** Join class names, ignoring falsy values. */
export function cn(...values) {
  return values.filter(Boolean).join(' ');
}

/** Normalise a username to its canonical stored form (lowercase). */
export function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase().replace(/^@/, '');
}

/** Display a handle consistently everywhere (idempotent: '@Asha' → '@asha'). */
export function handle(username) {
  const normalized = normalizeUsername(username);
  return normalized ? `@${normalized}` : '';
}

/** Initials for the text-only avatar placeholder. */
export function initials(displayName, username) {
  const source = (displayName || username || '?').trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/** Stable pastel-free tint index for initial avatars (kept intentionally subtle). */
export function avatarSeed(username) {
  let hash = 0;
  const value = String(username || '');
  for (let i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) % 997;
  return hash;
}

export function truncate(value, max = 140) {
  const text = String(value ?? '');
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

export function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

/** `user@pccoepune.org` → `pccoepune.org` (null when malformed). */
export function emailDomain(value) {
  const email = normalizeEmail(value);
  const at = email.lastIndexOf('@');
  if (at <= 0 || at === email.length - 1) return null;
  return email.slice(at + 1);
}

export function isEmailShaped(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
}

/** Mask a domain for public display: "@pccoepune.org" (never the local part). */
export function formatDomain(domain) {
  return `@${String(domain || '').replace(/^@/, '')}`;
}

/* -------------------------------------------------------------------------- */
/* Dates — text-first UI keeps these short and unambiguous                     */
/* -------------------------------------------------------------------------- */

export function relativeTime(input) {
  if (!input) return '';
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return '';
  const diff = Date.now() - date.getTime();
  const seconds = Math.round(diff / 1000);
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return formatDate(date);
}

export function formatDate(input) {
  if (!input) return '';
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTime(input) {
  if (!input) return '';
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return '';
  return `${formatDate(date)} · ${date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`;
}

export function formatTime(input) {
  if (!input) return '';
  // Accepts 'HH:MM' strings from Postgres `time` columns as well as ISO strings.
  if (/^\d{2}:\d{2}/.test(String(input))) {
    const [h, m] = String(input).slice(0, 5).split(':').map(Number);
    const suffix = h >= 12 ? 'PM' : 'AM';
    const hour12 = h % 12 === 0 ? 12 : h % 12;
    return `${hour12}:${String(m).padStart(2, '0')} ${suffix}`;
  }
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}

export function formatDateRange(start, end) {
  const a = formatDate(start);
  if (!end) return a;
  const b = formatDate(end);
  return a === b ? a : `${a} – ${b}`;
}

export function isPast(input) {
  if (!input) return false;
  const date = new Date(input);
  return !Number.isNaN(date.getTime()) && date.getTime() < Date.now();
}

export function daysBetween(a, b = Date.now()) {
  return Math.floor((b - new Date(a).getTime()) / 86_400_000);
}

/* -------------------------------------------------------------------------- */
/* Formatting                                                                  */
/* -------------------------------------------------------------------------- */

export function formatPrice(amount, unit = 'INR') {
  if (amount === null || amount === undefined || amount === '') return 'Free';
  const numeric = Number(amount);
  if (Number.isNaN(numeric)) return String(amount);
  if (numeric === 0) return 'Free';
  const symbol = unit === 'INR' ? '₹' : `${unit} `;
  return `${symbol}${numeric.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

export function pluralize(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural || `${singular}s`}`;
}

export function compactNumber(value) {
  const n = Number(value) || 0;
  if (n < 1000) return String(n);
  if (n < 100_000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`;
  return `${(n / 100_000).toFixed(1)}L`;
}

/** Safe external URL check (http/https only) for user-supplied links. */
export function isSafeExternalUrl(value) {
  if (!value) return false;
  try {
    const url = new URL(String(value));
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Group an array by a key function → { key: [items] }. */
export function groupBy(items, keyFn) {
  return (items || []).reduce((acc, item) => {
    const key = keyFn(item);
    (acc[key] ||= []).push(item);
    return acc;
  }, {});
}

export function uniqueBy(items, keyFn) {
  const seen = new Set();
  return (items || []).filter((item) => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Deterministic, non-random id useful for keys / rate-limit buckets in tests. */
export function stableKey(...parts) {
  return parts
    .map((p) => String(p ?? '').trim().toLowerCase())
    .filter(Boolean)
    .join(':')
    .replace(/\s+/g, '_');
}
