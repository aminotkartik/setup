import Link from 'next/link';
import { ROUTES } from '@/lib/constants';
import { segmentRichText } from '@/lib/linkify';
import { RichTextLink } from '@/components/content/RichTextLink';

/**
 * Shared rendering for user-authored text (bios, posts, comments, messages,
 * descriptions…). Stored text is never interpreted as HTML: it is segmented
 * by lib/linkify.js and rebuilt as React text nodes, so markup the author
 * typed renders literally while real URLs (and optionally @mentions) become
 * accessible links. Whitespace/newlines are preserved by the surrounding
 * `.user-text` styling, exactly as before.
 *
 * Do not render this inside an <a> or <button>: links cannot nest. Clickable
 * cards (see ContentCard) drop their whole-card anchor when their text
 * contains a link, and RichTextLink stops clicks bubbling to parent handlers.
 */
export function renderLinkifiedText(text, { mentions = false, linkClassName = 'rich-link' } = {}) {
  const source = String(text ?? '');
  if (!source) return null;
  const segments = segmentRichText(source, { mentions });
  return segments.map((segment, index) => {
    const key = `${segment.type}-${index}`;
    if (segment.type === 'link') {
      return (
        <RichTextLink key={key} href={segment.href} className={linkClassName}>
          {segment.value}
        </RichTextLink>
      );
    }
    if (segment.type === 'mention') {
      return (
        <Link key={key} href={ROUTES.user(segment.username)} className="mention">
          {segment.value}
        </Link>
      );
    }
    return segment.value;
  });
}

/** Inline (fragment) renderer — safe to drop into an existing <p>/element. */
export function LinkifiedText({ text, mentions = false, linkClassName = 'rich-link' }) {
  return <>{renderLinkifiedText(text, { mentions, linkClassName })}</>;
}
