/**
 * Centralized authorization.
 *
 * One helper — `can(actor, permission)` — is used by every page, server action
 * and API route. Role checks are never scattered through components
 * (spec §106, §107). The database enforces the same rules again through RLS and
 * `has_permission()`, so a bypassed UI check still cannot mutate data.
 */

import { PERMISSION_KEY_SET, PERMISSION_KEYS, PERMISSIONS, ROLE_ORDER, ROLES } from '@/lib/constants';

/**
 * @typedef {Object} Actor
 * @property {string} [id]            auth user id
 * @property {string} [profileId]     profiles.id
 * @property {string} [username]
 * @property {string} [accountStatus] active | suspended | banned | ...
 * @property {string[]} [roles]       role keys held by the user
 * @property {Set<string>} [permissions] resolved permission keys
 */

/** Build an Actor from the shape returned by `lib/auth/session.js`. */
export function toActor(user) {
  if (!user) return null;
  return {
    id: user.id,
    profileId: user.profile?.id || null,
    username: user.profile?.username || null,
    accountStatus: user.profile?.account_status || 'active',
    roles: Array.isArray(user.roles) ? user.roles : [],
    permissions: new Set(Array.isArray(user.permissions) ? user.permissions : []),
  };
}

/** Highest rank role of an actor (used for "you may not act on a peer" rules). */
export function highestRole(actor) {
  const roles = actor?.roles?.length ? actor.roles : [ROLES.student];
  return roles.slice().sort((a, b) => ROLE_ORDER.indexOf(b) - ROLE_ORDER.indexOf(a))[0];
}

export function roleRank(actor) {
  const index = ROLE_ORDER.indexOf(highestRole(actor));
  return index === -1 ? 0 : index;
}

/** Does the actor hold this permission? Unknown permission keys fail closed. */
export function can(actor, permission) {
  if (!actor) return false;
  if (!PERMISSION_KEY_SET.has(permission)) {
    // Fail closed and make the mistake visible during development/tests.
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[authorization] Unknown permission requested: ${permission}`);
    }
    return false;
  }
  if (!isActiveActor(actor)) return false;
  return Boolean(actor.permissions?.has?.(permission));
}

/** Convenience: all / any of a list. */
export function canAll(actor, permissions) {
  return permissions.every((permission) => can(actor, permission));
}

export function canAny(actor, permissions) {
  return permissions.some((permission) => can(actor, permission));
}

/** True when the account may act at all (suspension/ban enforcement — spec §83). */
export function isActiveActor(actor) {
  if (!actor) return false;
  const status = actor.accountStatus || 'active';
  return status === 'active' || status === 'pending';
}

export function isSuspended(actor) {
  return actor?.accountStatus === 'suspended';
}

export function isBanned(actor) {
  return actor?.accountStatus === 'banned';
}

/** Role helpers — visual role badges derive from these (spec §13, §108). */
export function hasRole(actor, role) {
  return Boolean(actor?.roles?.includes(role));
}

export function isModerator(actor) {
  return roleRank(actor) >= ROLE_ORDER.indexOf(ROLES.moderator);
}

export function isAdmin(actor) {
  return roleRank(actor) >= ROLE_ORDER.indexOf(ROLES.admin);
}

export function isSuperAdmin(actor) {
  return hasRole(actor, ROLES.super_admin);
}

/**
 * Does the actor show the red role dot? Only Moderator/Admin/Super Admin do;
 * students never do (spec §13).
 */
export function showsRoleBadge(actor) {
  return isModerator(actor);
}

/** Highest role that should be displayed next to the username. */
export function displayRole(actor) {
  if (!actor || !showsRoleBadge(actor)) return null;
  return highestRole(actor);
}

/**
 * Can `actor` act on `target` with this permission?
 *
 * Adds the staffing hierarchy rules that plain permission checks cannot express:
 *   - staff may not moderate themselves
 *   - staff may not moderate someone at their own rank or above
 *   - only a Super Admin may grant/revoke Super Admin
 */
export function canActOn(actor, target, permission) {
  if (!can(actor, permission)) return false;
  if (!target) return false;
  if (actor.id && target.id && actor.id === target.id) return false;
  if (roleRank(actor) <= roleRank(target)) return false;
  return true;
}

/** Guard used by role/permission administration. */
export function canManageRole(actor, roleKey) {
  if (!can(actor, 'assign_roles')) return false;
  if (roleKey === ROLES.super_admin) return isSuperAdmin(actor) && can(actor, 'manage_role_authority');
  if (roleKey === ROLES.admin) return isSuperAdmin(actor) || (isAdmin(actor) && can(actor, 'manage_role_authority'));
  return isAdmin(actor) || isModerator(actor) ? isAdmin(actor) : false;
}

/**
 * Rank a permission's "sensitivity" so the admin UI can warn before granting.
 * Derived from the catalogue group — no hand-maintained parallel list.
 */
export function permissionIsPlatformLevel(permission) {
  const entry = PERMISSIONS.find((p) => p.key === permission);
  return entry ? ['Administration', 'Platform'].includes(entry.group) : true;
}

export function permissionGroup(permission) {
  return PERMISSIONS.find((p) => p.key === permission)?.group || 'Other';
}

/** Resolve permissions from role rows returned by the database. */
export function permissionsFromRoles(roleRows) {
  const roles = [];
  const permissions = new Set();
  for (const row of roleRows || []) {
    const role = row?.roles || row;
    if (!role?.key) continue;
    roles.push(role.key);
    for (const link of role.role_permissions || []) {
      const key = link?.permissions?.key || link?.permission_key;
      if (key) permissions.add(key);
    }
  }
  if (roles.length === 0) roles.push(ROLES.student);
  return { roles: [...new Set(roles)], permissions: [...permissions] };
}

export { PERMISSION_KEYS, ROLES };
