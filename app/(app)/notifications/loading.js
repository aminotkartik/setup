import { SkeletonList } from '@/components/ui';

export default function NotificationsLoading() {
  return (
    <div className="flex flex-col gap-4">
      <div className="h-7 w-44 animate-pulse rounded bg-white" />
      <SkeletonList rows={6} />
    </div>
  );
}
