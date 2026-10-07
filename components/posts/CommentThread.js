import Link from 'next/link';
import { ROUTES } from '@/lib/constants';
import { relativeTime } from '@/lib/utils';
import { Badge } from '@/components/ui';
import { IdentityLine } from '@/components/identity/IdentityLine';
import { GifAttachment } from '@/components/media/GifPicker';
import { ReactionBar } from '@/components/posts/ReactionBar';
import { CommentComposer } from '@/components/posts/CommentComposer';
import { CommentActions } from '@/components/posts/CommentActions';
import { ReportDialog } from '@/components/social/ReportDialog';
import { renderTextWithMentions } from '@/components/posts/richText';

/**
 * Comments: flat reading with one level of replies.
 *
 * Each comment shows who, what, when, and only the actions the viewer actually
 * has: react, reply, report, and delete when the comment is theirs.
 */
export function CommentThread({
  comments = [],
  postId,
  currentUserId = null,
  canComment = true,
  commentDisabledReason = null,
}) {
  const roots = comments.filter((comment) => !comment.parent_id);
  const repliesOf = (id) => comments.filter((comment) => comment.parent_id === id);
  const total = comments.length;

  return (
    <section id="comments" className="flex flex-col gap-3" aria-label="Comments">
      <h2 className="t-section">
        {total === 0 ? 'No comments yet' : `${total} comment${total === 1 ? '' : 's'}`}
      </h2>

      {canComment ? (
        <CommentComposer postId={postId} />
      ) : (
        <p className="card p-3 text-[0.8125rem] text-muted">{commentDisabledReason || 'Sign in to comment.'}</p>
      )}

      {roots.length ? (
        <ul className="flex flex-col gap-3">
          {roots.map((comment) => (
            <li key={comment.id} className="flex flex-col gap-2">
              <CommentItem comment={comment} postId={postId} currentUserId={currentUserId} />
              {repliesOf(comment.id).length ? (
                <ul className="ml-5 flex flex-col gap-2 border-l border-line pl-3">
                  {repliesOf(comment.id).map((reply) => (
                    <li key={reply.id}>
                      <CommentItem comment={reply} postId={postId} currentUserId={currentUserId} isReply />
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function CommentItem({ comment, postId, currentUserId, isReply = false }) {
  const isOwner = currentUserId && comment.author_id === currentUserId;
  const removed = comment.status === 'removed' || comment.status === 'hidden';
  const deleted = comment.status === 'deleted';

  return (
    <article className="card p-3" id={`comment-${comment.id}`}>
      <div className="flex items-start justify-between gap-3">
        <IdentityLine
          username={comment.author_username}
          displayName={comment.author_display_name}
          isStaff={comment.author_is_staff}
          size="sm"
          timestamp={comment.created_at}
        />
        {removed ? <Badge tone="danger">Removed</Badge> : null}
      </div>

      {deleted ? (
        <p className="mt-2 text-[0.8125rem] italic text-muted">This comment was deleted.</p>
      ) : (
        <>
          <p className="user-text mt-2 text-[0.875rem] leading-relaxed">{renderTextWithMentions(comment.body)}</p>
          {comment.gif?.url ? (
            <div className="mt-2">
              <GifAttachment gif={comment.gif} />
            </div>
          ) : null}
        </>
      )}

      {!deleted ? (
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2.5">
          <ReactionBar
            targetType="comment"
            targetId={comment.id}
            count={comment.reaction_count ?? 0}
            reactedByMe={Boolean(comment.reacted_by_me)}
            canReact={Boolean(currentUserId)}
          />
          <div className="flex items-center gap-2">
            {!isReply ? <CommentComposer postId={postId} parentId={comment.id} compact label="Reply" /> : null}
            {isOwner ? (
              <CommentActions commentId={comment.id} postId={postId} />
            ) : (
              <ReportDialog targetType="comment" targetRef={comment.id} label="this comment" />
            )}
            <Link
              href={`${ROUTES.post(postId)}#comment-${comment.id}`}
              className="text-2xs text-muted-soft transition-colors hover:text-ink"
            >
              {relativeTime(comment.created_at)}
            </Link>
          </div>
        </div>
      ) : null}
    </article>
  );
}
