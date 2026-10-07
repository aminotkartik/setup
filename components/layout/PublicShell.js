import Link from 'next/link';
import { cn } from '@/lib/utils';
import { Icon } from '@/components/ui/icons';

/**
 * The public frame.
 *
 * Sign-in, onboarding, the rules, the configuration screen and account status
 * all share it: one centred column, the Campus+ identity at the top, one clear
 * heading and copy that stays readable on a 320px phone.
 *
 * It renders no data and has no state, so it is safe on the server.
 */
export function PublicShell({ eyebrow = null, title = null, description = null, width = 'md', children, footer = null }) {
  const widths = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl' };

  return (
    <div className="relative mx-auto flex min-h-dvh w-full flex-col justify-center px-5 py-10 sm:py-14">
      <Link href="/" className="brand mb-8 w-fit" aria-label="Campus+">
        <span className="brand-mark" aria-hidden="true">
          <Icon name="plus" size={18} />
        </span>
        <span className="flex flex-col leading-tight">
          <span className="brand-word">Campus+</span>
          <span className="brand-sub">PCCOE</span>
        </span>
      </Link>

      <div className={cn('w-full', widths[width] || widths.md)}>
        {eyebrow ? <p className="t-label">{eyebrow}</p> : null}
        {title ? <h1 className="t-display mt-2 break-anywhere">{title}</h1> : null}
        {description ? <p className="t-secondary mt-2.5 max-w-xl">{description}</p> : null}
        <div className="mt-6">{children}</div>
        {footer ? <div className="mt-8">{footer}</div> : null}
      </div>
    </div>
  );
}
