import { SkeletonList } from '@/components/ui';

export default function ConversationLoading() {
  return (
    <div className="flex flex-col gap-4">
      <div className="h-7 w-48 animate-pulse rounded bg-white" />
      <SkeletonList rows={4} />
    </div>
  );
}
