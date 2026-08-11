'use client';

import * as React from 'react';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bell, LogOut, Menu, Plus, Search, Settings, User as UserIcon } from 'lucide-react';
import { toast } from 'sonner';

import { ThemeToggle } from '@/components/shared/theme-toggle';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { signOutAction } from '@/features/auth/actions';
import { markNotificationsReadAction } from '@/features/notifications/actions';
import { cn, initialsOf } from '@/lib/utils';

import { SidebarContent, type SidebarUsage } from './sidebar';
import { NewAuditDialog } from './new-audit-dialog';

export interface TopbarNotification {
  id: string;
  title: string;
  body: string | null;
  href: string | null;
  readAt: Date | null;
  createdAt: Date;
}

interface TopbarProps {
  user: { name: string | null; email: string; avatarUrl: string | null };
  usage: SidebarUsage;
  notifications: TopbarNotification[];
  searchTargets: Array<{ id: string; label: string; sublabel: string; href: string }>;
}

export function Topbar({ user, usage, notifications, searchTargets }: TopbarProps) {
  const [mobileNav, setMobileNav] = React.useState(false);
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [auditOpen, setAuditOpen] = React.useState(false);

  const unread = notifications.filter((notification) => !notification.readAt).length;

  // ⌘K / Ctrl-K opens search from anywhere in the dashboard.
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setSearchOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <>
      <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur-xl sm:px-6">
        <Button
          variant="ghost"
          size="icon-sm"
          className="lg:hidden"
          onClick={() => setMobileNav(true)}
          aria-label="Open navigation"
        >
          <Menu className="size-4" />
        </Button>

        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          className={cn(
            'group flex h-9 flex-1 items-center gap-2.5 rounded-lg border border-border bg-muted/40 px-3',
            'text-sm text-muted-foreground transition-colors hover:bg-muted/70',
            'sm:max-w-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        >
          <Search className="size-4 shrink-0" aria-hidden="true" />
          <span className="flex-1 text-left">Search audits…</span>
          <kbd className="hidden rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[0.625rem] sm:inline-block">
            ⌘K
          </kbd>
        </button>

        <div className="ml-auto flex items-center gap-1.5">
          <Button variant="gradient" size="sm" className="hidden sm:inline-flex" onClick={() => setAuditOpen(true)}>
            <Plus className="size-4" />
            New audit
          </Button>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon-sm" className="relative" aria-label={`Notifications${unread > 0 ? `, ${unread} unread` : ''}`}>
                <Bell className="size-4" />
                {unread > 0 && (
                  <span className="absolute right-1 top-1 flex size-2">
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60" />
                    <span className="relative inline-flex size-2 rounded-full bg-primary" />
                  </span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-0">
              <NotificationList notifications={notifications} unread={unread} />
            </PopoverContent>
          </Popover>

          <ThemeToggle />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="ml-1 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                aria-label="Account menu"
              >
                <Avatar>
                  {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt="" />}
                  <AvatarFallback>{initialsOf(user.name ?? user.email)}</AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuLabel className="normal-case tracking-normal">
                <span className="block text-sm font-medium text-foreground">{user.name ?? 'Your account'}</span>
                <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/dashboard/settings">
                  <UserIcon /> Profile
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/dashboard/settings">
                  <Settings /> Settings
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                destructive
                onSelect={(event) => {
                  event.preventDefault();
                  void signOutAction();
                }}
              >
                <LogOut /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* Mobile navigation */}
      <Dialog open={mobileNav} onOpenChange={setMobileNav}>
        <DialogContent className="left-0 top-0 h-dvh max-w-72 translate-x-0 translate-y-0 rounded-none border-y-0 border-l-0 p-0 data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left">
          <DialogHeader className="sr-only">
            <DialogTitle>Navigation</DialogTitle>
          </DialogHeader>
          <SidebarContent usage={usage} onNavigate={() => setMobileNav(false)} />
        </DialogContent>
      </Dialog>

      <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} targets={searchTargets} />
      <NewAuditDialog open={auditOpen} onOpenChange={setAuditOpen} />
    </>
  );
}

function NotificationList({
  notifications,
  unread,
}: {
  notifications: TopbarNotification[];
  unread: number;
}) {
  const router = useRouter();
  const [marking, setMarking] = React.useState(false);

  async function markAllRead() {
    setMarking(true);
    const result = await markNotificationsReadAction();
    setMarking(false);
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    router.refresh();
  }

  return (
    <div>
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="text-sm font-medium">Notifications</span>
        {unread > 0 && (
          <Button variant="ghost" size="sm" onClick={markAllRead} loading={marking} className="h-7 text-xs">
            Mark all read
          </Button>
        )}
      </div>

      {notifications.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground">
          Nothing yet. Run an audit and we&apos;ll let you know when it&apos;s ready.
        </p>
      ) : (
        <ScrollArea className="max-h-80">
          <ul className="divide-y divide-border">
            {notifications.map((notification) => {
              const body = (
                <>
                  <div className="flex items-start gap-2">
                    {!notification.readAt && (
                      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                    )}
                    <div className={cn('min-w-0 flex-1', notification.readAt && 'pl-3.5')}>
                      <p className="text-sm font-medium">{notification.title}</p>
                      {notification.body && (
                        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                          {notification.body}
                        </p>
                      )}
                      <p className="mt-1 text-[0.6875rem] text-muted-foreground">
                        {new Date(notification.createdAt).toLocaleString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>
                  </div>
                </>
              );

              return (
                <li key={notification.id}>
                  {notification.href ? (
                    <Link href={notification.href} className="block px-4 py-3 transition-colors hover:bg-accent/60">
                      {body}
                    </Link>
                  ) : (
                    <div className="px-4 py-3">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </ScrollArea>
      )}
    </div>
  );
}

function SearchDialog({
  open,
  onOpenChange,
  targets,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targets: Array<{ id: string; label: string; sublabel: string; href: string }>;
}) {
  const [query, setQuery] = React.useState('');
  const router = useRouter();

  const results = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return targets.slice(0, 8);
    return targets
      .filter(
        (target) =>
          target.label.toLowerCase().includes(needle) || target.sublabel.toLowerCase().includes(needle),
      )
      .slice(0, 8);
  }, [query, targets]);

  React.useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[18%] max-w-lg translate-y-0 gap-0 p-0" hideClose>
        <DialogHeader className="sr-only">
          <DialogTitle>Search</DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-3 border-b border-border px-4">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search audits and websites…"
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            aria-label="Search audits and websites"
          />
        </div>

        {results.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            No matches for “{query}”.
          </p>
        ) : (
          <ul className="max-h-80 overflow-y-auto p-2">
            {results.map((result) => (
              <li key={result.id}>
                <button
                  type="button"
                  onClick={() => {
                    onOpenChange(false);
                    router.push(result.href);
                  }}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-accent"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{result.label}</span>
                    <span className="block truncate text-xs text-muted-foreground">{result.sublabel}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="border-t border-border px-4 py-2.5">
          <Badge variant="muted" className="font-mono text-[0.625rem]">
            esc to close
          </Badge>
        </div>
      </DialogContent>
    </Dialog>
  );
}
