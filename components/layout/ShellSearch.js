'use client';

/**
 * Shell search entry.
 *
 * Submits to Explore (the real `global_search()` surface) and supports the
 * keyboard habits a search box invites: "/" focuses it from anywhere on the
 * page, Escape clears it. Nothing is fetched here — the results page owns the
 * query.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/ui/icons';
import { cn } from '@/lib/utils';

export function ShellSearch({ className = '' }) {
  const router = useRouter();
  const [value, setValue] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      const typing =
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (typing) return;
      event.preventDefault();
      inputRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const submit = (event) => {
    event.preventDefault();
    const query = value.trim();
    if (query.length < 2) return;
    router.push(`/explore?q=${encodeURIComponent(query)}`);
  };

  return (
    <form role="search" onSubmit={submit} className={cn('relative w-full max-w-md', className)}>
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">
        <Icon name="search" size={16} />
      </span>
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setValue('');
        }}
        placeholder="Search people, posts, communities…"
        aria-label="Search Campus+"
        className="control control-input control-search pr-12"
      />
      <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded-[var(--radius-xs)] border border-line bg-surface-2 px-1.5 py-0.5 text-[0.625rem] font-semibold text-muted-soft lg:block">
        /
      </kbd>
    </form>
  );
}
