import { EmptyState, LinkButton } from '@/components/ui';

export const metadata = { title: 'Not found' };

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-14">
      <EmptyState
        icon="search"
        title="That page does not exist"
        description="The link may be old, or the content may have been removed by its author or a moderator."
        action={
          <LinkButton href="/home" variant="primary" icon="home">
            Back to home
          </LinkButton>
        }
      />
    </div>
  );
}
