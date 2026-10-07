import Link from 'next/link';
import { ROUTES } from '@/lib/constants';

/**
 * Render stored text as plain text with linked @mentions.
 *
 * User text is never interpreted as HTML (spec §65): it is split into strings
 * and React elements, so a post containing markup renders that markup
 * literally. Only @username tokens that match the platform's username shape
 * become links.
 */
const MENTION = /(^|[^\w@])@([a-z0-9_]{3,24})\b/g;

export function renderTextWithMentions(text) {
  const source = String(text ?? '');
  if (!source) return null;

  const nodes = [];
  let lastIndex = 0;
  MENTION.lastIndex = 0;
  let match;

  while ((match = MENTION.exec(source)) !== null) {
    const [full, prefix, username] = match;
    const start = match.index + prefix.length;
    if (start > lastIndex) nodes.push(source.slice(lastIndex, start));
    nodes.push(
      <Link key={`${username}-${start}`} href={ROUTES.user(username)} className="mention">
        @{username}
      </Link>,
    );
    lastIndex = start + full.length - prefix.length;
  }

  if (lastIndex < source.length) nodes.push(source.slice(lastIndex));
  return nodes;
}

/** Plain-text list item rendering (technologies, skills) without HTML. */
export function TextList({ items, className = '' }) {
  const list = (Array.isArray(items) ? items : String(items || '').split(','))
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  if (!list.length) return null;
  return (
    <ul className={`flex flex-wrap gap-1.5 ${className}`}>
      {list.map((item) => (
        <li key={item} className="chip chip-static">
          {item}
        </li>
      ))}
    </ul>
  );
}
