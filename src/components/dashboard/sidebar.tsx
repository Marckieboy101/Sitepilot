'use client';

import * as React from 'react';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  CreditCard,
  FileText,
  FolderKanban,
  Gauge,
  History,
  LayoutDashboard,
  Settings,
  Sparkles,
  Users,
} from 'lucide-react';

import { Logo } from '@/components/shared/logo';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { PLANS } from '@/config/plans';
import { cn } from '@/lib/utils';
import type { Plan } from '@prisma/client';

const NAV_SECTIONS = [
  {
    label: null,
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, exact: true },
      { href: '/dashboard/projects', label: 'Projects', icon: FolderKanban },
      { href: '/dashboard/audits', label: 'Website Audits', icon: Gauge },
      { href: '/dashboard/reports', label: 'AI Reports', icon: FileText },
    ],
  },
  {
    label: 'Analysis',
    items: [
      { href: '/dashboard/competitors', label: 'Competitors', icon: Users },
      { href: '/dashboard/history', label: 'History', icon: History },
      { href: '/dashboard/assistant', label: 'AI Assistant', icon: Sparkles },
    ],
  },
  {
    label: 'Account',
    items: [
      { href: '/dashboard/billing', label: 'Billing', icon: CreditCard },
      { href: '/dashboard/settings', label: 'Settings', icon: Settings },
    ],
  },
] as const;

export interface SidebarUsage {
  plan: Plan;
  auditsUsed: number;
  auditsLimit: number | null;
}

interface SidebarProps {
  usage: SidebarUsage;
  onNavigate?: () => void;
}

export function SidebarContent({ usage, onNavigate }: SidebarProps) {
  const pathname = usePathname();

  // Exact match for the index route only; every other item highlights for its
  // whole subtree so a detail page keeps its parent lit.
  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  const plan = PLANS[usage.plan];
  const percentUsed =
    usage.auditsLimit == null ? 0 : Math.min(100, (usage.auditsUsed / usage.auditsLimit) * 100);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 shrink-0 items-center px-5">
        <Logo href="/dashboard" />
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4" aria-label="Dashboard">
        {NAV_SECTIONS.map((section, index) => (
          <div key={section.label ?? `section-${index}`}>
            {section.label && (
              <p className="mb-2 px-3 text-[0.6875rem] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                {section.label}
              </p>
            )}
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active = isActive(item.href, 'exact' in item ? item.exact : false);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                        active
                          ? 'bg-accent text-foreground'
                          : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                      )}
                    >
                      {/* Active rail — a colour change alone is too subtle at
                          this weight to scan quickly. */}
                      {active && (
                        <span
                          className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-primary"
                          aria-hidden="true"
                        />
                      )}
                      <item.icon
                        className={cn('size-4 shrink-0', active ? 'text-primary' : 'text-muted-foreground')}
                        aria-hidden="true"
                      />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="shrink-0 border-t border-border p-3">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{plan.name} plan</span>
            <Badge variant={usage.plan === 'FREE' ? 'muted' : 'default'}>
              {usage.plan === 'FREE' ? 'Free' : 'Active'}
            </Badge>
          </div>

          <div className="mt-3 space-y-1.5">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Audits this month</span>
              <span className="tabular-nums">
                {usage.auditsUsed}
                {usage.auditsLimit != null ? ` / ${usage.auditsLimit}` : ''}
              </span>
            </div>
            {usage.auditsLimit != null ? (
              <Progress
                value={percentUsed}
                className="h-1.5"
                indicatorColor={percentUsed >= 100 ? 'hsl(var(--destructive))' : undefined}
              />
            ) : (
              <p className="text-xs text-muted-foreground">Unlimited</p>
            )}
          </div>

          {usage.plan === 'FREE' && (
            <Button variant="gradient" size="sm" className="mt-4 w-full" asChild>
              <Link href="/dashboard/billing">
                <BarChart3 className="size-3.5" />
                Upgrade
              </Link>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function DesktopSidebar(props: SidebarProps) {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-border bg-card/40 lg:block">
      <SidebarContent {...props} />
    </aside>
  );
}
