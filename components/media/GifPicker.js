'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Button, Input, Notice, Skeleton } from '@/components/ui';
import { Icon } from '@/components/ui/icons';
import { cn } from '@/lib/utils';

/**
 * The one GIF picker.
 *
 * Talks only to `/api/giphy/search` — the GIPHY key stays on the server — and
 * stores just the validated `{ provider, id, url, title }` ref that the database
 * accepts. Attribution is rendered with the results, as the provider requires.
 *
 * If GIPHY is not configured the component shows a configuration message and
 * everything else keeps working: GIFs are a garnish, never a dependency.
 */
export function GifPicker({ onPick, onRemove = null, value = null, label = 'GIF' }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [attribution, setAttribution] = useState(null);
  const [unconfigured, setUnconfigured] = useState(false);
  const debounce = useRef(null);
  const containerRef = useRef(null);

  const search = useCallback(async (term) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '24' });
      if (term) params.set('q', term);
      const response = await fetch(`/api/giphy/search?${params.toString()}`);
      const payload = await response.json();
      if (!response.ok) {
        if (payload?.code === 'configuration') {
          setUnconfigured(true);
          setItems([]);
          return;
        }
        throw new Error(payload?.error || 'GIF search is unavailable right now.');
      }
      setItems(payload.results || []);
      setAttribution(payload.attribution || null);
    } catch (thrown) {
      setError(thrown.message || 'GIF search failed.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const term = query.trim();
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => search(term.length >= 2 ? term : ''), 320);
    return () => clearTimeout(debounce.current);
  }, [open, query, search]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div ref={containerRef} className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant={open ? 'subtle' : 'ghost'}
          size="sm"
          icon="image"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          {value ? 'Change GIF' : label}
        </Button>
        {value && onRemove ? (
          <Button type="button" variant="ghost" size="sm" icon="close" onClick={onRemove}>
            Remove
          </Button>
        ) : null}
      </div>

      {value ? (
        <p className="flex items-center gap-1.5 text-2xs text-muted">
          <Icon name="check" size={13} className="text-success" />
          GIF attached{value.title ? `: ${value.title}` : ''}
        </p>
      ) : null}

      {open ? (
        <div className="card-flush p-3" role="region" aria-label="GIF search">
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search GIFs"
            aria-label="Search GIFs"
            autoFocus
          />

          {unconfigured ? (
            <Notice tone="warning" className="mt-3" icon="settings">
              GIF search is not configured on this deployment. An administrator can enable it by adding a GIPHY API key
              to the server environment.
            </Notice>
          ) : null}

          {error ? (
            <Notice tone="danger" className="mt-3" icon="flag">
              {error}
            </Notice>
          ) : null}

          {loading ? (
            <ul className="mt-3 grid max-h-72 grid-cols-2 gap-2 overflow-hidden sm:grid-cols-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <li key={index}>
                  <Skeleton className="h-24 w-full rounded-[var(--radius-sm)]" />
                </li>
              ))}
            </ul>
          ) : null}

          {!loading && !unconfigured && !error && items.length === 0 ? (
            <p className="py-5 text-center text-[0.8125rem] text-muted">
              {query.trim().length >= 2 ? 'No GIFs matched that search.' : 'Type to search GIFs.'}
            </p>
          ) : null}

          {items.length ? (
            <ul className="mt-3 grid max-h-72 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
              {items.map((gif) => (
                <li key={gif.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onPick({ provider: 'giphy', id: gif.id, url: gif.url, title: gif.title });
                      setOpen(false);
                    }}
                    className="w-full overflow-hidden rounded-[var(--radius-sm)] border border-line text-left transition-all hover:border-accent/50 active:scale-[0.98]"
                    aria-label={gif.title ? `Attach GIF: ${gif.title}` : 'Attach GIF'}
                  >
                    {/* Validated GIPHY media URL (lib/giphy + next.config remotePatterns). */}
                    <Image
                      src={gif.previewUrl || gif.url}
                      alt={gif.title || ''}
                      width={200}
                      height={96}
                      unoptimized
                      className="h-24 w-full bg-surface-2 object-cover"
                    />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {attribution ? (
            <p className="mt-3 text-2xs text-muted">
              Powered by{' '}
              <a href={attribution.providerUrl} target="_blank" rel="noreferrer noopener" className="underline">
                {attribution.provider}
              </a>
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Renders a stored GIF ref. Only validated GIPHY URLs reach the database. */
export function GifAttachment({ gif, className = '' }) {
  if (!gif?.url) return null;
  return (
    <Image
      src={gif.url}
      alt={gif.title || 'GIF'}
      width={320}
      height={240}
      unoptimized
      className={cn('h-auto max-h-72 w-auto rounded-[var(--radius-md)] border border-line', className)}
    />
  );
}
