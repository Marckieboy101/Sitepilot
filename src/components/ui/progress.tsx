'use client';

import * as React from 'react';

import * as ProgressPrimitive from '@radix-ui/react-progress';
import { cn } from '@/lib/utils';

interface ProgressProps
  extends React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> {
  /** Explicit bar colour, e.g. a score band hex. Defaults to the primary token. */
  indicatorColor?: string;
  indicatorClassName?: string;
}

const Progress = React.forwardRef<React.ElementRef<typeof ProgressPrimitive.Root>, ProgressProps>(
  ({ className, value, indicatorColor, indicatorClassName, ...props }, ref) => {
    const safeValue = typeof value === 'number' && Number.isFinite(value) ? value : undefined;

    return (
      <ProgressPrimitive.Root
        ref={ref}
        className={cn('relative h-2 w-full overflow-hidden rounded-full bg-muted', className)}
        value={safeValue}
        {...props}
      >
        <ProgressPrimitive.Indicator
          className={cn('size-full flex-1 rounded-full transition-transform duration-700 ease-out', indicatorClassName)}
          style={{
            transform: `translateX(-${100 - (safeValue ?? 0)}%)`,
            backgroundColor: indicatorColor ?? 'hsl(var(--primary))',
          }}
        />
      </ProgressPrimitive.Root>
    );
  },
);
Progress.displayName = ProgressPrimitive.Root.displayName;

export { Progress };
