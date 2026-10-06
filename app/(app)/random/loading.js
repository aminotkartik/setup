import { SkeletonList } from '@/components/ui';

export default function RandomLoading() {
  return (
    <div className="flex flex-col gap-4">
      <div className="h-7 w-32 animate-pulse rounded bg-white" />
      <div className="card h-20 animate-pulse" />
      <SkeletonList rows={4} />
    </div>
  );
}
