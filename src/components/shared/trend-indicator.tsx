import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';

import { cn } from '@/lib/utils';

interface TrendIndicatorProps {
  current: number | null | undefined;
  previous: number | null | undefined;
  /** Lower is better for metrics like load time. */
  inverted?: boolean;
  suffix?: string;
  className?: string;
}

/**
 * Shows movement against the previous value. Renders nothing when there is no
 * comparison point — a fake "+0" on a first audit implies a history that does
 * not exist.
 */
export function TrendIndicator({ current, previous, inverted, suffix = '', className }: TrendIndicatorProps) {
  if (current == null || previous == null) return null;

  const delta = current - previous;
  const rounded = Math.round(Math.abs(delta) * 10) / 10;

  if (rounded === 0) {
    return (
      <span className={cn('inline-flex items-center gap-1 text-xs text-muted-foreground', className)}>
        <Minus className="size-3" aria-hidden="true" />
        No change
      </span>
    );
  }

  const isImprovement = inverted ? delta < 0 : delta > 0;
  const Icon = delta > 0 ? ArrowUpRight : ArrowDownRight;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs font-medium',
        isImprovement ? 'text-success' : 'text-destructive',
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      <span className="tabular-nums">
        {rounded}
        {suffix}
      </span>
      <span className="sr-only">{isImprovement ? 'better than' : 'worse than'} the previous audit</span>
    </span>
  );
}
