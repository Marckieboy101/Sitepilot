import type { Metadata } from 'next';

import {
  BrandingPanel,
  DangerZone,
  PreferencesPanel,
  ProfilePanel,
  WorkspacePanel,
} from '@/components/dashboard/settings-panels';
import { PageHeader } from '@/components/shared/page-header';
import { PLANS } from '@/config/plans';
import { requireSession } from '@/features/auth/session';
import { getEntitlements } from '@/features/billing/quota';
import { db } from '@/lib/db';

export const metadata: Metadata = { title: 'Settings' };

export default async function SettingsPage() {
  const session = await requireSession();

  const [settings, organization, entitlements] = await Promise.all([
    db.userSettings.findUnique({
      where: { userId: session.userId },
      select: {
        theme: true,
        defaultDevice: true,
        weeklyDigest: true,
        auditCompleteEmails: true,
        productUpdates: true,
        timezone: true,
      },
    }),
    db.organization.findUnique({
      where: { id: session.organizationId },
      select: {
        name: true,
        slug: true,
        brandColor: true,
        brandLogoUrl: true,
        reportFooterText: true,
      },
    }),
    getEntitlements(session.organizationId),
  ]);

  return (
    <div className="max-w-3xl space-y-8">
      <PageHeader title="Settings" description="Your profile, workspace and report branding." />

      <ProfilePanel name={session.name} email={session.email} />

      <WorkspacePanel
        name={organization?.name ?? session.organizationName}
        slug={organization?.slug ?? session.organizationSlug}
      />

      <PreferencesPanel
        theme={settings?.theme ?? 'SYSTEM'}
        defaultDevice={settings?.defaultDevice ?? 'MOBILE'}
        weeklyDigest={settings?.weeklyDigest ?? true}
        auditCompleteEmails={settings?.auditCompleteEmails ?? true}
        productUpdates={settings?.productUpdates ?? false}
        timezone={settings?.timezone ?? 'UTC'}
      />

      <BrandingPanel
        brandColor={organization?.brandColor ?? null}
        brandLogoUrl={organization?.brandLogoUrl ?? null}
        reportFooterText={organization?.reportFooterText ?? null}
        enabled={PLANS[entitlements.plan].features.whiteLabel}
      />

      <DangerZone email={session.email} />
    </div>
  );
}
