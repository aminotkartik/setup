import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import { getGig } from '@/lib/data/marketplace';
import { ROUTES, UUID_REGEX } from '@/lib/constants';
import { PageHeader, Badge, Notice, Card, StaffDot } from '@/components/ui';
import { IdentityLine } from '@/components/identity/IdentityLine';
import { MessageButton } from '@/components/social/MessageButton';
import { ReportDialog } from '@/components/social/ReportDialog';
import { formatDate } from '@/lib/utils';

export async function generateMetadata({ params }) {
  const { id } = await params;
  if (!UUID_REGEX.test(id)) return { title: 'Gig' };
  const supabase = await getServerClient();
  const gig = await getGig(supabase, id);
  return { title: gig?.title || 'Gig' };
}

/**
 * Gig detail (spec §19). Contact happens through the normal DM system — a gig is
 * a student offering a service, not a second marketplace.
 */
export default async function GigPage({ params }) {
  const { id } = await params;
  if (!UUID_REGEX.test(id)) notFound();

  const user = await requireUser();
  const supabase = await getServerClient();
  const actor = toActor(user);
  const gig = await getGig(supabase, id);
  if (!gig) notFound();

  const isCreator = gig.creator_id === user.profile.id;
  const canModerate = can(actor, 'moderate_marketplace') || can(actor, 'moderate_all');
  if (!['published', 'hidden', 'removed'].includes(gig.status) && !isCreator && !canModerate) notFound();

  const { data: creator } = await supabase
    .from('public_profiles')
    .select('id, username, display_name, is_staff, marketplace_completed_count')
    .eq('id', gig.creator_id)
    .maybeSingle();

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={gig.title} back={{ href: ROUTES.market, label: 'Market' }} />

      <Card className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="accent">Gig</Badge>
          {gig.compensation ? <Badge>{gig.compensation}</Badge> : null}
          {gig.category ? <Badge>{gig.category}</Badge> : null}
          {gig.status !== 'published' ? <Badge tone="danger">{gig.status}</Badge> : null}
        </div>
        <p className="user-text text-[0.9375rem] leading-relaxed">{gig.description}</p>
        <dl className="flex flex-wrap gap-x-4 gap-y-1 text-2xs text-muted">
          <div className="flex gap-1">
            <dt>Posted</dt>
            <dd>{formatDate(gig.created_at)}</dd>
          </div>
          {gig.availability ? (
            <div className="flex gap-1">
              <dt>Availability</dt>
              <dd>{gig.availability}</dd>
            </div>
          ) : null}
        </dl>
      </Card>

      {gig.status !== 'published' ? (
        <Notice tone="warning" icon="flag">
          This gig is {gig.status}. Only you and moderators can see it.
        </Notice>
      ) : null}

      <Card className="flex flex-col gap-3 p-4">
        <h2 className="text-sm font-semibold">Who is offering this</h2>
        {creator ? (
          <IdentityLine
            username={creator.username}
            displayName={creator.display_name}
            isStaff={creator.is_staff}
            badge={creator.is_staff ? <StaffDot label="Campus+ staff" /> : null}
          />
        ) : (
          <p className="text-[0.8125rem] text-muted">Student profile unavailable.</p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {!isCreator ? <MessageButton profileId={gig.creator_id} label="Message about this gig" /> : null}
          {!isCreator && can(actor, 'report_content') ? (
            <ReportDialog targetType="gig" targetRef={gig.id} label="this gig" />
          ) : null}
          {isCreator ? (
            <Link href={ROUTES.profile} className="text-2xs text-muted underline hover:text-ink">
              Manage your gigs from your profile
            </Link>
          ) : null}
        </div>
      </Card>

      <p className="pb-2 text-center text-2xs text-muted">
        Agree the details in messages, meet on campus, and never pay in advance to someone you do not
        know.
      </p>
    </div>
  );
}
