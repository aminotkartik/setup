#!/usr/bin/env node
/**
 * PostgREST + Supabase-Auth compatible stub for the local performance harness.
 *
 * It speaks enough of the HTTP contract that the real `@supabase/supabase-js`
 * client — and therefore the real application code — runs unmodified:
 *
 *   /rest/v1/<table>?select=…     → SELECT / INSERT / UPDATE / DELETE as the
 *                                   role in the JWT, with Row Level Security
 *                                   genuinely enforced by PostgreSQL
 *   /rest/v1/rpc/<fn>             → the SECURITY DEFINER / INVOKER functions
 *   /auth/v1/token|user|jwks      → sessions, `getUser()`, `getClaims()` (ES256)
 *
 * Every upstream request is delayed by a fixed RTT to model the network distance
 * between the Next.js runtime and Supabase, and every request is recorded in a
 * trace so the harness can report request counts, payload sizes and waterfalls
 * instead of guesses.
 */

import http from 'node:http';
import crypto from 'node:crypto';
import { appendFile, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import { perfDir } from './lib.mjs';
import { loadCatalog, buildSelect, buildInsert, buildUpdate, buildDelete, buildRpc, StubQueryError } from './sql.mjs';

const b64url = (input) => Buffer.from(input).toString('base64url');

function createKeys() {
  // The signing key is persisted so a stub restart does not invalidate the
  // JWKS a running Next.js server already cached (it caches for a TTL).
  const keyFile = path.join(perfDir, 'jwks.json');
  let jwk;
  let privateKey;
  if (existsSync(keyFile)) {
    const stored = JSON.parse(readFileSync(keyFile, 'utf8'));
    jwk = stored.publicJwk;
    privateKey = crypto.createPrivateKey({ key: stored.privateJwk, format: 'jwk' });
  } else {
    const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    privateKey = pair.privateKey;
    jwk = pair.publicKey.export({ format: 'jwk' });
    mkdirSync(perfDir, { recursive: true });
    writeFileSync(
      keyFile,
      JSON.stringify({ publicJwk: jwk, privateJwk: privateKey.export({ format: 'jwk' }) }),
    );
  }
  const kid = 'perf-key-1';
  return {
    privateKey,
    jwks: { keys: [{ ...jwk, kid, alg: 'ES256', use: 'sig' }] },
    sign(claims) {
      const header = b64url(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid }));
      const payload = b64url(JSON.stringify(claims));
      const signature = crypto
        .sign('sha256', Buffer.from(`${header}.${payload}`), { key: privateKey, dsaEncoding: 'ieee-p1363' })
        .toString('base64url');
      return `${header}.${payload}.${signature}`;
    },
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** PostgREST-ish status codes for the Postgres error classes the app maps. */
function statusForError(error) {
  const code = error?.code || '';
  if (code === '42501') return 403;
  if (code === '23505') return 409;
  if (code === '23503' || code === '23514' || code === '22P02' || code === '22007') return 400;
  if (code === 'P0001') return 400;
  if (code === '42P01' || code === '42883') return 404;
  if (code === '57014') return 504;
  return 500;
}

export function createStub({ connectionString, latencyMs = 25, traceFile = null, secretKey = 'perf-secret-key' }) {
  const pool = new Pool({ connectionString, max: 10, statement_timeout: 30_000 });
  const keys = createKeys();
  const publicKey = crypto.createPublicKey({ key: keys.jwks.keys[0], format: 'jwk' });
  let catalog = null;
  let trace = [];
  let traceEnabled = true;

  async function refreshCatalog() {
    const client = await pool.connect();
    try {
      catalog = await loadCatalog(client);
    } finally {
      client.release();
    }
  }

  /** Run one statement as the JWT's role inside a transaction, like PostgREST. */
  async function runAs(claims, buildSql) {
    const client = await pool.connect();
    const role = claims?.role === 'service_role' ? 'service_role' : claims?.sub ? 'authenticated' : 'anon';
    try {
      await client.query('begin');
      await client.query(`set local role ${role}`);
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims || {})]);
      await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [claims?.sub || '']);
      await client.query(`select set_config('request.jwt.claim.role', $1, true)`, [role]);
      await client.query(`select set_config('role', $1, true)`, [role]);
      const { text, params } = buildSql();
      const result = await client.query(text, params);
      await client.query('commit');
      return result.rows[0] || { data: [], total: null };
    } catch (error) {
      try {
        await client.query('rollback');
      } catch {
        /* connection already gone */
      }
      throw error;
    } finally {
      client.release();
    }
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }

  async function record(entry) {
    trace.push(entry);
    if (traceFile && traceEnabled) {
      await appendFile(traceFile, `${JSON.stringify(entry)}\n`).catch(() => {});
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Auth                                                                   */
  /* ---------------------------------------------------------------------- */

  async function authSession(email) {
    const { rows } = await pool.query(
      `select id, email, created_at, last_sign_in_at, raw_user_meta_data from auth.users where lower(email) = lower($1)`,
      [email],
    );
    const user = rows[0];
    if (!user) return null;
    const now = Math.floor(Date.now() / 1000);
    const accessToken = keys.sign({
      sub: user.id,
      role: 'authenticated',
      aud: 'authenticated',
      email: user.email,
      session_id: crypto.randomUUID(),
      iat: now,
      exp: now + 3600,
    });
    return {
      access_token: accessToken,
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: now + 3600,
      refresh_token: `perf-refresh-${user.id}`,
      user: {
        id: user.id,
        aud: 'authenticated',
        role: 'authenticated',
        email: user.email,
        email_confirmed_at: user.created_at,
        created_at: user.created_at,
        updated_at: user.created_at,
        last_sign_in_at: user.last_sign_in_at || user.created_at,
        app_metadata: { provider: 'email', providers: ['email'] },
        user_metadata: user.raw_user_meta_data || {},
        identities: [],
      },
    };
  }

  async function handleAuth(req, res, url, body) {
    const path = url.pathname.replace(/^\/auth\/v1/, '');
    if (path === '/.well-known/jwks.json') {
      return sendJson(res, 200, keys.jwks);
    }
    if (path === '/token') {
      const grant = url.searchParams.get('grant_type');
      if (grant === 'password') {
        const parsed = JSON.parse(body || '{}');
        const { rows } = await pool.query(`select id, encrypted_password from auth.users where lower(email) = lower($1)`, [
          parsed.email || '',
        ]);
        if (!rows[0] || rows[0].encrypted_password !== parsed.password) {
          return sendJson(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
        }
        return sendJson(res, 200, await authSession(parsed.email));
      }
      if (grant === 'refresh_token') {
        const parsed = JSON.parse(body || '{}');
        const userId = String(parsed.refresh_token || '').replace('perf-refresh-', '');
        const { rows } = await pool.query(`select email from auth.users where id = $1`, [userId]);
        if (!rows[0]) return sendJson(res, 400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token' });
        return sendJson(res, 200, await authSession(rows[0].email));
      }
      return sendJson(res, 400, { error: 'unsupported_grant_type' });
    }
    if (path === '/user') {
      const claims = claimsFromRequest(req);
      if (!claims?.sub) return sendJson(res, 401, { error: 'invalid_token', message: 'invalid claim: missing sub claim' });
      const { rows } = await pool.query(`select * from auth.users where id = $1`, [claims.sub]);
      const user = rows[0];
      if (!user) return sendJson(res, 404, { message: 'User from sub claim in JWT does not exist' });
      return sendJson(res, 200, {
        id: user.id,
        aud: 'authenticated',
        role: 'authenticated',
        email: user.email,
        email_confirmed_at: user.created_at,
        created_at: user.created_at,
        updated_at: user.created_at,
        last_sign_in_at: user.last_sign_in_at || user.created_at,
        app_metadata: { provider: 'email', providers: ['email'] },
        user_metadata: user.raw_user_meta_data || {},
        identities: [],
      });
    }
    if (path === '/logout') return sendJson(res, 204, null);
    if (path === '/admin/users' && req.method === 'GET') {
      const { rows } = await pool.query(`select id, email, created_at, last_sign_in_at, raw_user_meta_data from auth.users order by created_at`);
      return sendJson(res, 200, {
        users: rows.map((user) => ({
          id: user.id,
          email: user.email,
          created_at: user.created_at,
          last_sign_in_at: user.last_sign_in_at,
          user_metadata: user.raw_user_meta_data || {},
        })),
        aud: 'authenticated',
      });
    }
    if (path === '/admin/users' && req.method === 'POST') {
      const parsed = JSON.parse(body || '{}');
      const { rows } = await pool.query(
        `insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`,
        [parsed.email, JSON.stringify(parsed.user_metadata || {})],
      );
      return sendJson(res, 200, { user: { id: rows[0].id, email: parsed.email } });
    }
    return sendJson(res, 404, { message: `Unsupported auth path ${path}` });
  }

  /* ---------------------------------------------------------------------- */
  /* REST                                                                   */
  /* ---------------------------------------------------------------------- */

  function claimsFromRequest(req) {
    const header = req.headers.authorization || '';
    const token = header.replace(/^Bearer\s+/i, '');
    if (!token) return null;
    const [h, p, s] = token.split('.');
    if (!h || !p || !s) return null;
    try {
      const valid = crypto.verify(
        'sha256',
        Buffer.from(`${h}.${p}`),
        { key: publicKey, dsaEncoding: 'ieee-p1363' },
        Buffer.from(s, 'base64url'),
      );
      if (!valid) return null;
      return JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
    } catch {
      return null;
    }
  }

  async function handleRest(req, res, url, body) {
    const apiKey = req.headers.apikey || '';
    const claims = claimsFromRequest(req);
    const effectiveClaims =
      claims || (apiKey && apiKey === secretKey ? { role: 'service_role' } : { role: 'anon' });
    const prefer = String(req.headers.prefer || '');
    if (!catalog) await refreshCatalog();

    const path = url.pathname.replace(/^\/rest\/v1\//, '');
    const searchParams = url.searchParams;

    if (path.startsWith('rpc/')) {
      const name = path.slice(4);
      const args = req.method === 'GET' ? Object.fromEntries(searchParams.entries()) : JSON.parse(body || '{}');
      const result = await runAs(effectiveClaims, () => buildRpc(catalog, name, args));
      return sendJson(res, 200, result.data);
    }

    const table = path;
    if (!catalog.columns.has(`public.${table}`)) {
      throw new StubQueryError(`Could not find the table 'public.${table}' in the schema cache`, { code: 'PGRST205', status: 404 });
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      if (searchParams.has('__prefer')) searchParams.delete('__prefer');
      const outcome = await runAs(effectiveClaims, () => buildSelect(catalog, table, searchParams));
      const rows = outcome.data || [];
      const total = outcome.total ?? rows.length;
      const offset = Number(searchParams.get('offset') || 0);
      const range = rows.length ? `${offset}-${offset + rows.length - 1}/${total}` : `*/${total}`;
      return sendJson(res, 200, req.method === 'HEAD' ? null : rows, { 'content-range': range });
    }

    if (req.method === 'POST' || req.method === 'PATCH' || req.method === 'DELETE') {
      const payload = body ? JSON.parse(body) : null;
      const wantsRepresentation = prefer.includes('return=representation');
      const builder =
        req.method === 'POST'
          ? () => buildInsert(catalog, table, withPrefer(searchParams, prefer), payload)
          : req.method === 'PATCH'
            ? () => buildUpdate(catalog, table, searchParams, payload)
            : () => buildDelete(catalog, table, searchParams);
      const outcome = await runAs(effectiveClaims, builder);
      if (!wantsRepresentation) return sendJson(res, req.method === 'POST' ? 201 : 204, null);
      const status = req.method === 'POST' ? 201 : 200;
      return sendJson(res, status, outcome.data || []);
    }
    return sendJson(res, 405, { message: `Method ${req.method} not supported by the harness` });
  }

  function withPrefer(searchParams, prefer) {
    const copy = new URLSearchParams(searchParams.toString());
    copy.set('__prefer', prefer);
    return copy;
  }

  function sendJson(res, status, payload, extraHeaders = {}) {
    const body = payload === null || payload === undefined ? '' : JSON.stringify(payload);
    res.perfBytes = Buffer.byteLength(body);
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(body),
      ...extraHeaders,
    });
    res.end(body);
  }

  const server = http.createServer(async (req, res) => {
    const started = Date.now();
    const url = new URL(req.url, 'http://127.0.0.1');
    const isPerf = url.pathname.startsWith('/__perf');
    let kind = url.pathname.startsWith('/rest/v1') ? 'rest' : url.pathname.startsWith('/auth/v1') ? 'auth' : 'other';
    let status = 200;
    try {
      const body = await readBody(req);

      if (isPerf) {
        if (url.pathname === '/__perf/trace') {
          const since = Number(url.searchParams.get('since') || 0);
          const payload = JSON.stringify(trace.slice(since));
          res.writeHead(200, {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(payload),
            'x-perf-total': String(trace.length),
          });
          return res.end(payload);
        }
        if (url.pathname === '/__perf/reset') {
          trace = [];
          traceEnabled = true;
          return sendJson(res, 200, { ok: true });
        }
        if (url.pathname === '/__perf/catalog') {
          await refreshCatalog();
          return sendJson(res, 200, { ok: true, tables: [...catalog.columns.keys()].length });
        }
        return sendJson(res, 404, { message: 'unknown perf endpoint' });
      }

      res.perfBytes = res.perfBytes || 0;
      const latency = kind === 'other' ? 0 : latencyMs;
      if (kind !== 'other') await sleep(latency);

      if (kind === 'auth') {
        await handleAuth(req, res, url, body);
      } else if (kind === 'rest') {
        try {
          await handleRest(req, res, url, body);
        } catch (error) {
          status = error instanceof StubQueryError ? error.status : statusForError(error);
          if (status === 500) console.error('[perf-stub]', error.message, error.stack?.split('\n')[1]);
          sendJson(res, status, {
            code: error.code || 'PGRST100',
            details: error.detail || null,
            hint: error.hint || null,
            message: error.message,
          });
        }
      } else {
        sendJson(res, 404, { message: `Unsupported ${url.pathname}` });
      }
    } catch (error) {
      status = 500;
      console.error('[perf-stub:crash]', error);
      sendJson(res, 500, { message: error.message });
    } finally {
      if (!isPerf) {
        const entry = {
          t0: started,
          t1: Date.now(),
          ms: Date.now() - started,
          method: req.method,
          path: url.pathname,
          query: url.searchParams.get('select') ? `select=${url.searchParams.get('select')}` : '',
          kind,
          status,
          bytes: res.perfBytes || 0,
        };
        await record(entry);
      }
    }
  });

  server.on('clientError', (err, socket) => socket.destroy());

  return {
    server,
    pool,
    listen: (port) =>
      new Promise((resolve) => {
        server.listen(port, '127.0.0.1', () => resolve(server.address().port));
      }),
    refreshCatalog,
    close: async () => {
      server.close();
      await pool.end();
    },
    get keys() {
      return keys;
    },
  };
}
