import { cn } from '@/lib/utils';

/**
 * Loading placeholder. Marked `aria-hidden` because the shimmering block
 * carries no information — the surrounding region announces its busy state.
 */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" className={cn('skeleton rounded-lg', className)} {...props} />;
}

export { Skeleton };
