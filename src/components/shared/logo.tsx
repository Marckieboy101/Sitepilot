import Link from 'next/link';

import { cn } from '@/lib/utils';

/** The paper-plane mark. Inline SVG so it inherits colour and needs no request. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={cn('size-8', className)} aria-hidden="true">
      <defs>
        <linearGradient id="sp-logo-gradient" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="hsl(var(--glow-a))" />
          <stop offset="0.55" stopColor="hsl(var(--glow-c))" />
          <stop offset="1" stopColor="hsl(var(--glow-b))" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#sp-logo-gradient)" />
      <path
        d="M23.5 8.5 9.2 14.1a.6.6 0 0 0-.05 1.09l5.36 2.63 2.63 5.36a.6.6 0 0 0 1.09-.05L23.5 8.5Z"
        fill="white"
        fillOpacity="0.95"
      />
    </svg>
  );
}

interface LogoProps {
  className?: string;
  href?: string | null;
  showWordmark?: boolean;
}

export function Logo({ className, href = '/', showWordmark = true }: LogoProps) {
  const content = (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark />
      {showWordmark && (
        <span className="text-[1.0625rem] font-semibold tracking-[-0.02em]">
          SitePilot AI
        </span>
      )}
    </span>
  );

  if (!href) return content;

  return (
    <Link href={href} className="rounded-lg transition-opacity hover:opacity-85">
      <span className="sr-only">SitePilot AI — home</span>
      <span aria-hidden="true">{content}</span>
    </Link>
  );
}
