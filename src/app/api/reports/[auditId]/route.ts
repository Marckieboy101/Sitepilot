import { NextResponse, type NextRequest } from 'next/server';

import { db } from '@/lib/db';
import { isAppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/rate-limit';
import { requireSession } from '@/features/auth/session';
import { consumeQuota, getEntitlements, requireFeature } from '@/features/billing/quota';
import { getAuditDetail } from '@/features/audit/queries';
import { htmlToPdf, pdfFilename, pdfGenerationAvailable } from '@/features/reports/pdf';
import { renderReportHtml, type ReportData } from '@/features/reports/report-html';
import { PLANS } from '@/config/plans';

/**
 * Report export.
 *
 * Returns a real PDF when Chromium is configured. When it is not, the same
 * document is returned as HTML with `?format=html`, which the browser can
 * print to PDF — a degraded path that still delivers the artefact rather than
 * an error page. The export button picks the format based on a capability
 * probe, so the user never sees the difference except in the filename.
 */

const log = logger.child({ module: 'api/reports' });

export const maxDuration = 60;

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ auditId: string }> },
) {
  const { auditId } = await context.params;

  try {
    const session = await requireSession();
    enforceRateLimit(`pdf:${session.organizationId}`, RATE_LIMITS.pdfExport);

    await requireFeature(session.organizationId, 'pdfExport');

    const [audit, entitlements, organization] = await Promise.all([
      getAuditDetail(auditId, session.organizationId),
      getEntitlements(session.organizationId),
      db.organization.findUnique({
        where: { id: session.organizationId },
        select: { name: true, brandLogoUrl: true, brandColor: true, reportFooterText: true },
      }),
    ]);

    if (audit.status !== 'COMPLETED') {
      return NextResponse.json({ error: 'That audit has not completed yet.' }, { status: 409 });
    }

    await consumeQuota(session.organizationId, 'pdfExports');

    const data: ReportData = {
      url: audit.url,
      auditedAt: audit.completedAt ?? audit.createdAt,
      device: audit.device,
      overallScore: audit.overallScore ?? 0,
      previousScore: audit.previousScore,
      categories: audit.categoryScores,
      executiveSummary: audit.aiReport?.executiveSummary ?? null,
      strengths: audit.aiReport?.strengths ?? [],
      weaknesses: audit.aiReport?.weaknesses ?? [],
      longTermOutlook: audit.aiReport?.longTermOutlook ?? null,
      recommendations: audit.recommendations,
      issues: audit.issues,
      metrics: audit.performanceResult
        ? {
            firstContentfulPaint: audit.performanceResult.firstContentfulPaint,
            largestContentfulPaint: audit.performanceResult.largestContentfulPaint,
            cumulativeLayoutShift: audit.performanceResult.cumulativeLayoutShift,
            totalBlockingTime: audit.performanceResult.totalBlockingTime,
            speedIndex: audit.performanceResult.speedIndex,
          }
        : null,
      screenshots: audit.screenshots,
    };

    const whiteLabel = PLANS[entitlements.plan].features.whiteLabel;

    const html = renderReportHtml(data, {
      organizationName: organization?.name ?? 'Momo',
      logoUrl: whiteLabel ? (organization?.brandLogoUrl ?? null) : null,
      brandColor: whiteLabel ? (organization?.brandColor ?? null) : null,
      footerText: whiteLabel ? (organization?.reportFooterText ?? null) : null,
      whiteLabel,
    });

    const wantsHtml = request.nextUrl.searchParams.get('format') === 'html';

    if (wantsHtml || !pdfGenerationAvailable()) {
      return new NextResponse(html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'private, no-store',
        },
      });
    }

    const pdf = await htmlToPdf(html);

    if (!pdf) {
      // Chromium was configured but failed. Fall back rather than 500 — the
      // user still gets their report.
      log.warn('PDF render failed, returning HTML fallback', { auditId });
      return new NextResponse(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store' },
      });
    }

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${pdfFilename(audit.url, data.auditedAt)}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    if (isAppError(error)) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    log.error('report export failed', { auditId, error });
    return NextResponse.json({ error: 'Could not generate the report.' }, { status: 500 });
  }
}
