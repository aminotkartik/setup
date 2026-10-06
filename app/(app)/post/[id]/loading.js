import { SkeletonList } from '@/components/ui';

export default function PostLoading() {
  return (
    <div className="flex flex-col gap-4">
      <div className="h-6 w-24 animate-pulse rounded bg-white" />
      <SkeletonList rows={2} />
      <SkeletonList rows={3} />
    </div>
  );
}
