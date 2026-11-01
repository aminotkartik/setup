/**
 * A small, contextual illustration family for empty states.
 *
 * Every drawing uses the same 120 × 96 grid, 1.5px optical stroke and rounded
 * joins, but the composition changes with the message. They are decorative:
 * EmptyState's visible heading, copy and action remain the accessible content.
 */
const VARIANT_BY_ICON = {
  chat: 'conversation',
  comment: 'conversation',
  bell: 'notification',
  inbox: 'notification',
  search: 'discovery',
  tag: 'market',
  briefcase: 'market',
  users: 'community',
  calendar: 'schedule',
  book: 'document',
  file: 'document',
  megaphone: 'bulletin',
  flag: 'review',
  shield: 'review',
  archive: 'collection',
  grid: 'collection',
  sparkle: 'collection',
  building: 'place',
  bus: 'journey',
  lock: 'privacy',
};

export function EmptyStateArt({ icon = 'file', variant = null }) {
  const kind = variant || VARIANT_BY_ICON[icon] || 'document';
  let drawing;

  switch (kind) {
    case 'conversation':
      drawing = (
        <>
          <path className="empty-art__paper" d="M20 22a6 6 0 0 1 6-6h45a6 6 0 0 1 6 6v25a6 6 0 0 1-6 6H46L32 64V53h-6a6 6 0 0 1-6-6Z" />
          <path className="empty-art__ink" d="M31 29h32M31 38h23" />
          <path className="empty-art__paper" d="M60 43a5 5 0 0 1 5-5h30a5 5 0 0 1 5 5v19a5 5 0 0 1-5 5h-5v9l-11-9H65a5 5 0 0 1-5-5Z" />
          <path className="empty-art__accent" d="M70 49h20M70 56h13" />
        </>
      );
      break;
    case 'notification':
      drawing = (
        <>
          <path className="empty-art__paper" d="M37 65h46l-6-9V39a17 17 0 0 0-34 0v17Z" />
          <path className="empty-art__ink" d="M53 70a8 8 0 0 0 14 0M60 19v-4M43 29a17 17 0 0 1 34 0" />
          <path className="empty-art__accent" d="M28 36l-6-4M92 36l6-4M60 9V5" />
          <circle className="empty-art__accent-fill" cx="81" cy="21" r="5" />
        </>
      );
      break;
    case 'discovery':
      drawing = (
        <>
          <path className="empty-art__paper" d="M25 15h43l13 13v50H25Z" />
          <path className="empty-art__ink" d="M68 15v14h13M36 34h22M36 44h31M36 54h18" />
          <circle className="empty-art__lens" cx="76" cy="55" r="15" />
          <path className="empty-art__accent" d="m87 66 11 11M70 55h12M76 49v12" />
        </>
      );
      break;
    case 'market':
      drawing = (
        <>
          <path className="empty-art__paper" d="M23 27h55v48H23z" />
          <path className="empty-art__ink" d="M23 39h55M33 49h24M33 59h16" />
          <path className="empty-art__accent-soft" d="m58 17 27 4 11 22-25 24-25-36Z" />
          <path className="empty-art__accent" d="m58 17 13 14-25 36M84 43 46 31" />
          <circle className="empty-art__accent-fill" cx="78" cy="30" r="3" />
        </>
      );
      break;
    case 'community':
      drawing = (
        <>
          <circle className="empty-art__paper" cx="60" cy="29" r="12" />
          <circle className="empty-art__paper" cx="32" cy="42" r="9" />
          <circle className="empty-art__paper" cx="88" cy="42" r="9" />
          <path className="empty-art__ink" d="M39 72c2-15 10-23 21-23s19 8 21 23M13 72c1-11 8-18 17-18 5 0 9 2 12 5M107 72c-1-11-8-18-17-18-5 0-9 2-12 5" />
          <path className="empty-art__accent" d="M43 32c-5 0-9 1-13 4M77 32c5 0 9 1 13 4M60 42v7" />
        </>
      );
      break;
    case 'schedule':
      drawing = (
        <>
          <rect className="empty-art__paper" x="26" y="17" width="68" height="60" rx="6" />
          <path className="empty-art__ink" d="M26 34h68M43 12v11M77 12v11M43 34v43M60 34v43M77 34v43M26 48h68M26 63h68" />
          <rect className="empty-art__accent-fill" x="62" y="50" width="13" height="11" rx="2" />
          <path className="empty-art__accent" d="M36 27h10" />
        </>
      );
      break;
    case 'bulletin':
      drawing = (
        <>
          <path className="empty-art__paper" d="M24 42h18l31-19v50L42 56H24Z" />
          <path className="empty-art__ink" d="M42 42v14M33 56l5 20h14l-6-17M73 31v34" />
          <path className="empty-art__accent" d="M84 35l12-8M86 48h14M84 61l12 8" />
          <circle className="empty-art__accent-fill" cx="33" cy="49" r="3" />
        </>
      );
      break;
    case 'review':
      drawing = (
        <>
          <path className="empty-art__paper" d="M60 12 91 24v22c0 19-12 29-31 36-19-7-31-17-31-36V24Z" />
          <path className="empty-art__ink" d="M60 22 81 30v16c0 12-7 20-21 26-14-6-21-14-21-26V30Z" />
          <path className="empty-art__accent" d="m47 46 9 9 18-21" />
        </>
      );
      break;
    case 'place':
      drawing = (
        <>
          <path className="empty-art__paper" d="M25 77V29l35-16 35 16v48Z" />
          <path className="empty-art__ink" d="M18 77h84M43 77V54h34v23M42 34h8M70 34h8M42 44h8M70 44h8M60 13V6" />
          <path className="empty-art__accent" d="M51 65h18M60 54v23" />
        </>
      );
      break;
    case 'journey':
      drawing = (
        <>
          <path className="empty-art__paper" d="M31 23a8 8 0 0 1 8-8h42a8 8 0 0 1 8 8v43H31Z" />
          <path className="empty-art__ink" d="M31 42h58M43 15v27M77 15v27M40 66v9M80 66v9M25 75h70" />
          <path className="empty-art__accent" d="M42 54h8M70 54h8M53 31h14" />
          <circle className="empty-art__accent-fill" cx="46" cy="54" r="3" />
          <circle className="empty-art__accent-fill" cx="74" cy="54" r="3" />
        </>
      );
      break;
    case 'privacy':
      drawing = (
        <>
          <rect className="empty-art__paper" x="31" y="39" width="58" height="40" rx="7" />
          <path className="empty-art__ink" d="M42 39V28a18 18 0 0 1 36 0v11M49 39V28a11 11 0 0 1 22 0v11" />
          <circle className="empty-art__accent-fill" cx="60" cy="56" r="5" />
          <path className="empty-art__accent" d="M60 60v9" />
        </>
      );
      break;
    case 'collection':
      drawing = (
        <>
          <path className="empty-art__paper" d="m28 25 50-12 12 50-50 12Z" />
          <path className="empty-art__paper" d="m22 36 51-9 9 51-51 9Z" />
          <path className="empty-art__ink" d="m33 45 30-5M35 55l35-6M37 65l22-4" />
          <path className="empty-art__accent" d="m80 38 17 4-4 17M91 47l-18 18" />
        </>
      );
      break;
    case 'document':
    default:
      drawing = (
        <>
          <path className="empty-art__paper" d="M33 12h42l15 15v57H33Z" />
          <path className="empty-art__ink" d="M75 12v16h15M45 39h32M45 50h32M45 61h20" />
          <path className="empty-art__accent" d="M45 72h27M86 43v24" />
          <circle className="empty-art__accent-fill" cx="86" cy="34" r="3" />
        </>
      );
  }

  return (
    <svg
      className="state-icon empty-art"
      viewBox="0 0 120 96"
      width="120"
      height="96"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-art={kind}
    >
      {drawing}
      <path className="empty-art__ground" d="M14 86h92" />
    </svg>
  );
}
