import * as React from 'react';

import { cn } from '@/lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Renders a leading icon inside the field and pads the text accordingly. */
  icon?: React.ReactNode;
  error?: boolean;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, icon, error, ...props }, ref) => {
    const field = (
      <input
        type={type}
        ref={ref}
        aria-invalid={error || undefined}
        className={cn(
          'flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm',
          'shadow-sm transition-[border-color,box-shadow] duration-200',
          'placeholder:text-muted-foreground/70',
          'file:border-0 file:bg-transparent file:text-sm file:font-medium',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:border-ring',
          'disabled:cursor-not-allowed disabled:opacity-50',
          error && 'border-destructive focus-visible:ring-destructive/40 focus-visible:border-destructive',
          icon && 'pl-10',
          className,
        )}
        {...props}
      />
    );

    if (!icon) return field;

    return (
      <div className="relative">
        <span
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground [&_svg]:size-4"
          aria-hidden="true"
        >
          {icon}
        </span>
        {field}
      </div>
    );
  },
);
Input.displayName = 'Input';

export { Input };
