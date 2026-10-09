/** Only the disposable contrast fixture DB may be written by this helper.
 * Additional accounts exercise real onboarding/account-state gates. Production
 * auth, provisioning triggers, role grants and RLS are not replaced or edited. */
import { PASSWORD } from '../perf/seed.mjs';

export async function seedContrastAccounts(client, harness) {
  const database = new URL(harness.databaseUrl);
  if (!['127.0.0.1', 'localhost'].includes(database.hostname) || database.pathname !== '/campus_plus_perf') {
    throw new Error('Contrast accounts may only be seeded in the disposable local campus_plus_perf database.');
  }
  const accounts = {
    onboarding: { email: 'contrast.onboarding@pccoepune.org', displayName: 'Onboarding contrast fixture' },
    suspended: { email: 'contrast.suspended@pccoepune.org', displayName: 'Suspended contrast fixture' },
  };
  await client.query('begin');
  try {
    for (const [role, account] of Object.entries(accounts)) {
      let user = (await client.query('select id from auth.users where email = $1', [account.email])).rows[0];
      if (!user) {
        user = (await client.query(
          'insert into auth.users (email, encrypted_password, raw_user_meta_data) values ($1, $2, $3) returning id',
          [account.email, PASSWORD, JSON.stringify({ display_name: account.displayName })],
        )).rows[0];
      }
      // Auth's existing provisioning trigger creates the profile + student role.
      // Intentionally do not complete either profile or submit onboarding forms.
      if (role === 'suspended') {
        await client.query(
          `update public.profile_private set account_status = 'suspended',
           status_reason = 'Local fixture: an account-state explanation must be readable.',
           suspended_until = now() + interval '2 days' where auth_user_id = $1`,
          [user.id],
        );
      }
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
  return accounts;
}
