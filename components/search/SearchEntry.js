'use client';

import { SearchField } from '@/components/ui/SearchField';

/**
 * The feed's search entry: the Campus+ search pill, handing the query to
 * Explore (the real `global_search()` surface). The results page owns search;
 * this is the door.
 */
export function SearchEntry({ initialQuery = '', autoFocus = false, hint = 'People, posts, communities, events, listings…' }) {
  return <SearchField initialQuery={initialQuery} autoFocus={autoFocus} hint={hint} />;
}
