'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { SEARCH_SCOPES } from '@/lib/constants';
import { Badge, EmptyState, Input, Notice, Spinner } from '@/components/ui';
import { Icon } from '@/components/ui/icons';

/**
 * Unified search (spec §17).
 *
 * Calls the same `global_search` PostgreSQL function the rest of the product
 * uses — Postgres-native, RLS-scoped, block-aware. Debounced so typing does not
 * hammer the database, and paginated with a "Load more" row instead of pulling
 * everything at once.
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

  const run = useCallback(
    async (term, activeScope, nextOffset = 0) => {
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
    },
    [],
  );

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
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">
          <Icon name="search" size={16} />
        </span>
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search Campus+"
          aria-label="Search Campus+"
          className="pl-9"
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
            className={
              scope === item.value
                ? 'rounded-full border border-ink bg-white px-3 py-1 text-2xs font-medium'
                : 'rounded-full border border-line px-3 py-1 text-2xs text-muted hover:text-ink'
            }
          >
            {item.label}
          </button>
        ))}
      </div>

      {loading && !hasResults ? <Spinner label="Searching…" /> : null}

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
          description="People, posts, discussions, communities, events, listings, clubs, resources, opportunities and projects. Private messages and Random sessions are never searchable."
        />
      ) : null}

      {groups.map((group) =>
        group.items?.length ? (
          <section key={group.scope} aria-label={group.label} className="card divide-y divide-line">
            <header className="flex items-center justify-between px-4 py-2.5">
              <h2 className="text-[0.8125rem] font-semibold">{group.label}</h2>
              <Badge>{group.items.length}</Badge>
            </header>
            <ul>
              {group.items.map((item) => (
                <li key={`${group.scope}-${item.id}`}>
                  <Link href={safeHref(item.url)} className="flex items-start gap-3 px-4 py-3 hover:bg-canvas hover:no-underline">
                    <Icon name={iconFor(group.scope)} size={16} className="mt-0.5 shrink-0 text-muted" />
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-[0.875rem] font-medium">{item.title || 'Untitled'}</span>
                        {item.meta?.is_official ? <Badge tone="accent">Official</Badge> : null}
                      </span>
                      {item.subtitle ? <span className="mt-0.5 block text-[0.8125rem] text-muted">{item.subtitle}</span> : null}
                      {item.snippet ? (
                        <span className="mt-0.5 block text-2xs text-muted">{String(item.snippet).slice(0, 160)}</span>
                      ) : null}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null,
      )}

      {total > 20 && hasResults ? (
        <button
          type="button"
          className="text-2xs text-muted underline hover:text-ink"
          disabled={loading}
          onClick={() => {
            const next = offset + 20;
            setOffset(next);
            run(query.trim(), scope, next);
          }}
        >
          {loading ? 'Loading…' : `Load more (${Math.max(total - offset - 20, 0)} remaining)`}
        </button>
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
    default:
      return 'comment';
  }
}
