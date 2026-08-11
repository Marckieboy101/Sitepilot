import * as React from 'react';

import Link from 'next/link';

import { AuroraBackground } from '@/components/marketing/aurora-background';
import { Logo } from '@/components/shared/logo';

interface AuthShellProps {
  title: string;
  description?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Shared frame for every auth screen.
 *
 * A two-column layout on desktop: the form on the left at a comfortable
 * reading width, and a value-reminder panel on the right. The panel is
 * `aria-hidden` and hidden below `lg` — it is reassurance, not content, and
 * repeating the marketing pitch to a screen reader before the form would just
 * be an obstacle.
 */
export function AuthShell({ title, description, footer, children }: AuthShellProps) {
  return (
    <div className="relative flex min-h-dvh flex-col lg:flex-row">
      <AuroraBackground className="lg:w-1/2" />

      <div className="flex flex-1 flex-col px-4 py-8 sm:px-8 lg:w-1/2">
        <header className="flex items-center justify-between">
          <Logo />
          <Link
            href="/"
            className="rounded-lg px-2 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            Back to site
          </Link>
        </header>

        <main id="main" className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-sm">
            <h1 className="text-2xl font-semibold tracking-[-0.025em]">{title}</h1>
            {description && (
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
            )}
            <div className="mt-8">{children}</div>
            {footer && <div className="mt-6 text-center text-sm text-muted-foreground">{footer}</div>}
          </div>
        </main>
      </div>

      <aside
        className="relative hidden w-1/2 border-l border-border/60 bg-muted/20 lg:flex lg:items-center lg:justify-center"
        aria-hidden="true"
      >
        <div className="max-w-md px-12">
          <blockquote className="text-2xl font-medium leading-snug tracking-[-0.02em]">
            “Most audit tools hand you a list of numbers. The useful part is knowing which one to fix on
            Monday morning.”
          </blockquote>

          <div className="mt-10 space-y-4">
            {[
              'Full technical audit in under a minute',
              'AI explains every finding in plain English',
              'Prioritised by impact against effort',
              'Three free audits, no card required',
            ].map((line) => (
              <div key={line} className="flex items-center gap-3">
                <span className="flex size-5 items-center justify-center rounded-full bg-success/15">
                  <svg viewBox="0 0 12 12" className="size-3 text-success" fill="none">
                    <path
                      d="M2.5 6.2 4.7 8.4 9.5 3.6"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <span className="text-sm text-muted-foreground">{line}</span>
              </div>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}
