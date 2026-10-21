/**
 * A club's logo, without an upload.
 *
 * Campus+ is text-only (no image uploads anywhere, by design), so a club's
 * mark is a monogram: its initials over a colour pair derived deterministically
 * from its id. The same club always looks the same and nothing is stored.
 */
function initials(name) {
  const words = String(name || '')
    .replace(/[^\p{L}\p{N}\s&-]/gu, ' ')
    .split(/[\s&-]+/)
    .filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

function hueFor(seed) {
  let hash = 0;
  const source = String(seed || 'club');
  for (let i = 0; i < source.length; i += 1) {
    hash = (hash * 31 + source.charCodeAt(i)) % 360;
  }
  return hash;
}

export function ClubMonogram({ name, id = '', size = 56, className = '' }) {
  const hue = hueFor(id || name);
  return (
    <span
      className={`club-monogram ${className}`}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size / 3.4),
        fontSize: size <= 40 ? '0.8125rem' : size <= 64 ? '1.0625rem' : '1.375rem',
        '--club-hue-a': `${hue}`,
        '--club-hue-b': `${(hue + 46) % 360}`,
      }}
      aria-hidden="true"
    >
      <span className="club-monogram__initials">{initials(name)}</span>
    </span>
  );
}
