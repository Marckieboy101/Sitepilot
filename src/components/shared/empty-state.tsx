import * as React from 'react';

import { cn } from '@/lib/utils';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

/**
 * Empty states are a first-class screen, not an afterthought: a new account
 * sees more of these than anything else, so each one explains what belongs
 * here and offers the action that fills it.
 */
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'relative flex flex-col items-center justify-center overflow-hidden rounded-2xl',
        'border border-dashed border-border/80 px-6 py-16 text-center',
        className,
      )}
    >
      <div className="bg-dots pointer-events-none absolute inset-0 opacity-40 [mask-image:radial-gradient(ellipse_at_center,black,transparent_72%)]" />

      <div className="relative">
        {icon && (
          <div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,hsl(var(--glow-a)/0.16),hsl(var(--glow-b)/0.16))] text-primary [&_svg]:size-6">
            {icon}
          </div>
        )}
        <h3 className="text-base font-semibold">{title}</h3>
        {description && (
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">{description}</p>
        )}
        {action && <div className="mt-6 flex justify-center gap-3">{action}</div>}
      </div>
    </div>
  );
}
