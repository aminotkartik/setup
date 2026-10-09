'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { SEARCH_SCOPES } from '@/lib/constants';
import { Badge, Button, EmptyState, Notice, SkeletonList, WordLoader } from '@/components/ui';
import { SearchField } from '@/components/ui/SearchField';
import { Icon } from '@/components/ui/icons';

/**
 * Unified search.
 *
 * Calls the same `global_search` PostgreSQL function the rest of the product
 * uses — Postgres-native, RLS-scoped, block-aware. Debounced so typing does not
 * hammer the database, and paginated with a "Load more" row instead of pulling
 * everything at once.
 *
 * Search is deliberately one of the signature surfaces: a large glass-edged
 * field, scope chips, grouped results and honest empty states.
 */
export function SearchResults({ initialQuery = '', initialScope = 'all' }) {
  const [query, setQuery] = useState(initialQuery);
  const [scope, setScope] = useState(initialScope);
  const [groups, setGroups] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [offset, setOffset] = useState(0);
  const debounce = useRef(null);
  const requestId = useRef(0);

  const run = useCallback(async (term, activeScope, nextOffset = 0) => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ q: term, scope: activeScope, offset: String(nextOffset), limit: '20' });
      const response = await fetch(`/api/search?${params.toString()}`);
      const payload = await response.json();
      if (id !== requestId.current) return;
      if (!response.ok) throw new Error(payload?.error || 'Search is unavailable right now.');
      setTotal(payload.total || 0);
      setGroups((current) => (nextOffset === 0 ? payload.groups || [] : mergeGroups(current, payload.groups || [])));
    } catch (thrown) {
      if (id === requestId.current) setError(thrown.message);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);

  const trimmed = query.trim();
  const tooShort = trimmed.length < 2;

  useEffect(() => {
    if (tooShort) return undefined;
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      setOffset(0);
      run(trimmed, scope, 0);
    }, 320);
    return () => clearTimeout(debounce.current);
  }, [trimmed, tooShort, scope, run]);

  // Clearing previous results is derived from the current input, so it happens
  // during render instead of in an effect (React's "you might not need an effect").
  const [lastQuery, setLastQuery] = useState(initialQuery);
  if (lastQuery !== query) {
    setLastQuery(query);
    if (tooShort) {
      setGroups([]);
      setTotal(0);
      setError(null);
    }
  }

  const hasResults = groups.some((group) => group.items?.length);

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <SearchField
          value={query}
          onChange={setQuery}
          onSubmit={(term) => run(term, scope, 0)}
          hint="Search people, posts, communities, events, listings…"
          autoFocus
        />
      </div>

      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Search scope">
        {SEARCH_SCOPES.map((item) => (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={scope === item.value}
            onClick={() => setScope(item.value)}
            className="chip"
            data-active={scope === item.value}
          >
            {item.label}
          </button>
        ))}
      </div>

      {loading && !hasResults ? (
        <div className="flex flex-col gap-3">
          <WordLoader words={['people', 'posts', 'communities', 'listings', 'results']} />
          <SkeletonList rows={3} variant="rows" />
        </div>
      ) : null}

      {error ? (
        <Notice tone="danger" icon="flag">
          {error}
        </Notice>
      ) : null}

      {!loading && !tooShort && !hasResults && !error ? (
        <EmptyState icon="search" title="No matches" description="Try a different word, or a username without the @." />
      ) : null}

      {tooShort ? (
        <EmptyState
          icon="search"
          title="Search Campus+"
          description="People, posts, discussions, communities, events, listings, clubs, resources, opportunities, projects and study requests. Private messages are never searchable."
        />
      ) : null}

      {groups.map((group) =>
        group.items?.length ? (
          <section key={group.scope} aria-label={group.label} className="card overflow-hidden">
            <header className="flex items-center justify-between gap-2 border-b border-line bg-surface-2 px-4 py-2.5">
              <h2 className="t-label flex items-center gap-1.5">
                <Icon name={iconFor(group.scope)} size={13} />
                {group.label}
              </h2>
              <Badge>{group.items.length}</Badge>
            </header>
            <ul className="divide-y divide-line">
              {group.items.map((item) => (
                <li key={`${group.scope}-${item.id}`}>
                  <Link href={safeHref(item.url)} className="row-link hover:no-underline">
                    <span className="mt-0.5 shrink-0 text-muted-soft">
                      <Icon name={iconFor(group.scope)} size={15} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-[0.875rem] font-semibold">{item.title || 'Untitled'}</span>
                        {item.meta?.is_official ? <Badge tone="accent">Official</Badge> : null}
                      </span>
                      {item.subtitle ? <span className="mt-0.5 block text-[0.8125rem] text-muted">{item.subtitle}</span> : null}
                      {item.snippet ? (
                        <span className="mt-0.5 block text-2xs text-muted-soft">{String(item.snippet).slice(0, 160)}</span>
                      ) : null}
                    </span>
                    <Icon name="chevronRight" size={14} className="mt-1 shrink-0 text-muted-soft" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null,
      )}

      {total > 20 && hasResults ? (
        <Button
          variant="secondary"
          size="sm"
          className="self-center"
          loading={loading}
          onClick={() => {
            const next = offset + 20;
            setOffset(next);
            run(query.trim(), scope, next);
          }}
        >
          {loading ? 'Loading…' : `Load more (${Math.max(total - offset - 20, 0)} remaining)`}
        </Button>
      ) : null}
    </div>
  );
}

function mergeGroups(current, incoming) {
  const byScope = new Map(current.map((group) => [group.scope, { ...group, items: [...(group.items || [])] }]));
  for (const group of incoming) {
    if (!byScope.has(group.scope)) byScope.set(group.scope, { ...group, items: [...(group.items || [])] });
    else byScope.get(group.scope).items.push(...(group.items || []));
  }
  return [...byScope.values()];
}

/** Only relative Campus+ links are ever rendered from search results. */
function safeHref(url) {
  const value = String(url || '');
  return value.startsWith('/') ? value : '/explore';
}

function iconFor(scope) {
  switch (scope) {
    case 'people':
      return 'user';
    case 'communities':
    case 'clubs':
      return 'users';
    case 'marketplace':
      return 'tag';
    case 'events':
      return 'calendar';
    case 'resources':
      return 'book';
    case 'opportunities':
      return 'briefcase';
    case 'projects':
      return 'sparkle';
    case 'study':
      return 'book';
    default:
      return 'comment';
  }
}
