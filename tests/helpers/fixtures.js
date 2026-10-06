/**
 * Shared test fixtures (dev/test infrastructure only — never shipped to users).
 *
 * The actor and record shapes mirror what `lib/auth/session.js` and the data
 * layer return, so tests exercise the same code paths as the application.
 */

export function makeActor(overrides = {}) {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    profileId: '11111111-1111-4111-8111-111111111111',
    username: 'asha_e2e',
    accountStatus: 'active',
    roles: ['student'],
    permissions: new Set(),
    ...overrides,
  };
}

export function makeUser({ permissions = [], roles = ['student'], accountStatus = 'active' } = {}) {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    email: 'asha@pccoepune.org',
    roles,
    permissions,
    profile: {
      id: '11111111-1111-4111-8111-111111111111',
      username: 'asha_e2e',
      display_name: 'Asha',
      account_status: accountStatus,
    },
  };
}

/** A tiny chainable Supabase double: records queries and returns canned data. */
export function makeSupabaseStub(tables = {}) {
  const calls = [];
  function builder(table) {
    const rows = tables[table] ?? [];
    const state = { table, filters: [], order: null, limit: null, range: null, single: false };
    const result = () => {
      calls.push(state);
      const filtered = rows.filter((row) =>
        state.filters.every(([column, value]) => (value === null ? row[column] == null : row[column] === value)),
      );
      if (state.single) return { data: filtered[0] ?? null, error: null };
      return { data: filtered, error: null, count: filtered.length };
    };
    const api = {
      select() { return api; },
      eq(column, value) { state.filters.push([column, value]); return api; },
      in() { return api; },
      ilike() { return api; },
      order(column, options) { state.order = [column, options]; return api; },
      limit(value) { state.limit = value; return api; },
      range(from, to) { state.range = [from, to]; return api; },
      maybeSingle() { state.single = true; return Promise.resolve(result()); },
      single() { state.single = true; return Promise.resolve(result()); },
      then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); },
    };
    return api;
  }
  return {
    calls,
    from(table) { return builder(table); },
    rpc(name, params) {
      calls.push({ rpc: name, params });
      return Promise.resolve({ data: { ok: true }, error: null });
    },
  };
}
