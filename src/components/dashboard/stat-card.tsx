import * as React from 'react';

import { Card } from '@/components/ui/card';
import { TrendIndicator } from '@/components/shared/trend-indicator';
import { BAND_COLORS, scoreBand } from '@/config/scoring';
import { cn } from '@/lib/utils';

interface StatCardProps {
  label: string;
  value: React.ReactNode;
  hint?: string;
  icon?: React.ReactNode;
  current?: number | null;
  previous?: number | null;
  invertedTrend?: boolean;
  className?: string;
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  current,
  previous,
  invertedTrend,
  className,
}: StatCardProps) {
  return (
    <Card variant="default" interactive className={cn('p-5', className)}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        {icon && (
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4">
            {icon}
          </span>
        )}
      </div>

      <p className="mt-3 text-2xl font-semibold tracking-[-0.03em] tabular-nums">{value}</p>

      <div className="mt-1.5 flex items-center gap-2">
        <TrendIndicator current={current} previous={previous} inverted={invertedTrend} />
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
    </Card>
  );
}

/**
 * Category tile with a colour-banded score.
 *
 * The band colour is paired with the numeric score and a text label — colour
 * alone would carry the whole meaning otherwise, which fails for anyone with a
 * colour vision deficiency.
 */
export function CategoryCard({
  label,
  score,
  description,
  href,
}: {
  label: string;
  score: number;
  description?: string;
  href?: string;
}) {
  const band = scoreBand(score);
  const colors = BAND_COLORS[band];

  const content = (
    <Card variant="default" interactive className="h-full p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{label}</p>
          {description && (
            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{description}</p>
          )}
        </div>
        <span
          className={cn(
            'shrink-0 rounded-lg px-2.5 py-1 text-lg font-semibold tabular-nums ring-1',
            colors.bg,
            colors.text,
            colors.ring,
          )}
        >
          {score}
        </span>
      </div>

      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full transition-[width] duration-700"
          style={{ width: `${score}%`, backgroundColor: colors.hex }}
        />
      </div>
    </Card>
  );

  if (!href) return content;

  return (
    <a href={href} className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {content}
    </a>
  );
}
