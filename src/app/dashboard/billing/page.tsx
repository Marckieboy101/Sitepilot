import { Suspense } from 'react';

import type { Metadata } from 'next';

import { BillingPanel } from '@/components/dashboard/billing-panel';
import { PageHeader } from '@/components/shared/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { requireSession } from '@/features/auth/session';
import { getEntitlements } from '@/features/billing/quota';
import { paymentConfigured } from '@/features/billing/stripe';
import { db } from '@/lib/db';
import { serverEnv } from '@/lib/env';

export const metadata: Metadata = { title: 'Billing' };

export default async function BillingPage() {
  const session = await requireSession();
  const currency = serverEnv().MOLLIE_CURRENCY;

  const [entitlements, organization, invoices] = await Promise.all([
    getEntitlements(session.organizationId),
    db.organization.findUnique({
      where: { id: session.organizationId },
      select: { freePreviewUsed: true, scanCredits: true, paidScanPurchases: true },
    }),
    db.invoice.findMany({
      where: { organizationId: session.organizationId },
      orderBy: { createdAt: 'desc' },
      take: 12,
      select: {
        id: true,
        number: true,
        amountPaid: true,
        currency: true,
        status: true,
        hostedInvoiceUrl: true,
        createdAt: true,
      },
    }),
  ]);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Billing"
        description="Your plan, usage this month, and invoice history."
      />

      {/* useSearchParams in the panel needs a boundary to keep this route static-friendly. */}
      <Suspense fallback={<Skeleton className="h-96" />}>
        <BillingPanel
          plan={entitlements.plan}
          status={entitlements.status}
          cancelAtPeriodEnd={entitlements.cancelAtPeriodEnd}
          currentPeriodEnd={entitlements.currentPeriodEnd}
          billingConfigured={paymentConfigured()}
          currency={currency}
          freePreviewUsed={organization?.freePreviewUsed ?? false}
          scanCredits={organization?.scanCredits ?? 0}
          hasPurchasedScan={(organization?.paidScanPurchases ?? 0) > 0}
          usage={entitlements.usage}
          limits={{
            auditsPerMonth: entitlements.limits.auditsPerMonth,
            aiChatMessagesPerMonth: entitlements.limits.aiChatMessagesPerMonth,
            projects: entitlements.limits.projects,
          }}
          invoices={invoices}
        />
      </Suspense>
    </div>
  );
}
