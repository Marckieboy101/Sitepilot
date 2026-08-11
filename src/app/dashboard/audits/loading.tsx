import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-72" />
      </div>
      <Skeleton className="h-10 w-72" />
      <div className="space-y-px overflow-hidden rounded-xl border border-border">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-[74px] rounded-none" />
        ))}
      </div>
    </div>
  );
}
