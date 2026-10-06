'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Input } from '@/components/ui';
import { Icon } from '@/components/ui/icons';

/** Compact search entry that hands off to the Explore results view. */
export function SearchEntry({ initialQuery = '', autoFocus = false }) {
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
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">
        <Icon name="search" size={16} />
      </span>
      <Input
        type="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Search people, posts, communities, events, listings…"
        aria-label="Search Campus+"
        className="pl-9"
        autoFocus={autoFocus}
      />
    </form>
  );
}
