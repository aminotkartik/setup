'use client';

/**
 * The anchor rendered for a URL found inside user-authored text.
 *
 * Client component so the click never bubbles into a surrounding card,
 * row or message handler (selection, reactions, parent navigation) even
 * when a surface adds its own onClick. Server-rendered HTML is identical;
 * the handler only takes effect after hydration.
 */
export function RichTextLink({ href, className = 'rich-link', children }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className={className}
      onClick={(event) => event.stopPropagation()}
    >
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
