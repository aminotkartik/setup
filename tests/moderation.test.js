import { describe, expect, it } from 'vitest';

import { moderatorTargetUrl } from '@/lib/data/moderation';
import { MODERATION_TARGET_TYPES, PERMISSION_KEYS, REPORT_TARGET_TYPES, ROUTES } from '@/lib/constants';

/**
 * The moderation target map decides what a moderator can jump to. It is the join
 * between the report system and the content types, so a missing entry means a
 * report that cannot be triaged.
 */

const UUID = '33333333-3333-4333-8333-333333333333';

describe('moderatorTargetUrl()', () => {
  it('links every deep-linkable content type to its real route', () => {
    expect(moderatorTargetUrl('post', UUID)).toBe(ROUTES.post(UUID));
    expect(moderatorTargetUrl('marketplace_listing', UUID)).toBe(ROUTES.listing(UUID));
    expect(moderatorTargetUrl('gig', UUID)).toBe(ROUTES.gig(UUID));
    expect(moderatorTargetUrl('event', UUID)).toBe(ROUTES.event(UUID));
    expect(moderatorTargetUrl('community', UUID)).toBe(`/communities/${UUID}`);
  });

  it('gives Random sessions and table-less targets no public url', () => {
    expect(moderatorTargetUrl('random_session', UUID)).toBeNull();
    expect(moderatorTargetUrl('comment', UUID)).toBeNull();
    expect(moderatorTargetUrl('user', UUID)).toBeNull();
  });

  it('fails safe for unknown or missing identifiers', () => {
    expect(moderatorTargetUrl('time_travel', UUID)).toBeNull();
    expect(moderatorTargetUrl('post', null)).toBeNull();
    expect(moderatorTargetUrl('post', undefined)).toBeNull();
  });
});

describe('report target catalogue', () => {
  it('can report users and every content surface the spec names', () => {
    for (const type of [
      'user', 'post', 'comment', 'message', 'conversation', 'community',
      'marketplace_listing', 'gig', 'project', 'opportunity', 'random_session',
    ]) {
      expect(REPORT_TARGET_TYPES).toContain(type);
    }
  });

  it('offers moderators only content types the database can actually act on', () => {
    // `moderate_content()` accepts exactly these (see migration 016).
    const actionable = [
      'post', 'comment', 'marketplace_listing', 'gig', 'community', 'club',
      'project', 'lost_found', 'housing_post', 'ride_post',
    ];
    expect([...MODERATION_TARGET_TYPES].sort()).toEqual([...actionable].sort());
    for (const type of MODERATION_TARGET_TYPES) expect(REPORT_TARGET_TYPES).toContain(type);
  });

  it('never treats a non-actionable target type as actionable (no silent no-ops in the picker)', () => {
    for (const type of ['notice', 'event', 'resource', 'opportunity', 'deal']) {
      expect(MODERATION_TARGET_TYPES).not.toContain(type);
    }
  });
});

describe('permission keys used by the staff surfaces', () => {
  it('exist in the catalogue so can() can resolve them', () => {
    for (const key of [
      'review_reports', 'moderate_marketplace', 'moderate_random', 'view_moderation_logs',
      'manage_users', 'manage_roles', 'manage_permissions', 'assign_roles',
      'manage_platform_settings', 'manage_feature_flags', 'view_audit_logs',
      'manage_official_content', 'manage_events', 'manage_notices', 'manage_deals',
      'moderate_all', 'view_admin_overview',
    ]) {
      expect(PERMISSION_KEYS).toContain(key);
    }
  });
});
