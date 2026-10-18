/**
 * URL detection + validation for user-authored text.
 *
 * This module is the single source of truth for turning URLs typed into a
 * bio, post, comment, message, listing or description into clickable links.
 * It is deliberately pure and React-free (same convention as lib/utils.js):
 * detection, trailing-punctuation trimming and safety validation are kept
 * separate so each can be unit-tested without rendering.
 *
 * Safety model (never trust stored text, even from authenticated users):
 *  - Only http: and https: ever become navigable. www. candidates are
 *    normalised to https:// for the href while the visible label keeps the
 *    text the author actually typed.
 *  - javascript:, data:, vbscript:, file:, protocol-relative URLs, URLs with
 *    embedded credentials, single-label hosts and malformed hosts are NOT
 *    links; they remain ordinary (React-escaped) text.
 *  - Nothing here builds HTML strings. Renderers turn segments into React
 *    elements, so user text is always escaped by React.
 */

/** Candidate scan: a scheme URL or a www. host, up to the next whitespace or
 *  markup delimiter. Quotes/angle brackets are excluded so a URL written
 *  inside quotes or a tag-shaped string cannot swallow the closing syntax. */
const URL_CANDIDATE = /(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;

/** Existing mention shape (mirrors lib/mentions.js and components/posts). */
const MENTION_CANDIDATE = /(^|[^\w@])@([a-z0-9_]{3,24})\b/gi;

/** Sentence punctuation that is written *after* a URL, not inside it. */
const TRAILING_PUNCTUATION = new Set(['.', ',', ';', ':', '!', '?', '…', '*', '_', '~', '—', '–', '-']);
const CLOSER_TO_OPENER = { ')': '(', ']': '[', '}': '{' };

function isPlausibleHostname(hostname) {
  const host = String(hostname || '').toLowerCase();
  if (!host || host.length > 253 || host.startsWith('.') || host.endsWith('.')) return false;
  // IPv4 literal.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return host.split('.').every((part) => Number(part) >= 0 && Number(part) <= 255);
  }
  const labels = host.split('.');
  // A public web host needs at least one dot and an alphabetic/punycode TLD;
  // this rejects "https://example", "http://localhost" and "www.example".
  if (labels.length < 2) return false;
  if (!/^(?:[a-z]{2,}|xn--[a-z0-9-]{2,})$/.test(labels[labels.length - 1])) return false;
  return labels.every((label) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label));
}

/**
 * Validate a detected candidate and return its safe navigation href, or null.
 * `www.example.com/path` → `https://www.example.com/path`.
 */
export function normalizeLinkHref(candidate) {
  if (candidate === null || candidate === undefined) return null;
  const raw = String(candidate).trim();
  if (!raw || /\s/.test(raw)) return null;

  let href = raw;
  if (/^www\./i.test(raw)) href = `https://${raw}`;
  else if (!/^https?:\/\//i.test(raw)) return null; // never upgrade other schemes

  let url;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null; // credential-bearing URLs
  if (!isPlausibleHostname(url.hostname)) return null;
  return url.toString();
}

/** Boolean form of normalizeLinkHref, for callers that only need a check. */
export function isLinkableUrl(candidate) {
  return normalizeLinkHref(candidate) !== null;
}

/**
 * Split a raw candidate into [linkPart, trailingText]: sentence punctuation
 * and closing brackets that are not balanced inside the URL belong to the
 * sentence, not the destination ("(see https://a.b/c)." links only /c).
 */
function cleanCandidate(raw) {
  let value = raw;
  let trailing = '';
  const moveLastToTrailing = () => {
    trailing = value.slice(-1) + trailing;
    value = value.slice(0, -1);
  };
  while (value.length > 0) {
    const last = value[value.length - 1];
    if (TRAILING_PUNCTUATION.has(last)) {
      moveLastToTrailing();
      continue;
    }
    const opener = CLOSER_TO_OPENER[last];
    if (opener) {
      const opens = value.split(opener).length - 1;
      const closes = value.split(last).length - 1;
      if (closes > opens) {
        moveLastToTrailing();
        continue;
      }
    }
    break;
  }
  return { value, trailing };
}

function pushText(segments, value) {
  if (!value) return;
  const last = segments[segments.length - 1];
  if (last && last.type === 'text') last.value += value;
  else segments.push({ type: 'text', value });
}

/**
 * Segment text into plain-text and link segments.
 * Link segment: { type: 'link', value: <as typed>, href: <safe href> }.
 * Everything else (including dangerous or malformed candidates) stays text,
 * byte-for-byte, so spacing, punctuation and newlines are preserved.
 */
export function segmentTextLinks(text) {
  const source = String(text ?? '');
  if (!source) return [];
  const segments = [];
  let cursor = 0;
  let match;
  URL_CANDIDATE.lastIndex = 0;
  while ((match = URL_CANDIDATE.exec(source)) !== null) {
    const raw = match[0];
    const { value: candidate, trailing } = cleanCandidate(raw);
    const href = candidate ? normalizeLinkHref(candidate) : null;
    if (!href) continue; // leave the candidate inside the surrounding text
    const start = match.index;
    if (start > cursor) pushText(segments, source.slice(cursor, start));
    segments.push({ type: 'link', value: candidate, href });
    if (trailing) pushText(segments, trailing);
    cursor = start + raw.length;
  }
  if (cursor < source.length) pushText(segments, source.slice(cursor));
  return segments;
}

/** True when the text contains at least one link that would be rendered. */
export function containsLinkableUrl(text) {
  return segmentTextLinks(text).some((segment) => segment.type === 'link');
}

/**
 * URL detection kept separate from URL validation: this returns the raw
 * candidate strings found in text (unvalidated), e.g. for tests or tooling.
 */
export function extractUrlCandidates(text) {
  const source = String(text ?? '');
  if (!source) return [];
  URL_CANDIDATE.lastIndex = 0;
  return [...source.matchAll(URL_CANDIDATE)].map((match) => cleanCandidate(match[0]).value);
}

function segmentMentionsInto(segments, text) {
  let cursor = 0;
  let match;
  MENTION_CANDIDATE.lastIndex = 0;
  while ((match = MENTION_CANDIDATE.exec(text)) !== null) {
    const [, prefix, username] = match;
    const start = match.index + prefix.length;
    if (start > cursor) pushText(segments, text.slice(cursor, start));
    segments.push({ type: 'mention', value: `@${username}`, username: username.toLowerCase() });
    cursor = start + username.length + 1;
  }
  if (cursor < text.length) pushText(segments, text.slice(cursor));
  return segments;
}

/**
 * Full rich-text segmentation: links first (so an @ inside a URL path is
 * never mistaken for a mention), then @mentions inside the remaining text
 * when `mentions` is enabled. Segment types: text | link | mention.
 */
export function segmentRichText(text, { mentions = false } = {}) {
  const linked = segmentTextLinks(text);
  if (!mentions) return linked;
  const segments = [];
  for (const segment of linked) {
    if (segment.type !== 'text') {
      segments.push(segment);
      continue;
    }
    segmentMentionsInto(segments, segment.value);
  }
  return segments;
}
