'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Icon } from '@/components/ui/icons';

/**
 * The feed's search entry: a glass-edged, thumb-friendly field that hands the
 * query to Explore (the real `global_search()` surface). It renders nothing
 * client-heavy — the results page owns the search.
 */
export function SearchEntry({ initialQuery = '', autoFocus = false, hint = 'People, posts, communities, events, listings…' }) {
  const router = useRouter();
  const [value, setValue] = useState(initialQuery);

  return (
    <form
      role="search"
      className="relative"
      onSubmit={(event) => {
        event.preventDefault();
        const query = value.trim();
        if (query.length >= 2) router.push(`/explore?q=${encodeURIComponent(query)}`);
      }}
    >
      <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-soft">
        <Icon name="search" size={17} />
      </span>
      <input
        type="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={hint}
        aria-label="Search Campus+"
        autoFocus={autoFocus}
        className="control control-search h-11 rounded-[var(--radius-lg)] bg-surface/80 pl-10 pr-4 backdrop-blur-md"
      />
    </form>
  );
}
