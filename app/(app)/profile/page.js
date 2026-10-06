import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { getServerClient } from '@/lib/supabase/server';
import { can, showsRoleBadge, toActor } from '@/lib/permissions/authorization';
import { getProfileCounts, getOwnProfile } from '@/lib/data/profiles';
import { getPostsByAuthor } from '@/lib/data/feed';
import { ROUTES } from '@/lib/constants';
import { PageHeader, LinkButton, EmptyState, Badge, Card, StaffDot, Notice } from '@/components/ui';
import { PostCard } from '@/components/posts/PostCard';
import { formatDate } from '@/lib/utils';

export const metadata = { title: 'Your profile' };

/**
 * Own profile (spec §12, §50).
 *
 * Same identity rules as the public profile — email is never rendered anywhere —
 * plus the entry points that only make sense for yourself: settings and your
 * own activity.
 */
export default async function ProfilePage() {
  const user = await requireUser();
  const supabase = await getServerClient();
  const actor = toActor(user);
  const profile = (await getOwnProfile(supabase, user.profile.id)) || user.profile;

  const [posts, counts] = await Promise.all([
    getPostsByAuthor(supabase, profile.id, { limit: 20, currentProfileId: user.profile.id }),
    getProfileCounts(supabase, profile.id),
  ]);

  const name = profile.display_name || `@${profile.username}`;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={name}
        description={`@${profile.username}`}
        action={
          <div className="flex items-center gap-2">
            <LinkButton href={ROUTES.settings} size="sm" icon="settings">Edit profile</LinkButton>
          </div>
        }
      />

      <Card className="p-4">
        <div className="flex items-start gap-4">
          <span
            aria-hidden="true"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-line bg-white text-base font-medium text-muted"
          >
            {(name || '?').trim().slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-[1.0625rem] font-semibold">
              <span className="truncate">{name}</span>
              {showsRoleBadge(actor) ? <StaffDot label="Campus+ staff" /> : null}
            </h2>
            {profile.bio ? <p className="user-text mt-2 text-[0.9375rem] leading-relaxed">{profile.bio}</p> : (
              <p className="mt-2 text-[0.8125rem] text-muted">No bio yet. Add one in settings.</p>
            )}
            <dl className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-muted">
              {profile.branch || profile.year ? (
                <dd>{[profile.branch, profile.year].filter(Boolean).join(' · ')}</dd>
              ) : null}
              <dd>Joined {formatDate(profile.created_at)}</dd>
              <dd>{counts.posts} post{counts.posts === 1 ? '' : 's'}</dd>
              <dd>{counts.comments} comment{counts.comments === 1 ? '' : 's'}</dd>
            </dl>
            <p className="mt-2 flex flex-wrap items-center gap-2">
              <Link href={ROUTES.user(profile.username)} className="text-2xs text-muted underline hover:text-ink">
                View my public profile
              </Link>
              {profile.show_branch_year === false ? <Badge>Branch &amp; year hidden</Badge> : null}
              {profile.allow_dms_from_everyone === false ? <Badge>DMs restricted</Badge> : null}
            </p>
          </div>
        </div>
      </Card>

      <Notice tone="neutral" icon="shield">
        Your institutional email and account details are private. Other students only ever see your
        username, display name and what you post.
      </Notice>

      <section aria-label="Your posts" className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Your posts</h2>
        {posts.length === 0 ? (
          <EmptyState
            icon="sparkle"
            title="No posts yet"
            description="Share something on the campus feed — text and GIFs only."
            action={<LinkButton href={ROUTES.home} variant="primary" size="sm">Go to home</LinkButton>}
          />
        ) : null}
        {posts.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            currentUserId={user.profile.id}
            canModerate={can(actor, 'remove_posts')}
            reactions={{ count: post.reaction_count || 0, mine: Boolean(post.reacted_by_me) }}
            poll={post.poll}
          />
        ))}
      </section>
    </div>
  );
}
