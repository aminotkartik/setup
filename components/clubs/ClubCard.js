import Link from 'next/link';
import { Badge } from '@/components/ui';
import { Icon } from '@/components/ui/icons';
import { ClubMonogram } from '@/components/clubs/ClubMonogram';
import { truncate } from '@/lib/utils';
import { ROUTES } from '@/lib/constants';

/**
 * A club in the discovery grid.
 *
 * The monogram is the club's mark (there are no uploads in Campus+), the
 * category is the discovery axis, and the member count is the only number —
 * no engagement theatre.
 */
export function ClubCard({ club, joined = false }) {
  return (
    <Link
      href={ROUTES.club(club.id)}
      className="club-card card group flex flex-col gap-3 p-4"
      aria-label={`${club.name}, ${club.member_count} member${club.member_count === 1 ? '' : 's'}`}
    >
      <div className="flex items-start gap-3">
        <ClubMonogram name={club.name} id={club.id} size={52} />
        <div className="min-w-0 flex-1">
          <h3 className="t-card break-anywhere leading-snug group-hover:underline">{club.name}</h3>
          <p className="mt-1 truncate text-2xs uppercase tracking-wide text-muted-soft">
            {club.club_category ? `${club.club_category} club` : 'Club'}
          </p>
        </div>
        <Icon name="chevronRight" size={15} className="mt-1 shrink-0 text-muted-soft transition-transform group-hover:translate-x-0.5" />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {club.is_official ? <Badge tone="accent">Official</Badge> : <Badge>Student-run</Badge>}
        {joined ? <Badge tone="success" icon="check">Member</Badge> : null}
        {club.recruitment_info ? (
          <Badge tone="info" icon="megaphone">
            Recruiting
          </Badge>
        ) : null}
        {club.join_policy !== 'open' ? <Badge tone="warning">Approval needed</Badge> : null}
      </div>

      <p className="line-clamp-3 text-[0.8125rem] leading-relaxed text-muted">{truncate(club.description, 150)}</p>

      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line pt-2.5 text-2xs text-muted">
        <span>
          <Icon name="users" size={12} className="mr-1 inline align-[-2px]" />
          {club.member_count} member{club.member_count === 1 ? '' : 's'}
        </span>
        {club.meeting_info ? <span className="truncate">Meets · {club.meeting_info}</span> : null}
      </div>
    </Link>
  );
}
