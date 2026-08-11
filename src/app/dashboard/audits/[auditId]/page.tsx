import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AlertCircle, ArrowLeft, ExternalLink, Monitor, Smartphone } from 'lucide-react';

import { CategoryRadarChart } from '@/components/charts';
import {
  BooleanValue,
  BrokenLinksPanel,
  DetailGrid,
  DimensionBreakdown,
  ExecutiveSummary,
  IssueList,
  OpportunityList,
  PageWeightPanel,
  RecommendationList,
  WarningsBanner,
  WebVitals,
  type DimensionEntry,
} from '@/components/dashboard/audit-report';
import { ExportReportButton } from '@/components/dashboard/export-report-button';
import { NewAuditButton } from '@/components/dashboard/new-audit-dialog';
import { CategoryCard } from '@/components/dashboard/stat-card';
import { ScoreRing } from '@/components/shared/score-ring';
import { TrendIndicator } from '@/components/shared/trend-indicator';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CATEGORY_DESCRIPTIONS, CATEGORY_LABELS } from '@/config/scoring';
import { requireSession } from '@/features/auth/session';
import { getAuditDetail } from '@/features/audit/queries';
import { isAppError } from '@/lib/errors';
import { displayUrl } from '@/lib/url';
import { formatDuration, formatNumber } from '@/lib/utils';
import type { AuditCategory } from '@prisma/client';

export const metadata: Metadata = { title: 'Audit report' };

interface PageProps {
  params: Promise<{ auditId: string }>;
}

export default async function AuditDetailPage({ params }: PageProps) {
  const { auditId } = await params;
  const session = await requireSession();

  const audit = await getAuditDetail(auditId, session.organizationId).catch((error) => {
    if (isAppError(error) && error.code === 'NOT_FOUND') notFound();
    throw error;
  });

  if (audit.status === 'FAILED') {
    return <FailedAudit url={audit.url} message={audit.errorMessage} />;
  }

  if (audit.status !== 'COMPLETED') {
    return <RunningAudit url={audit.url} />;
  }

  const warnings = Array.isArray(audit.warnings) ? (audit.warnings as string[]) : [];
  const categoryMap = Object.fromEntries(
    audit.categoryScores.map((entry) => [entry.category, entry]),
  ) as Record<string, { category: AuditCategory; score: number; summary: string | null }>;

  const uxFindings = readDimensions(audit.aiAnalysis?.uxFindings);
  const designFindings = readDimensions(audit.aiAnalysis?.designFindings);
  const contentFindings = readDimensions(audit.aiAnalysis?.contentFindings);

  return (
    <div className="space-y-8">
      {/* -- Header -------------------------------------------------------- */}
      <div className="space-y-5">
        <Button variant="ghost" size="sm" asChild className="-ml-2">
          <Link href="/dashboard/audits">
            <ArrowLeft className="size-3.5" /> All audits
          </Link>
        </Button>

        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-6">
            <ScoreRing score={audit.overallScore ?? 0} size={104} strokeWidth={8} showBand={false} />

            <div className="min-w-0 space-y-2">
              <h1 className="truncate text-2xl font-semibold tracking-[-0.025em]">
                {displayUrl(audit.url, 46)}
              </h1>

              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <Badge variant="secondary">
                  {audit.device === 'MOBILE' ? (
                    <Smartphone className="size-3" aria-hidden="true" />
                  ) : (
                    <Monitor className="size-3" aria-hidden="true" />
                  )}
                  {audit.device === 'MOBILE' ? 'Mobile' : 'Desktop'}
                </Badge>
                <span>
                  {audit.createdAt.toLocaleDateString('en-US', {
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </span>
                {audit.durationMs && <span>· took {formatDuration(audit.durationMs)}</span>}
                <TrendIndicator current={audit.overallScore} previous={audit.previousScore} />
              </div>

              <a
                href={audit.url}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 text-xs text-primary underline-offset-4 hover:underline"
              >
                Open page <ExternalLink className="size-3" aria-hidden="true" />
              </a>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <ExportReportButton auditId={audit.id} />
            <NewAuditButton websiteId={audit.websiteId} defaultUrl={audit.url}>
              Re-run audit
            </NewAuditButton>
          </div>
        </div>
      </div>

      <WarningsBanner warnings={warnings} />

      {/* -- Category scores ------------------------------------------------ */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {audit.categoryScores.map((entry) => (
          <CategoryCard
            key={entry.category}
            label={CATEGORY_LABELS[entry.category]}
            score={entry.score}
            description={entry.summary ?? CATEGORY_DESCRIPTIONS[entry.category]}
          />
        ))}
      </div>

      {/* -- Tabs ----------------------------------------------------------- */}
      <Tabs defaultValue="report">
        <div className="overflow-x-auto scrollbar-none">
          <TabsList>
            <TabsTrigger value="report">Report</TabsTrigger>
            <TabsTrigger value="fixes">Fixes ({audit.recommendations.length})</TabsTrigger>
            <TabsTrigger value="seo">SEO</TabsTrigger>
            <TabsTrigger value="performance">Performance</TabsTrigger>
            <TabsTrigger value="accessibility">Accessibility</TabsTrigger>
            <TabsTrigger value="ux">UX &amp; design</TabsTrigger>
            <TabsTrigger value="technical">Technical</TabsTrigger>
            <TabsTrigger value="issues">Issues ({audit.issues.length})</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="report" className="space-y-5">
          {audit.aiReport ? (
            <ExecutiveSummary
              summary={audit.aiReport.executiveSummary}
              strengths={audit.aiReport.strengths}
              weaknesses={audit.aiReport.weaknesses}
              longTermOutlook={audit.aiReport.longTermOutlook}
              model={audit.aiReport.model}
            />
          ) : (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                No written report was generated for this audit.
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Category profile</CardTitle>
              <CardDescription>Every category on one axis, for shape at a glance.</CardDescription>
            </CardHeader>
            <CardContent>
              <CategoryRadarChart
                categories={audit.categoryScores.map((entry) => CATEGORY_LABELS[entry.category])}
                series={[
                  {
                    name: 'This audit',
                    data: Object.fromEntries(
                      audit.categoryScores.map((entry) => [CATEGORY_LABELS[entry.category], entry.score]),
                    ),
                  },
                ]}
              />
            </CardContent>
          </Card>

          {audit.screenshots.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Screenshots</CardTitle>
                <CardDescription>How the page rendered when we captured it.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                {audit.screenshots.map((shot) => (
                  <figure key={shot.id} className="overflow-hidden rounded-xl border border-border">
                    {/* eslint-disable-next-line @next/next/no-img-element -- data: URL from our own capture; next/image cannot optimise it. */}
                    <img
                      src={shot.url}
                      alt={`${shot.kind.toLowerCase().replace('_', ' ')} screenshot of ${displayUrl(audit.url)}`}
                      width={shot.width}
                      height={shot.height}
                      className="w-full"
                      loading="lazy"
                    />
                    <figcaption className="border-t border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                      {shot.kind.toLowerCase().replace(/_/g, ' ')} · {shot.width}×{shot.height}
                    </figcaption>
                  </figure>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="fixes">
          <RecommendationList recommendations={audit.recommendations} />
        </TabsContent>

        <TabsContent value="seo" className="space-y-5">
          {audit.seoResult ? (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>On-page SEO</CardTitle>
                  <CardDescription>{categoryMap.SEO?.summary}</CardDescription>
                </CardHeader>
                <CardContent>
                  <DetailGrid
                    rows={[
                      { label: 'Title', value: audit.seoResult.title ?? '—' },
                      { label: 'Title length', value: audit.seoResult.titleLength ?? '—' },
                      { label: 'Meta description', value: audit.seoResult.metaDescription ? `${audit.seoResult.descriptionLength} chars` : 'Missing' },
                      { label: 'Canonical', value: audit.seoResult.canonicalUrl ? 'Present' : 'Missing' },
                      { label: 'Indexable', value: <BooleanValue value={audit.seoResult.indexable} /> },
                      { label: 'Language', value: audit.seoResult.lang ?? '—' },
                      { label: 'H1 / H2 / H3', value: `${audit.seoResult.h1Count} / ${audit.seoResult.h2Count} / ${audit.seoResult.h3Count}` },
                      { label: 'Word count', value: formatNumber(audit.seoResult.wordCount) },
                      { label: 'Images missing alt', value: `${audit.seoResult.imagesMissingAlt} of ${audit.seoResult.imageCount}` },
                      { label: 'Open Graph', value: <BooleanValue value={audit.seoResult.hasOpenGraph} /> },
                      { label: 'Twitter Card', value: <BooleanValue value={audit.seoResult.hasTwitterCard} /> },
                      { label: 'Structured data', value: audit.seoResult.structuredDataTypes.join(', ') || 'None' },
                      { label: 'robots.txt', value: <BooleanValue value={audit.seoResult.hasRobotsTxt} /> },
                      { label: 'XML sitemap', value: <BooleanValue value={audit.seoResult.hasSitemap} /> },
                      { label: 'Internal links', value: formatNumber(audit.seoResult.internalLinkCount) },
                      { label: 'External links', value: formatNumber(audit.seoResult.externalLinkCount) },
                    ]}
                  />
                </CardContent>
              </Card>

              <KeywordPanel keywords={audit.seoResult.keywordDensity} />
              <HeadingOutlinePanel outline={audit.seoResult.headingOutline} />
            </>
          ) : (
            <EmptyPanel label="SEO" />
          )}
        </TabsContent>

        <TabsContent value="performance" className="space-y-5">
          {audit.performanceResult ? (
            <>
              <WebVitals
                source={audit.performanceResult.source}
                metrics={{
                  firstContentfulPaint: audit.performanceResult.firstContentfulPaint,
                  largestContentfulPaint: audit.performanceResult.largestContentfulPaint,
                  cumulativeLayoutShift: audit.performanceResult.cumulativeLayoutShift,
                  totalBlockingTime: audit.performanceResult.totalBlockingTime,
                  speedIndex: audit.performanceResult.speedIndex,
                  timeToInteractive: audit.performanceResult.timeToInteractive,
                }}
              />

              <div className="grid gap-5 lg:grid-cols-2">
                <PageWeightPanel
                  totalBytes={audit.performanceResult.totalBytes}
                  imageBytes={audit.performanceResult.imageBytes}
                  scriptBytes={audit.performanceResult.scriptBytes}
                  styleBytes={audit.performanceResult.styleBytes}
                  fontBytes={audit.performanceResult.fontBytes}
                  documentBytes={audit.performanceResult.documentBytes}
                  requestCount={audit.performanceResult.requestCount}
                />

                <Card>
                  <CardHeader>
                    <CardTitle>Delivery</CardTitle>
                    <CardDescription>How efficiently the page is served.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <DetailGrid
                      rows={[
                        { label: 'Text compression', value: <BooleanValue value={audit.performanceResult.usesCompression} trueLabel="Enabled" falseLabel="Off" /> },
                        { label: 'Long cache lifetimes', value: <BooleanValue value={audit.performanceResult.usesTextCaching} trueLabel="Yes" falseLabel="No" /> },
                        { label: 'Modern image formats', value: <BooleanValue value={audit.performanceResult.usesModernImages} /> },
                        { label: 'Server response', value: audit.performanceResult.serverResponseTime ? `${Math.round(audit.performanceResult.serverResponseTime)} ms` : '—' },
                      ]}
                    />
                  </CardContent>
                </Card>
              </div>

              <OpportunityList
                opportunities={
                  Array.isArray(audit.performanceResult.opportunities)
                    ? (audit.performanceResult.opportunities as Array<{
                        id: string;
                        title: string;
                        description: string;
                        savingsMs?: number;
                        savingsBytes?: number;
                      }>)
                    : []
                }
              />
            </>
          ) : (
            <EmptyPanel label="Performance" />
          )}
        </TabsContent>

        <TabsContent value="accessibility" className="space-y-5">
          {audit.accessibilityResult ? (
            <Card>
              <CardHeader>
                <CardTitle>Accessibility</CardTitle>
                <CardDescription>{categoryMap.ACCESSIBILITY?.summary}</CardDescription>
              </CardHeader>
              <CardContent>
                <DetailGrid
                  rows={[
                    { label: 'Violations', value: audit.accessibilityResult.violationCount },
                    { label: 'Checks passed', value: audit.accessibilityResult.passCount },
                    { label: 'Critical', value: audit.accessibilityResult.criticalCount },
                    { label: 'Serious', value: audit.accessibilityResult.seriousCount },
                    { label: 'Moderate', value: audit.accessibilityResult.moderateCount },
                    { label: 'Minor', value: audit.accessibilityResult.minorCount },
                    { label: 'Contrast failures', value: audit.accessibilityResult.contrastIssues },
                    { label: 'Images missing alt', value: audit.accessibilityResult.missingAltText },
                    { label: 'Unlabelled form fields', value: audit.accessibilityResult.missingFormLabels },
                    { label: 'Unnamed controls', value: audit.accessibilityResult.missingAriaLabels },
                    { label: 'Heading order problems', value: audit.accessibilityResult.headingOrderIssues },
                    { label: 'Keyboard-unreachable elements', value: audit.accessibilityResult.keyboardIssues },
                  ]}
                />

                <p className="mt-6 rounded-lg bg-muted/50 p-4 text-xs leading-relaxed text-muted-foreground">
                  Automated testing catches roughly a third of accessibility barriers. Manual keyboard
                  navigation and screen-reader testing are still needed for a genuine WCAG 2.2 AA claim.
                </p>
              </CardContent>
            </Card>
          ) : (
            <EmptyPanel label="Accessibility" />
          )}
        </TabsContent>

        <TabsContent value="ux" className="space-y-5">
          {audit.aiAnalysis ? (
            <>
              <DimensionBreakdown
                title="User experience"
                description="How easily a visitor can understand and act on this page."
                dimensions={uxFindings}
              />
              <DimensionBreakdown
                title="Visual design"
                description="Craft, consistency and how modern the page feels."
                dimensions={designFindings}
              />
              <DimensionBreakdown
                title="Content"
                description="Clarity, persuasiveness and messaging hierarchy."
                dimensions={contentFindings}
              />
            </>
          ) : (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                AI analysis was not run for this audit.
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="technical" className="space-y-5">
          {audit.technicalResult ? (
            <>
              <div className="grid gap-5 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>Security &amp; transport</CardTitle>
                    <CardDescription>{categoryMap.SECURITY?.summary}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <DetailGrid
                      rows={[
                        { label: 'HTTPS', value: <BooleanValue value={audit.technicalResult.httpsEnabled} /> },
                        { label: 'HSTS', value: <BooleanValue value={audit.technicalResult.hstsEnabled} /> },
                        { label: 'Content-Security-Policy', value: <BooleanValue value={audit.technicalResult.cspEnabled} /> },
                        { label: 'X-Frame-Options', value: <BooleanValue value={audit.technicalResult.xFrameOptions} /> },
                        { label: 'X-Content-Type-Options', value: <BooleanValue value={audit.technicalResult.xContentTypeOptions} /> },
                        { label: 'Referrer-Policy', value: <BooleanValue value={audit.technicalResult.referrerPolicy} /> },
                        { label: 'Permissions-Policy', value: <BooleanValue value={audit.technicalResult.permissionsPolicy} /> },
                        { label: 'Security score', value: `${audit.technicalResult.securityScore}/100` },
                      ]}
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Crawl &amp; assets</CardTitle>
                    <CardDescription>{categoryMap.TECHNICAL?.summary}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <DetailGrid
                      rows={[
                        { label: 'Status code', value: audit.technicalResult.statusCode ?? '—' },
                        { label: 'Redirects', value: audit.technicalResult.redirectCount },
                        { label: 'Canonical present', value: <BooleanValue value={audit.technicalResult.hasCanonical} /> },
                        { label: 'Total links', value: formatNumber(audit.technicalResult.totalLinks) },
                        { label: 'Broken links', value: audit.technicalResult.brokenLinks },
                        { label: 'Scripts', value: audit.technicalResult.scriptCount },
                        { label: 'Stylesheets', value: audit.technicalResult.stylesheetCount },
                        { label: 'Render-blocking', value: audit.technicalResult.renderBlockingCount },
                      ]}
                    />

                    {audit.technicalResult.detectedTech.length > 0 && (
                      <div className="mt-6">
                        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                          Detected stack
                        </p>
                        <div className="mt-2.5 flex flex-wrap gap-1.5">
                          {audit.technicalResult.detectedTech.map((tech) => (
                            <Badge key={tech} variant="secondary">
                              {tech}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              <BrokenLinksPanel links={audit.links} />
            </>
          ) : (
            <EmptyPanel label="Technical" />
          )}
        </TabsContent>

        <TabsContent value="issues">
          <IssueList issues={audit.issues} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/**
 * Narrows a JSONB column to the dimension map the UI renders.
 *
 * The column is written by the AI pass after Zod validation, but the database
 * type is `JsonValue` and an older row could hold a different shape. Entries
 * that don't match are dropped rather than crashing the page.
 */
function readDimensions(value: unknown): Record<string, DimensionEntry> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const out: Record<string, DimensionEntry> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!entry || typeof entry !== 'object') continue;
    const candidate = entry as Partial<DimensionEntry>;
    if (
      typeof candidate.score === 'number' &&
      typeof candidate.verdict === 'string' &&
      typeof candidate.notes === 'string'
    ) {
      out[key] = { score: candidate.score, verdict: candidate.verdict, notes: candidate.notes };
    }
  }
  return out;
}

function EmptyPanel({ label }: { label: string }) {
  return (
    <Card>
      <CardContent className="py-12 text-center text-sm text-muted-foreground">
        {label} results are not available for this audit.
      </CardContent>
    </Card>
  );
}

function KeywordPanel({ keywords }: { keywords: unknown }) {
  const entries = Array.isArray(keywords)
    ? (keywords as Array<{ term: string; count: number; density: number }>)
    : [];
  if (entries.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Keyword density</CardTitle>
        <CardDescription>The terms this page actually emphasises, common words excluded.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2">
          {entries.map((entry) => (
            <span
              key={entry.term}
              className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-sm"
            >
              {entry.term}
              <span className="text-xs tabular-nums text-muted-foreground">
                {entry.count}× · {entry.density.toFixed(1)}%
              </span>
            </span>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function HeadingOutlinePanel({ outline }: { outline: unknown }) {
  const entries = Array.isArray(outline) ? (outline as Array<{ level: number; text: string }>) : [];
  if (entries.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Heading outline</CardTitle>
        <CardDescription>The document structure a search engine and a screen reader see.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-1.5">
          {entries.map((entry, index) => (
            <li
              key={index}
              className="flex items-baseline gap-2.5 text-sm"
              style={{ paddingLeft: `${(entry.level - 1) * 1.25}rem` }}
            >
              <Badge variant="muted" className="shrink-0 font-mono text-[0.625rem]">
                H{entry.level}
              </Badge>
              <span className="text-muted-foreground">{entry.text}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function FailedAudit({ url, message }: { url: string; message: string | null }) {
  return (
    <div className="mx-auto max-w-lg py-20 text-center">
      <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
        <AlertCircle className="size-6" aria-hidden="true" />
      </div>
      <h1 className="mt-5 text-xl font-semibold">This audit didn&apos;t complete</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        We couldn&apos;t finish analysing {displayUrl(url)}.
      </p>
      {message && (
        <p className="mt-4 rounded-lg bg-muted p-3 text-left font-mono text-xs text-muted-foreground">
          {message}
        </p>
      )}
      <div className="mt-7 flex justify-center gap-2">
        <NewAuditButton defaultUrl={url}>Try again</NewAuditButton>
        <Button variant="outline" asChild>
          <Link href="/dashboard/audits">Back to audits</Link>
        </Button>
      </div>
    </div>
  );
}

function RunningAudit({ url }: { url: string }) {
  return (
    <div className="mx-auto max-w-lg py-20 text-center">
      <span className="relative mx-auto flex size-4">
        <span className="animate-pulse-ring absolute inline-flex size-full rounded-full bg-primary" />
        <span className="relative inline-flex size-4 rounded-full bg-primary" />
      </span>
      <h1 className="mt-6 text-xl font-semibold">Audit in progress</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        We&apos;re still analysing {displayUrl(url)}. Refresh in a moment.
      </p>
    </div>
  );
}
