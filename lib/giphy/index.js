/**
 * GIPHY integration (spec §62, §88).
 *
 * Design rules:
 *  - The API key lives server-side only; the browser calls /api/giphy/*.
 *  - Responses are reduced to the minimal metadata Campus+ needs and every
 *    media URL is verified to come from an approved GIPHY host, so user text
 *    can never smuggle an arbitrary image URL into a GIF slot.
 *  - Attribution to GIPHY with a link back to the provider is returned with
 *    every response and rendered by the picker.
 *  - A missing key is a *clear configuration state*, never a crash (spec §92).
 */

import 'server-only';
import { serverConfig } from '@/lib/config.server';

const GIPHY_BASE = 'https://api.giphy.com/v1/gifs';
export const GIPHY_ATTRIBUTION = {
  provider: 'GIPHY',
  providerUrl: 'https://giphy.com',
  markUrl: 'https://giphy.com/attribution',
};

export const APPROVED_GIPHY_HOSTS = [
  'giphy.com', 'media.giphy.com', 'media0.giphy.com', 'media1.giphy.com',
  'media2.giphy.com', 'media3.giphy.com', 'media4.giphy.com',
];

export class GiphyNotConfiguredError extends Error {
  constructor() {
    super('GIF search is not configured on this deployment. Set GIPHY_API_KEY in the server environment.');
    this.name = 'GiphyNotConfiguredError';
    this.code = 'configuration';
  }
}

export class GiphyUnavailableError extends Error {
  constructor(message = 'GIF search is unavailable right now.') {
    super(message);
    this.name = 'GiphyUnavailableError';
    this.code = 'internal';
  }
}

export function isGiphyConfigured() {
  return Boolean(serverConfig.giphyApiKey);
}

export function isApprovedGiphyUrl(value) {
  try {
    const url = new URL(String(value));
    if (url.protocol !== 'https:') return false;
    return APPROVED_GIPHY_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

/** Reduce one raw GIPHY object to the minimal, validated shape we store. */
function normalizeGif(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '');
  if (!/^[A-Za-z0-9_-]{5,64}$/.test(id)) return null;

  const fixed = raw.images?.fixed_height || raw.images?.downsized_medium || raw.images?.original;
  const preview = raw.images?.fixed_height_small || raw.images?.preview_gif || fixed;
  const url = fixed?.url;
  const previewUrl = preview?.url || url;
  if (!isApprovedGiphyUrl(url) || !isApprovedGiphyUrl(previewUrl)) return null;

  return {
    provider: 'giphy',
    id,
    url,
    preview: previewUrl,
    width: Number(fixed?.width) || null,
    height: Number(fixed?.height) || null,
    title: raw.title ? String(raw.title).slice(0, 120) : null,
    rating: raw.rating ? String(raw.rating).slice(0, 8) : null,
  };
}

async function request(path, params) {
  const apiKey = serverConfig.giphyApiKey;
  if (!apiKey) throw new GiphyNotConfiguredError();

  const search = new URLSearchParams({
    api_key: apiKey,
    limit: String(Math.min(Math.max(Number(params.limit) || 24, 1), 50)),
    offset: String(Math.max(Number(params.offset) || 0, 0)),
    rating: serverConfig.giphyRating,
    lang: 'en',
    bundle: 'messaging_non_clips',
  });
  if (params.query) search.set('q', params.query);

  let response;
  try {
    response = await fetch(`${GIPHY_BASE}/${path}?${search.toString()}`, {
      // GIPHY content changes; cache briefly at the edge to stay inside rate limits.
      next: { revalidate: 60 },
      headers: { Accept: 'application/json' },
    });
  } catch {
    throw new GiphyUnavailableError('Could not reach the GIF provider.');
  }

  if (response.status === 429) {
    throw new GiphyUnavailableError('The GIF provider rate limit was reached. Try again shortly.');
  }
  if (!response.ok) {
    // Never surface the provider's raw body (it can echo the API key).
    throw new GiphyUnavailableError();
  }

  const payload = await response.json();
  const results = Array.isArray(payload?.data) ? payload.data.map(normalizeGif).filter(Boolean) : [];
  const pagination = payload?.pagination || {};

  return {
    results,
    totalCount: Number(pagination.total_count) || results.length,
    count: results.length,
    offset: Number(pagination.offset) || 0,
    attribution: GIPHY_ATTRIBUTION,
    rating: serverConfig.giphyRating,
  };
}

/** GET /v1/gifs/search */
export async function searchGifs({ query, limit = 24, offset = 0 }) {
  const trimmed = String(query || '').trim().slice(0, 60);
  if (!trimmed) return trendingGifs({ limit, offset });
  return request('search', { query: trimmed, limit, offset });
}

/** GET /v1/gifs/trending — used when the picker opens with no query. */
export async function trendingGifs({ limit = 24, offset = 0 } = {}) {
  return request('trending', { limit, offset });
}
