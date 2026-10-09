import { describe, expect, it } from 'vitest';

import { validate } from '@/lib/validation/primitives';
import { studyPostSchema, vAvailability } from '@/lib/validation/schemas';
import { isStudyPostActive, listMyStudyPosts, listStudyPosts } from '@/lib/data/campus';
import { availabilityLabel, modeLabel, purposeLabel } from '@/components/study/studyMeta';

/**
 * Study Partner Finder: validation, lifecycle and data contracts.
 *
 * The privacy rule under test: availability accepts coarse categories only —
 * anything more precise is rejected before it can reach the database.
 */

const good = {
  title: 'DBMS exam prep partner',
  description: 'Working through normalization and SQL joins before the end-sem.',
  subject: 'Database Management Systems',
  purpose: 'exam_prep',
  branch: 'Computer Engineering',
  year: 'Third Year',
  academic_context: 'TE Sem 5',
  mode: 'either',
  availability: ['weekday_evening', 'weekend'],
  expires_on: '2030-12-01',
};

describe('studyPostSchema', () => {
  it('accepts a complete request and a minimal one', () => {
    const full = validate(good, studyPostSchema);
    expect(full.ok).toBe(true);
    expect(full.data.availability).toEqual(['weekday_evening', 'weekend']);

    const minimal = validate(
      { title: 'OS study', description: 'Paging and scheduling, twice a week.', subject: 'OS', purpose: 'subject_study' },
      studyPostSchema,
    );
    expect(minimal.ok).toBe(true);
    expect(minimal.data.mode).toBe('either');
    expect(minimal.data.availability).toEqual([]);
    expect(minimal.data.branch).toBeNull();
  });

  it('requires purpose, subject and a real description', () => {
    expect(validate({ ...good, purpose: 'dating' }, studyPostSchema).ok).toBe(false);
    expect(validate({ ...good, purpose: '' }, studyPostSchema).ok).toBe(false);
    expect(validate({ ...good, subject: 'x' }, studyPostSchema).ok).toBe(false);
    expect(validate({ ...good, description: 'too short' }, studyPostSchema).ok).toBe(false);
    expect(validate({ ...good, mode: 'teleport' }, studyPostSchema).ok).toBe(false);
  });

  it('rejects anything but coarse availability categories', () => {
    expect(vAvailability(['weekday_morning', 'flexible']).ok).toBe(true);
    // Precise times, places and free text must never validate.
    for (const bad of ['monday-9am', 'library-3pm', 'hostel-room-42', '12:30', 'Weekday mornings']) {
      const result = vAvailability([bad]);
      expect(result.ok, bad).toBe(false);
    }
    expect(vAvailability(['weekend', 'weekend']).ok).toBe(false);
    expect(vAvailability('not-an-array-but-a-string').ok).toBe(false);
  });

  it('rejects past closing dates', () => {
    const result = validate({ ...good, expires_on: '2001-01-01' }, studyPostSchema);
    expect(result.ok).toBe(false);
    expect(result.errors.expires_on).toBeTruthy();
  });
});

describe('study lifecycle', () => {
  const base = { status: 'published', closed_at: null, expires_on: null };

  it('treats published + open + unexpired as active', () => {
    expect(isStudyPostActive(base, '2030-01-01')).toBe(true);
    expect(isStudyPostActive({ ...base, expires_on: '2030-06-01' }, '2030-01-01')).toBe(true);
  });

  it('treats closed, expired and moderated requests as inactive', () => {
    expect(isStudyPostActive({ ...base, closed_at: '2030-01-01T00:00:00Z' }, '2030-01-01')).toBe(false);
    expect(isStudyPostActive({ ...base, expires_on: '2029-12-31' }, '2030-01-01')).toBe(false);
    expect(isStudyPostActive({ ...base, status: 'hidden' }, '2030-01-01')).toBe(false);
    expect(isStudyPostActive(null)).toBe(false);
  });
});

describe('study labels', () => {
  it('resolves every controlled value to a human label', () => {
    expect(purposeLabel('subject_study')).toBe('Subject study');
    expect(purposeLabel('exam_prep')).toBe('Exam preparation');
    expect(purposeLabel('collaboration')).toBe('Academic / project collaboration');
    expect(modeLabel('oncampus')).toBe('On-campus');
    expect(modeLabel('online')).toBe('Online');
    expect(modeLabel('either')).toBe('Either');
    expect(availabilityLabel('weekday_morning')).toBe('Weekday mornings');
    expect(availabilityLabel('weekend')).toBe('Weekends');
    expect(availabilityLabel('flexible')).toBe('Flexible');
  });
});

/** Chainable stub mirroring the Supabase query builder surface the helpers use. */
function stub(rows, { error = null } = {}) {
  const queries = [];
  function builder(table) {
    const state = { table, filters: [] };
    const finish = () => {
      queries.push(state);
      if (error) return { data: null, error };
      return { data: rows, error: null };
    };
    const api = {
      select() { return api; },
      eq(column, value) { state.filters.push(['eq', column, value]); return api; },
      gte(column, value) { state.filters.push(['gte', column, value]); return api; },
      lte(column, value) { state.filters.push(['lte', column, value]); return api; },
      lt(column, value) { state.filters.push(['lt', column, value]); return api; },
      in() { return api; },
      or(value) { state.filters.push(['or', value]); return api; },
      is(column, value) { state.filters.push(['is', column, value]); return api; },
      ilike(column, value) { state.filters.push(['ilike', column, value]); return api; },
      contains(column, value) { state.filters.push(['contains', column, value]); return api; },
      textSearch(column, value) { state.filters.push(['textSearch', column, value]); return api; },
      not() { return api; },
      order() { return api; },
      limit() { return api; },
      range() { return api; },
      maybeSingle() { return Promise.resolve(finish()); },
      then(resolve, reject) { return Promise.resolve(finish()).then(resolve, reject); },
    };
    return api;
  }
  return { queries, from(table) { return builder(table); }, rpc() { return Promise.resolve({ data: null, error: null }); } };
}

describe('study data contracts', () => {
  it('lists only active requests and reports unavailability instead of throwing', async () => {
    const failing = stub([], { error: { message: 'boom' } });
    const result = await listStudyPosts(failing);
    expect(result).toEqual({ items: [], unavailable: true });

    const client = stub([]);
    await listStudyPosts(client, { purpose: 'exam_prep', availability: 'weekend', q: 'dbms' });
    const filters = client.queries[0].filters;
    expect(filters).toContainEqual(['eq', 'status', 'published']);
    expect(filters).toContainEqual(['is', 'closed_at', null]);
    expect(filters).toContainEqual(['eq', 'purpose', 'exam_prep']);
    expect(filters).toContainEqual(['contains', 'availability', ['weekend']]);
  });

  it('never invents requests and scopes “mine” to the creator', async () => {
    expect((await listStudyPosts(stub([]))).items).toEqual([]);
    expect((await listMyStudyPosts(stub([]), null)).items).toEqual([]);
    const client = stub([]);
    await listMyStudyPosts(client, 'creator-id');
    expect(client.queries[0].filters).toContainEqual(['eq', 'creator_id', 'creator-id']);
  });
});
