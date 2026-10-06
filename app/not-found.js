import Link from 'next/link';
import { Icon } from '@/components/ui/icons';

export const metadata = { title: 'Not found' };

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-14 text-center">
      <Icon name="search" size={22} className="mx-auto text-muted" />
      <h1 className="mt-3 text-xl font-semibold tracking-tight">That page does not exist</h1>
      <p className="mt-2 text-[0.9375rem] text-muted">
        The link may be old, or the content may have been removed by its author or a moderator.
      </p>
      <Link href="/home" className="mt-6 text-sm text-ink underline">
        Back to Home
      </Link>
    </div>
  );
}
