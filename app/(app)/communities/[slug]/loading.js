import { SkeletonList } from '@/components/ui';

export default function CommunitiesLoading() {
  return (
    <div className="flex flex-col gap-4">
      <div className="h-7 w-40 animate-pulse rounded bg-white" />
      <div className="card h-24 animate-pulse" />
      <SkeletonList rows={5} />
    </div>
  );
}
