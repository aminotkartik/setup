import { isSafeExternalUrl } from '@/lib/utils';

/**
 * The only way an external URL is rendered (spec §34, §41, §91).
 *
 * Anything that is not an http(s) URL — or that carries credentials, a
 * `javascript:` scheme or a non-standard port — is simply not rendered as a
 * link. Validation happens server-side when the row is written as well.
 */
export function ExternalLink({ url, children, className = '' }) {
  if (!isSafeExternalUrl(url)) {
    return <span className={className}>{children}</span>;
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className={className}
    >
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
