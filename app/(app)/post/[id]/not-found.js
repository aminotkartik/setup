import { EmptyState, LinkButton } from '@/components/ui';
import { ROUTES } from '@/lib/constants';

export default function PostNotFound() {
  return (
    <EmptyState
      icon="comment"
      title="This post is not available"
      description="It may have been deleted, removed by a moderator, or it belongs to a community you are not part of."
      action={<LinkButton href={ROUTES.home} variant="primary">Back to home</LinkButton>}
    />
  );
}
