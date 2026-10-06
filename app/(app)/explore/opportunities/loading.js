import { SkeletonList } from '@/components/ui';

export default function ExploreLoading() {
  return (
    <div className="flex flex-col gap-4">
      <div className="h-7 w-32 animate-pulse rounded bg-white" />
      <SkeletonList rows={5} />
    </div>
  );
}
