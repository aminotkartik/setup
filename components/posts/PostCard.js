import Link from 'next/link';
import { ROUTES } from '@/lib/constants';
import { relativeTime, truncate } from '@/lib/utils';
import { Badge, OfficialBadge } from '@/components/ui';
import { Icon } from '@/components/ui/icons';
import { IdentityLine } from '@/components/identity/IdentityLine';
import { GifAttachment } from '@/components/media/GifPicker';
import { ReactionBar } from '@/components/posts/ReactionBar';
import { PostActions } from '@/components/posts/PostActions';
import { PollBlock } from '@/components/posts/PollBlock';
import { ReportDialog } from '@/components/social/ReportDialog';
import { renderTextWithMentions } from '@/components/posts/richText';

/**
 * The one post card (spec §13) — posts, discussions and polls.
 *
 * Reading order is deliberate: who → what → what can I do. No view counts, no
 * engagement theatre, no presence: username, text, timestamp, reactions,
 * comments, report. Official content is labelled; student content never claims
 * to be official.
 */
export function PostCard({
  post,
  currentUserId = null,
  canModerate = false,
  reactions = { count: 0, mine: false },
  poll = null,
  showCommunity = true,
  detail = false,
}) {
  const isOwner = currentUserId && post.author_id === currentUserId;
  const isDeleted = post.status === 'deleted';
  const isHidden = post.status === 'hidden' || post.status === 'removed';
  const body = detail ? post.body : truncate(post.body, 420);
  const commentCount = post.comment_count ?? 0;

  return (
    <article className="card p-4" aria-label={post.kind === 'poll' ? 'Poll' : 'Post'}>
      <div className="flex items-start justify-between gap-3">
        <IdentityLine
          username={post.author_username}
          displayName={post.author_display_name}
          isStaff={post.author_is_staff}
          timestamp={post.created_at}
        />
        <div className="flex shrink-0 items-center gap-1.5">
          {post.is_official ? <OfficialBadge /> : null}
          {post.kind === 'discussion' ? <Badge>Discussion</Badge> : null}
          {post.kind === 'poll' ? <Badge>Poll</Badge> : null}
          {isHidden ? <Badge tone="danger">{post.status}</Badge> : null}
          {!isOwner ? (
            <ReportDialog targetType="post" targetRef={post.id} label="this post" />
          ) : null}
          {canModerate ? (
            <Link
              href={`/moderator?target=post&id=${post.id}`}
              className="text-2xs text-muted underline hover:text-ink"
            >
              Moderate
            </Link>
          ) : null}
        </div>
      </div>

      <div className="mt-3">
        {post.kind !== 'post' && post.title ? (
          <h2 className="text-[0.9375rem] font-semibold leading-snug">
            {detail ? post.title : <Link href={ROUTES.post(post.id)}>{post.title}</Link>}
          </h2>
        ) : null}

        {isDeleted ? (
          <p className="mt-1 text-[0.8125rem] italic text-muted">
            {isOwner ? 'You deleted this post. It stays hidden from everyone else — restore it to bring it back.' : 'This post was deleted by its author.'}
          </p>
        ) : (
          <p className="user-text mt-1 text-[0.9375rem] leading-relaxed">
            {detail ? renderTextWithMentions(post.body) : renderTextWithMentions(body)}
            {!detail && post.body?.length > 420 ? (
              <>
                {' '}
                <Link href={ROUTES.post(post.id)} className="text-muted underline">
                  Read more
                </Link>
              </>
            ) : null}
          </p>
        )}

        {post.gif?.url && !isDeleted ? (
          <div className="mt-3">
            <GifAttachment gif={post.gif} />
          </div>
        ) : null}

        {poll && !isDeleted ? <PollBlock postId={post.id} poll={poll} canVote={Boolean(currentUserId)} /> : null}

        {showCommunity && post.community_slug ? (
          <p className="mt-2 text-2xs text-muted">
            in{' '}
            <Link href={ROUTES.community(post.community_slug)} className="text-ink underline">
              {post.community_name || `c/${post.community_slug}`}
            </Link>
          </p>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
        <div className="flex items-center gap-2">
          <ReactionBar
            targetType="post"
            targetId={post.id}
            count={reactions.count}
            reactedByMe={reactions.mine}
            canReact={Boolean(currentUserId) && !isDeleted}
          />
          <Link
            href={ROUTES.post(post.id)}
            className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-2xs text-muted hover:text-ink hover:no-underline"
          >
            <Icon name="comment" size={13} />
            {commentCount > 0 ? `${commentCount} comment${commentCount === 1 ? '' : 's'}` : 'Comment'}
          </Link>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-2xs text-muted lg:hidden">{relativeTime(post.created_at)}</span>
          <PostActions postId={post.id} status={post.status} canManage={isOwner} />
        </div>
      </div>
    </article>
  );
}
