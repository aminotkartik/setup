import { renderLinkifiedText } from '@/components/content/LinkifiedText';

/**
 * Render stored post/comment text with linked @mentions and URLs.
 *
 * User text is never interpreted as HTML (spec §65): lib/linkify.js splits it
 * into segments that become strings and React elements, so markup renders
 * literally. @username tokens that match the platform's username shape link
 * to profiles; http(s)/www. URLs link out safely (see LinkifiedText). URLs
 * win over mentions, so an @ inside a URL path is not turned into a profile.
 */
export function renderTextWithMentions(text) {
  return renderLinkifiedText(text, { mentions: true });
}

/** Same renderer under its general name, for non-post surfaces. */
export const renderRichText = renderTextWithMentions;

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
