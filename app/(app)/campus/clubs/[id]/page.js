import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, toActor } from '@/lib/permissions/authorization';
import {
  getCommunityById,
  getCommunityMembership,
  listCommunityMembers,
  listEvents,
  getCommunityChatConversation,
} from '@/lib/data/campus';
import { ROUTES, UUID_REGEX } from '@/lib/constants';
import { PageHeader, Badge, EmptyState, Card, StaffDot } from '@/components/ui';
import { IdentityLine } from '@/components/identity/IdentityLine';
import { CommunityActions } from '@/components/communities/CommunityActions';
import { MessageButton } from '@/components/social/MessageButton';
import { ReportDialog } from '@/components/social/ReportDialog';
import { ExternalLink } from '@/components/content/ExternalLink';
import { ContentCard } from '@/components/content/ContentCard';
import { formatDate } from '@/lib/utils';

export async function generateMetadata({ params }) {
  const { id } = await params;
  if (!UUID_REGEX.test(id)) return { title: 'Club' };
  const supabase = await getServerClient();
  const club = await getCommunityById(supabase, id);
  return { title: club?.name || 'Club' };
}

/** A club page (spec §28): description, members, events, contact, join. */
export default async function ClubPage({ params }) {
  const { id } = await params;
  if (!UUID_REGEX.test(id)) notFound();

  const user = await requireUser();
  const supabase = await getServerClient();
  const actor = toActor(user);

  const club = await getCommunityById(supabase, id);
  if (!club || club.kind !== 'club') notFound();

  const isStaff = can(actor, 'manage_clubs') || can(actor, 'moderate_all');
  if (club.status !== 'published' && !isStaff && club.created_by !== user.profile.id) notFound();

  const [membership, members, events, chat] = await Promise.all([
    getCommunityMembership(supabase, club.id, user.profile.id),
    listCommunityMembers(supabase, club.id, { limit: 24 }),
    listEvents(supabase, { limit: 5, clubId: club.id, upcoming: true }),
    getCommunityChatConversation(supabase, club.id),
  ]);

  const isMember = membership?.status === 'active';
  const owner = members.find((member) => member.role === 'owner') || members[0] || null;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={club.name}
        description={`Club · ${club.member_count} member${club.member_count === 1 ? '' : 's'}`}
        back={{ href: '/campus/clubs', label: 'Clubs' }}
      />

      <Card className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          {club.is_official ? <Badge tone="accent">Official</Badge> : <Badge>Student-run</Badge>}
          {club.subject ? <Badge>{club.subject}</Badge> : null}
          {club.join_policy !== 'open' ? <Badge tone="warning">Approval needed</Badge> : null}
        </div>
        <p className="user-text text-[0.9375rem] leading-relaxed">{club.description}</p>
        {club.recruitment_info ? <p className="text-[0.8125rem] text-muted">{club.recruitment_info}</p> : null}
        {club.contact_info ? <p className="text-[0.8125rem] text-muted">Contact: {club.contact_info}</p> : null}
        {club.external_url ? (
          <p className="text-[0.8125rem]">
            <ExternalLink url={club.external_url} className="underline">
              {club.external_url}
            </ExternalLink>
          </p>
        ) : null}
        <p className="text-2xs text-muted">Created {formatDate(club.created_at)}</p>

        <CommunityActions
          communityId={club.id}
          slug={club.slug}
          membership={membership}
          joinPolicy={club.join_policy}
          canJoin={can(actor, 'join_clubs')}
          canChat={isMember && can(actor, 'send_messages')}
          chatConversationId={chat?.id || null}
          canManage={isStaff || membership?.role === 'owner' || membership?.role === 'moderator'}
        />
      </Card>

      <section aria-label="Club events" className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Upcoming events</h2>
        {events.items.length ? (
          events.items.map((event) => (
            <ContentCard
              key={event.id}
              href={ROUTES.event(event.id)}
              title={event.title}
              description={event.description}
              icon="calendar"
              official={event.is_official}
              badges={[{ label: formatDate(event.starts_on), tone: 'accent' }]}
              meta={[event.location, event.organizer]}
            />
          ))
        ) : (
          <EmptyState icon="calendar" title="No upcoming events" description="This club has not scheduled anything yet." />
        )}
      </section>

      <Card className="flex flex-col gap-3 p-4">
        <h2 className="text-sm font-semibold">Members</h2>
        <ul className="flex flex-col gap-2">
          {members.map((member) => (
            <li key={member.user_id}>
              <IdentityLine
                username={member.username}
                displayName={member.display_name}
                isStaff={member.is_staff}
                size="sm"
                badge={
                  <>
                    {member.role !== 'member' ? <Badge tone="accent">{member.role}</Badge> : null}
                    {member.is_staff ? <StaffDot label="Campus+ staff" /> : null}
                  </>
                }
              />
            </li>
          ))}
        </ul>
        {owner && owner.user_id !== user.profile.id ? (
          <MessageButton profileId={owner.user_id} label={`Message the ${owner.role === 'owner' ? 'club lead' : 'club'}`} />
        ) : null}
      </Card>

      {can(actor, 'report_content') ? (
        <div className="flex justify-end">
          <ReportDialog targetType="club" targetRef={club.id} label={club.name} />
        </div>
      ) : null}
    </div>
  );
}
