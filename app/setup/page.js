import { redirect } from 'next/navigation';
import { isSupabaseConfigured } from '@/lib/config';
import { configurationStatus } from '@/lib/config.server';
import { Badge, Notice } from '@/components/ui';
import { Icon } from '@/components/ui/icons';
import { PublicShell } from '@/components/layout/PublicShell';

export const metadata = { title: 'Setup' };

/**
 * Configuration screen (spec §92, §101).
 *
 * Shown when the deployment has no Supabase project connected yet. It lists
 * exactly which variables are missing, where to find them, and which ones are
 * secret — without ever asking for or printing a key.
 */
export default async function SetupPage() {
  if (isSupabaseConfigured()) {
    // Nothing to configure: send people into the real application.
    redirect('/');
  }

  const items = configurationStatus();

  return (
    <PublicShell
      eyebrow="Configuration required"
      title="Connect Campus+ to Supabase"
      description="This deployment is running without a database connection. Add the public values below to .env.local (locally) or to the project environment variables (Vercel), then restart. Nothing else on this screen needs to be edited by hand."
      width="lg"
    >
      <div className="card divide-y divide-line overflow-hidden">
        {items.map((item) => (
          <div key={item.key} className="flex items-start justify-between gap-4 p-4">
            <div className="min-w-0">
              <p className="break-anywhere font-mono text-[0.8125rem] text-ink">{item.key}</p>
              <p className="mt-0.5 text-[0.8125rem] text-muted">{item.label}</p>
              <p className="mt-1 text-2xs text-muted">Where: {item.where}</p>
              {item.note ? <p className="mt-0.5 text-2xs text-muted">{item.note}</p> : null}
            </div>
            <div className="shrink-0 text-right">
              {item.configured ? (
                <Badge tone="success">Set</Badge>
              ) : item.required ? (
                <Badge tone="danger">Required</Badge>
              ) : (
                <Badge>Optional</Badge>
              )}
              <p className="mt-1 text-2xs text-muted">{item.scope === 'server' ? 'server only' : 'browser-safe'}</p>
            </div>
          </div>
        ))}
      </div>

      <Notice tone="neutral" className="mt-5" icon="book">
        <p className="font-medium text-ink">Then run the migrations</p>
        <p className="mt-1">
          <span className="font-mono text-2xs">supabase link</span> followed by{' '}
          <span className="font-mono text-2xs">npm run db:migrate</span>. The migration history is the
          single source of truth for the schema; docs/DEPLOYMENT.md walks through the whole flow.
        </p>
      </Notice>

      <p className="mt-6 flex items-start gap-2 text-2xs text-muted">
        <Icon name="lock" size={14} className="mt-0.5 shrink-0" />
        Secret values belong in server-only variables. Never put a service-role/secret key in a
        NEXT_PUBLIC_* variable — those are bundled for the browser.
      </p>
    </PublicShell>
  );
}
