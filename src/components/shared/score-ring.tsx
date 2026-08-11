'use client';

import * as React from 'react';

import { motion, useInView, useReducedMotion } from 'framer-motion';

import { BAND_COLORS, BAND_LABELS, scoreBand } from '@/config/scoring';
import { cn } from '@/lib/utils';

/**
 * Circular score gauge.
 *
 * Drawn as an SVG arc rather than a chart library: it is one path, it scales
 * to any size without re-layout, and it animates by interpolating a single
 * `strokeDashoffset` — which the compositor handles on its own thread.
 *
 * The number counts up alongside the arc so the value reads as *measured*
 * rather than decorative. Both animations are skipped entirely when the user
 * prefers reduced motion.
 */

interface ScoreRingProps {
  score: number;
  size?: number;
  strokeWidth?: number;
  label?: string;
  /** Renders the band name ("Good", "Needs work") beneath the number. */
  showBand?: boolean;
  className?: string;
}

export function ScoreRing({
  score,
  size = 148,
  strokeWidth = 10,
  label,
  showBand = true,
  className,
}: ScoreRingProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-40px' });
  const reduceMotion = useReducedMotion();

  const band = scoreBand(score);
  const color = BAND_COLORS[band].hex;

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const target = circumference * (1 - Math.min(100, Math.max(0, score)) / 100);

  const [displayed, setDisplayed] = React.useState(reduceMotion ? score : 0);

  React.useEffect(() => {
    if (reduceMotion || !inView) {
      setDisplayed(score);
      return;
    }

    let frame = 0;
    const durationMs = 900;
    const start = performance.now();

    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      // Matches the arc's ease-out so number and sweep stay in step.
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayed(Math.round(score * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [score, inView, reduceMotion]);

  return (
    <div
      ref={ref}
      className={cn('relative inline-flex items-center justify-center', className)}
      role="img"
      aria-label={`${label ? `${label}: ` : ''}${score} out of 100 — ${BAND_LABELS[band]}`}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="hsl(var(--muted))"
          strokeWidth={strokeWidth}
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: reduceMotion ? target : circumference }}
          animate={{ strokeDashoffset: inView || reduceMotion ? target : circumference }}
          transition={{ duration: reduceMotion ? 0 : 1, ease: [0.16, 1, 0.3, 1] }}
          style={{ filter: `drop-shadow(0 0 8px ${color}40)` }}
        />
      </svg>

      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className="font-semibold tabular-nums tracking-[-0.03em]"
          style={{ fontSize: size * 0.28, color }}
        >
          {displayed}
        </span>
        {showBand && (
          <span
            className="mt-0.5 text-[0.6875rem] font-medium uppercase tracking-wider text-muted-foreground"
            style={{ fontSize: Math.max(10, size * 0.075) }}
          >
            {label ?? BAND_LABELS[band]}
          </span>
        )}
      </div>
    </div>
  );
}

/** Compact horizontal variant used in dense lists. */
export function ScoreBar({
  score,
  label,
  className,
}: {
  score: number;
  label?: string;
  className?: string;
}) {
  const band = scoreBand(score);
  const color = BAND_COLORS[band].hex;

  return (
    <div className={cn('flex items-center gap-3', className)}>
      {label && <span className="w-28 shrink-0 truncate text-sm text-muted-foreground">{label}</span>}
      <div
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={`${label ? `${label}: ` : ''}${score} out of 100`}
      >
        <motion.div
          className="h-full rounded-full"
          style={{ backgroundColor: color }}
          initial={{ width: 0 }}
          whileInView={{ width: `${score}%` }}
          viewport={{ once: true, margin: '-30px' }}
          transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
        />
      </div>
      <span className="w-9 shrink-0 text-right text-sm font-medium tabular-nums" style={{ color }}>
        {score}
      </span>
    </div>
  );
}
