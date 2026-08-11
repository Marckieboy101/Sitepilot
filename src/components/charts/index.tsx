'use client';

import * as React from 'react';

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { BAND_COLORS, scoreBand } from '@/config/scoring';
import { cn } from '@/lib/utils';

/**
 * Chart wrappers.
 *
 * Recharts is configured once here rather than at each call site, so every
 * chart in the product shares the same axis treatment, grid weight, tooltip
 * and colour scale. Colours are read from the CSS custom properties, which is
 * what makes the charts follow the theme without a re-render or a duplicated
 * palette.
 *
 * Every chart is paired with an accessible summary — an SVG of coloured paths
 * is invisible to a screen reader, so the underlying numbers are also exposed
 * as text.
 */

const AXIS_STYLE = {
  fontSize: 11,
  fill: 'hsl(var(--muted-foreground))',
} as const;

const GRID_STROKE = 'hsl(var(--border))';

const SERIES_COLORS = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
  'hsl(var(--chart-6))',
];

interface TooltipPayloadEntry {
  name?: string | number;
  value?: string | number;
  color?: string;
  dataKey?: string | number;
}

function ChartTooltip({
  active,
  payload,
  label,
  valueSuffix = '',
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string | number;
  valueSuffix?: string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-xl border border-border bg-popover/95 px-3 py-2 text-xs shadow-xl backdrop-blur">
      {label != null && <p className="mb-1.5 font-medium text-foreground">{label}</p>}
      <div className="space-y-1">
        {payload.map((entry, index) => (
          <div key={index} className="flex items-center gap-2">
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: entry.color }}
              aria-hidden="true"
            />
            <span className="text-muted-foreground">{entry.name}</span>
            <span className="ml-auto font-medium tabular-nums text-foreground">
              {entry.value}
              {valueSuffix}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Text alternative rendered alongside every chart. */
function ChartDescription({ summary }: { summary: string }) {
  return <p className="sr-only">{summary}</p>;
}

// ---------------------------------------------------------------------------
// Score trend
// ---------------------------------------------------------------------------

export interface TrendPoint {
  label: string;
  score: number;
}

export function ScoreTrendChart({
  data,
  height = 260,
  className,
}: {
  data: TrendPoint[];
  height?: number;
  className?: string;
}) {
  const summary =
    data.length === 0
      ? 'No score history yet.'
      : `Score trend across ${data.length} audits, from ${data[0].score} on ${data[0].label} to ${data[data.length - 1].score} on ${data[data.length - 1].label}.`;

  return (
    <div className={cn('w-full', className)}>
      <ChartDescription summary={summary} />
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="score-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--chart-1))" stopOpacity={0.32} />
              <stop offset="100%" stopColor="hsl(var(--chart-1))" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={AXIS_STYLE} tickLine={false} axisLine={false} minTickGap={24} />
          <YAxis domain={[0, 100]} tick={AXIS_STYLE} tickLine={false} axisLine={false} width={40} />
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: GRID_STROKE }} />
          <Area
            type="monotone"
            dataKey="score"
            name="Overall score"
            stroke="hsl(var(--chart-1))"
            strokeWidth={2.5}
            fill="url(#score-fill)"
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: 'hsl(var(--background))' }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Category comparison
// ---------------------------------------------------------------------------

export interface CategoryPoint {
  category: string;
  score: number;
}

export function CategoryBarChart({
  data,
  height = 280,
  className,
}: {
  data: CategoryPoint[];
  height?: number;
  className?: string;
}) {
  const summary = data.map((entry) => `${entry.category} ${entry.score} out of 100`).join(', ');

  return (
    <div className={cn('w-full', className)}>
      <ChartDescription summary={`Category scores: ${summary}.`} />
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }} barCategoryGap="28%">
          <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="category" tick={AXIS_STYLE} tickLine={false} axisLine={false} interval={0} />
          <YAxis domain={[0, 100]} tick={AXIS_STYLE} tickLine={false} axisLine={false} width={40} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.4 }} />
          <Bar dataKey="score" name="Score" radius={[6, 6, 0, 0]}>
            {/* Bars are coloured by band, so a weak category reads as weak at
                a glance rather than requiring the axis to be read. */}
            {data.map((entry) => (
              <Cell key={entry.category} fill={BAND_COLORS[scoreBand(entry.score)].hex} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Radar — category profile / competitor overlay
// ---------------------------------------------------------------------------

export interface RadarSeries {
  name: string;
  data: Record<string, number>;
}

export function CategoryRadarChart({
  categories,
  series,
  height = 320,
  className,
}: {
  categories: string[];
  series: RadarSeries[];
  height?: number;
  className?: string;
}) {
  const chartData = categories.map((category) => {
    const row: Record<string, string | number> = { category };
    for (const entry of series) row[entry.name] = entry.data[category] ?? 0;
    return row;
  });

  const summary = series
    .map((entry) => `${entry.name}: ${categories.map((category) => `${category} ${entry.data[category] ?? 0}`).join(', ')}`)
    .join('. ');

  return (
    <div className={cn('w-full', className)}>
      <ChartDescription summary={summary} />
      <ResponsiveContainer width="100%" height={height}>
        <RadarChart data={chartData} outerRadius="72%">
          <PolarGrid stroke={GRID_STROKE} />
          <PolarAngleAxis dataKey="category" tick={AXIS_STYLE} />
          <Tooltip content={<ChartTooltip />} />
          {series.length > 1 && (
            <Legend
              wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
              iconType="circle"
              iconSize={8}
            />
          )}
          {series.map((entry, index) => (
            <Radar
              key={entry.name}
              name={entry.name}
              dataKey={entry.name}
              stroke={SERIES_COLORS[index % SERIES_COLORS.length]}
              fill={SERIES_COLORS[index % SERIES_COLORS.length]}
              fillOpacity={series.length > 1 ? 0.14 : 0.24}
              strokeWidth={2}
            />
          ))}
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Monthly improvements
// ---------------------------------------------------------------------------

export function MonthlyImprovementChart({
  data,
  height = 240,
  className,
}: {
  data: Array<{ month: string; average: number; audits: number }>;
  height?: number;
  className?: string;
}) {
  const summary = data
    .map((entry) => `${entry.month}: average ${entry.average} across ${entry.audits} audits`)
    .join(', ');

  return (
    <div className={cn('w-full', className)}>
      <ChartDescription summary={`Monthly averages — ${summary}.`} />
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }} barCategoryGap="32%">
          <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="month" tick={AXIS_STYLE} tickLine={false} axisLine={false} />
          <YAxis domain={[0, 100]} tick={AXIS_STYLE} tickLine={false} axisLine={false} width={40} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.4 }} />
          <Bar dataKey="average" name="Average score" radius={[6, 6, 0, 0]} fill="hsl(var(--chart-1))" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Multi-series comparison
// ---------------------------------------------------------------------------

export function ComparisonBarChart({
  data,
  seriesKeys,
  height = 320,
  className,
}: {
  data: Array<Record<string, string | number>>;
  seriesKeys: string[];
  height?: number;
  className?: string;
}) {
  const summary = data
    .map((row) => `${row.category}: ${seriesKeys.map((key) => `${key} ${row[key]}`).join(', ')}`)
    .join('. ');

  return (
    <div className={cn('w-full', className)}>
      <ChartDescription summary={summary} />
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }} barGap={4}>
          <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="category" tick={AXIS_STYLE} tickLine={false} axisLine={false} interval={0} />
          <YAxis domain={[0, 100]} tick={AXIS_STYLE} tickLine={false} axisLine={false} width={40} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.4 }} />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} iconType="circle" iconSize={8} />
          {seriesKeys.map((key, index) => (
            <Bar
              key={key}
              dataKey={key}
              radius={[4, 4, 0, 0]}
              fill={SERIES_COLORS[index % SERIES_COLORS.length]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
