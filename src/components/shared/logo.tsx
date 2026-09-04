import Link from 'next/link';

import { cn } from '@/lib/utils';

export function LogoMark({ className }: { className?: string }) {
  return null;
}

interface LogoProps {
  className?: string;
  href?: string | null;
  showWordmark?: boolean;
}

export function Logo({ className, href = '/', showWordmark = true }: LogoProps) {
  return null;
}
