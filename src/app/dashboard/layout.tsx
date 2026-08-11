import { redirect } from 'next/navigation';

import { DesktopSidebar } from '@/components/dashboard/sidebar';
import { Topbar } from '@/components/dashboard/topbar';
import { db } from '@/lib/db';
import { getSession } from '@/features/auth/session';
import { getEntitlements } from '@/features/billing/quota';
import { getNotifications } from '@/features/notifications/queries';
import { displayUrl } from '@/lib/url';

/**
 * Every route under /dashboard reads the session and per-user data, so none of
 * it can be prerendered. Declaring it on the layout covers the whole subtree
 * rather than relying on each page to opt out individually.
 */
export const dynamic = 'force-dynamic';

/**
 * Authenticated shell.
 *
 * The middleware already redirects unauthenticated requests, but the check is
 * repeated here: middleware protects routes by path pattern, and a layout that
 * assumes a session because "the middleware handles it" breaks the moment the
 * matcher changes. Defence in depth, and it is one cached call.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login?next=/dashboard');

  const [entitlements, notifications, searchTargets] = await Promise.all([
    getEntitlements(session.organizationId),
    getNotifications(session.userId),
    // Search index: recent audits, resolved once per navigation rather than
    // hitting the server on every keystroke.
    db.audit.findMany({
      where: { website: { project: { organizationId: session.organizationId } } },
      orderBy: { createdAt: 'desc' },
      take: 40,
      select: {
        id: true,
        url: true,
        overallScore: true,
        createdAt: true,
        website: { select: { label: true, project: { select: { name: true } } } },
      },
    }),
  ]);

  const usage = {
    plan: entitlements.plan,
    auditsUsed: entitlements.usage.auditsRun,
    auditsLimit: entitlements.limits.auditsPerMonth,
  };

  return (
    <div className="min-h-dvh bg-background">
      <DesktopSidebar usage={usage} />

      <div className="lg:pl-64">
        <Topbar
          user={{ name: session.name, email: session.email, avatarUrl: session.avatarUrl }}
          usage={usage}
          notifications={notifications}
          searchTargets={searchTargets.map((audit) => ({
            id: audit.id,
            label: audit.website.label ?? displayUrl(audit.url),
            sublabel: `${audit.website.project.name} · ${
              audit.overallScore != null ? `${audit.overallScore}/100` : 'in progress'
            } · ${audit.createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
            href: `/dashboard/audits/${audit.id}`,
          }))}
        />

        <main id="main" className="mx-auto max-w-[100rem] px-4 py-8 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
