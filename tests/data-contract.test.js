import { describe, expect, it } from 'vitest';

import { listNotices, listResources, listEvents, listLostFound } from '@/lib/data/campus';
import { listListings } from '@/lib/data/marketplace';
import { listReports } from '@/lib/data/moderation';
import { listUsers } from '@/lib/data/admin';

/**
 * Data-layer contracts.
 *
 * Every `list*` helper returns `{ items, unavailable }` instead of throwing, so a
 * page can render an honest warning and still show the rest of the screen. These
 * tests pin that shape, the query filters that matter for visibility, and the
 * "never invent data" rule (an empty result is an empty array, not filler).
 */

/** Chainable stub that records the filters a query applied. */
function stub(rows, { error = null } = {}) {
  const queries = [];
  function builder(table) {
    const state = { table, filters: [], orders: [], range: null };
    const finish = () => {
      queries.push(state);
      if (error) return { data: null, error, count: null };
      const items = rows.filter((row) =>
        state.filters.every(([column, value]) => {
          if (column === 'status') return row.status === value;
          if (column === 'branch') return row.branch === value;
          if (column === 'free') return value ? row.is_free === true : true;
          return true;
        }),
      );
      return { data: items, error: null, count: items.length };
    };
    const api = {
      select() { return api; },
      eq(column, value) { state.filters.push([column, value]); return api; },
      gte(column, value) { state.filters.push([`${column}>=`, value]); return api; },
      lte(column, value) { state.filters.push([`${column}<=`, value]); return api; },
      in() { return api; },
      or() { return api; },
      not() { return api; },
      is() { return api; },
      ilike() { return api; },
      order(column, options) { state.orders.push([column, options]); return api; },
      limit(value) { state.range = [0, value]; return api; },
      range(from, to) { state.range = [from, to]; return api; },
      single() { return Promise.resolve(finish()); },
      maybeSingle() { return Promise.resolve(finish()); },
      then(resolve, reject) { return Promise.resolve(finish()).then(resolve, reject); },
    };
    return api;
  }
  return {
    queries,
    from(table) { return builder(table); },
    rpc() { return Promise.resolve({ data: null, error: null }); },
  };
}

const notice = { id: 'n1', title: 'Library timings', status: 'published', category: 'general' };
const resource = { id: 'r1', title: 'DBMS notes', status: 'published', branch: 'CSE', type: 'notes' };

describe('read helpers never throw', () => {
  it('reports unavailability instead of an exception when the query fails', async () => {
    const failing = stub([], { error: { message: 'permission denied for table notices' } });
    for (const result of [
      await listNotices(failing),
      await listResources(failing),
      await listEvents(failing),
      await listLostFound(failing),
      await listListings(failing),
    ]) {
      expect(result.items).toEqual([]);
      expect(result.unavailable).toBe(true);
    }
  });

  it('never leaks a raw database error message to the caller', async () => {
    const failing = stub([], { error: { message: 'relation "public_profiles" does not exist' } });
    const result = await listListings(failing);
    expect(JSON.stringify(result)).not.toMatch(/relation .* does not exist/);
  });

  it('returns an empty array (not filler content) for an empty database', async () => {
    const empty = stub([]);
    expect((await listNotices(empty)).items).toEqual([]);
    expect((await listResources(empty)).items).toEqual([]);
    expect((await listListings(empty)).items).toEqual([]);
    expect((await listUsers(empty)).items).toEqual([]);
  });
});

describe('visibility filters are applied in the query, not the view', () => {
  it('asks the database only for published official content', async () => {
    const database = stub([notice]);
    await listNotices(database);
    expect(database.queries[0].filters).toContainEqual(['status', 'published']);

    const resources = stub([resource]);
    await listResources(resources);
    expect(resources.queries[0].filters).toContainEqual(['status', 'published']);
  });

  it('passes branch filters through for resources', async () => {
    const database = stub([resource]);
    await listResources(database, { branch: 'CSE' });
    expect(database.queries[0].filters).toContainEqual(['branch', 'CSE']);
    expect((await listResources(database, { branch: 'CSE' })).items).toHaveLength(1);
    expect((await listResources(database, { branch: 'MECH' })).items).toHaveLength(0);
  });

  it('pages with an explicit range instead of loading a whole table', async () => {
    const database = stub([notice]);
    await listNotices(database, { limit: 5, offset: 10 });
    expect(database.queries[0].range).toEqual([10, 14]);
  });
});

describe('moderation queue reads', () => {
  it('returns an unavailable queue rather than crashing the staff surface', async () => {
    const failing = stub([], { error: { message: 'nope' } });
    const result = await listReports(failing, { status: ['pending'] });
    expect(result.unavailable).toBe(true);
    expect(result.items).toEqual([]);
  });

  it('keeps Random reports free of participant identity and public urls', async () => {
    const reports = [
      {
        id: 'rep1',
        target_type: 'random_session',
        target_id: '44444444-4444-4444-8444-444444444444',
        random_session_id: '55555555-5555-4555-8555-555555555555',
        reporter_id: '66666666-6666-4666-8666-666666666666',
        reason: 'harassment',
        details: 'They kept asking for my phone number.',
        status: 'pending',
        created_at: new Date().toISOString(),
      },
    ];
    const result = await listReports(stub(reports), {});
    expect(result.unavailable).toBe(false);
    const [entry] = result.items;
    expect(entry.summary).toBeNull();
    expect(entry.moderator_url).toBeNull();
    // Type-level safety: no participant fields are added by the read layer.
    expect(JSON.stringify(entry)).not.toMatch(/target_user_id|other_user|participant/);
  });
});
