import Image from 'next/image';
import Link from 'next/link';

import { cn } from '@/lib/utils';

export function LogoMark({ className }: { className?: string }) {
  return (
    <Image
      src="/logo.png"
      alt="GetTravik logo"
      width={48}
      height={48}
      priority
      className={cn('h-10 w-10 shrink-0 object-contain sm:h-12 sm:w-12', className)}
    />
  );
}

interface LogoProps {
  className?: string;
  href?: string | null;
  showWordmark?: boolean;
}

export function Logo({ className, href = '/', showWordmark = true }: LogoProps) {
  const content = (
    <>
      <LogoMark />
      {showWordmark && <span className="text-lg font-semibold tracking-[-0.03em] text-foreground">GetTravik</span>}
    </>
  );

  if (href) {
    return (
      <Link href={href} className={cn('inline-flex items-center gap-2', className)}>
        {content}
      </Link>
    );
  }

  return <div className={cn('inline-flex items-center gap-2', className)}>{content}</div>;
}
