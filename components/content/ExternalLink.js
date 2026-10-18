import { normalizeLinkHref } from '@/lib/linkify';

/**
 * The only way an external URL is rendered (spec §34, §41, §91).
 *
 * Validation is shared with inline linkification (lib/linkify.js): only
 * http:/https: (with `www.` normalised to https:) and no embedded
 * credentials, so a stored `javascript:` scheme or malformed value is simply
 * not rendered as a link. Validation happens server-side on write as well.
 */
export function ExternalLink({ url, children, className = '' }) {
  const href = normalizeLinkHref(url);
  if (!href) {
    return <span className={className}>{children}</span>;
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className={className}
    >
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
