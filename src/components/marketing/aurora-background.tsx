import { cn } from '@/lib/utils';

/**
 * Ambient hero background: three blurred colour fields drifting behind a fine
 * grid, faded out toward the edges.
 *
 * Implemented as static CSS rather than canvas or WebGL. It costs nothing on
 * the main thread, ships no JavaScript, renders identically on the server, and
 * the whole thing stops moving under `prefers-reduced-motion` because the
 * global rule in globals.css neutralises the animation.
 */
export function AuroraBackground({ className }: { className?: string }) {
  return (
    <div className={cn('pointer-events-none absolute inset-0 -z-10 overflow-hidden', className)} aria-hidden="true">
      {/* Grid, masked to a soft ellipse so it never meets a hard edge. */}
      <div className="bg-grid absolute inset-0 opacity-[0.35] [mask-image:radial-gradient(ellipse_70%_60%_at_50%_0%,black,transparent)] dark:opacity-25" />

      {/* Drifting colour fields. Large blur radii keep the banding invisible. */}
      <div
        className="animate-aurora absolute -left-[10%] -top-[20%] size-[42rem] rounded-full opacity-[0.28] blur-[120px] dark:opacity-30"
        style={{ background: 'radial-gradient(circle, hsl(var(--glow-a)), transparent 68%)' }}
      />
      <div
        className="animate-aurora animate-delay-300 absolute -right-[8%] -top-[10%] size-[38rem] rounded-full opacity-[0.24] blur-[130px] dark:opacity-28"
        style={{ background: 'radial-gradient(circle, hsl(var(--glow-b)), transparent 68%)' }}
      />
      <div
        className="animate-aurora animate-delay-500 absolute left-[28%] top-[22%] size-[34rem] rounded-full opacity-[0.2] blur-[140px] dark:opacity-24"
        style={{ background: 'radial-gradient(circle, hsl(var(--glow-c)), transparent 68%)' }}
      />

      {/* Fades the whole field into the page background. */}
      <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-b from-transparent to-background" />
    </div>
  );
}

/** Lighter variant for section backgrounds further down the page. */
export function SectionGlow({
  className,
  color = 'a',
}: {
  className?: string;
  color?: 'a' | 'b' | 'c';
}) {
  const token = color === 'a' ? '--glow-a' : color === 'b' ? '--glow-b' : '--glow-c';

  return (
    <div
      className={cn(
        'pointer-events-none absolute left-1/2 -z-10 size-[36rem] -translate-x-1/2 rounded-full opacity-[0.13] blur-[140px] dark:opacity-[0.18]',
        className,
      )}
      style={{ background: `radial-gradient(circle, hsl(var(${token})), transparent 70%)` }}
      aria-hidden="true"
    />
  );
}
