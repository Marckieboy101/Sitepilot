import { BAND_COLORS, CATEGORY_LABELS, scoreBand } from '@/config/scoring';
import { displayUrl } from '@/lib/url';
import { formatEstimate, formatMs } from '@/lib/utils';
import type { AuditCategory, Difficulty, Priority, Severity } from '@prisma/client';

/**
 * Standalone HTML for the exported report.
 *
 * Built as a self-contained string rather than by reusing the dashboard React
 * tree, for one decisive reason: the PDF is produced by loading this document
 * in a headless browser, and that browser has no session. Rendering the app
 * route would mean either shipping it credentials or opening an unauthenticated
 * hole — whereas `setContent` with a fully-inlined document needs neither.
 *
 * Everything is inline: no external CSS, no web fonts, no remote images.
 * A print stylesheet with explicit page breaks keeps sections from splitting
 * across pages.
 */

export interface ReportBranding {
  organizationName: string;
  /** Agency plan: replaces Momo's mark and accent. */
  logoUrl: string | null;
  brandColor: string | null;
  footerText: string | null;
  whiteLabel: boolean;
}

export interface ReportData {
  url: string;
  auditedAt: Date;
  device: string;
  overallScore: number;
  previousScore: number | null;
  categories: Array<{ category: AuditCategory; score: number; summary: string | null }>;
  executiveSummary: string | null;
  strengths: string[];
  weaknesses: string[];
  longTermOutlook: string | null;
  recommendations: Array<{
    title: string;
    category: AuditCategory;
    priority: Priority;
    difficulty: Difficulty;
    estimatedMinutes: number;
    explanation: string;
    expectedImpact: string;
    kind: string;
  }>;
  issues: Array<{ category: AuditCategory; severity: Severity; title: string; description: string }>;
  metrics: {
    firstContentfulPaint: number | null;
    largestContentfulPaint: number | null;
    cumulativeLayoutShift: number | null;
    totalBlockingTime: number | null;
    speedIndex: number | null;
  } | null;
  screenshots: Array<{ url: string; width: number; height: number; kind: string }>;
}

/** HTML-escapes untrusted text. Every interpolation of audit-derived content
 *  goes through this — page titles and headings come from the audited site. */
function esc(value: string | null | undefined): string {
  if (value == null) return '';
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const PRIORITY_COLOR: Record<Priority, string> = {
  HIGH: '#f43f5e',
  MEDIUM: '#f59e0b',
  LOW: '#64748b',
};

const SEVERITY_COLOR: Record<Severity, string> = {
  CRITICAL: '#e11d48',
  HIGH: '#f43f5e',
  MEDIUM: '#f59e0b',
  LOW: '#0ea5e9',
  INFO: '#64748b',
};

/** Donut gauge as raw SVG — no chart library available inside the document. */
function scoreGauge(score: number, size = 120, accent?: string): string {
  const radius = (size - 12) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - score / 100);
  const color = accent ?? BAND_COLORS[scoreBand(score)].hex;

  return `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="Score ${score} out of 100">
      <circle cx="${size / 2}" cy="${size / 2}" r="${radius}" fill="none" stroke="#e5e7eb" stroke-width="10"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${radius}" fill="none" stroke="${color}" stroke-width="10"
        stroke-linecap="round" stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"
        transform="rotate(-90 ${size / 2} ${size / 2})"/>
      <text x="50%" y="50%" text-anchor="middle" dy="0.36em"
        font-size="${size * 0.28}" font-weight="600" fill="${color}">${score}</text>
    </svg>`;
}

function categoryBar(label: string, score: number): string {
  const color = BAND_COLORS[scoreBand(score)].hex;
  return `
    <div class="bar-row">
      <span class="bar-label">${esc(label)}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${score}%;background:${color}"></span></span>
      <span class="bar-value" style="color:${color}">${score}</span>
    </div>`;
}

export function renderReportHtml(data: ReportData, branding: ReportBranding): string {
  const accent = branding.whiteLabel && branding.brandColor ? branding.brandColor : '#6366f1';
  const productName = branding.whiteLabel ? branding.organizationName : 'Momo';

  const auditedAt = data.auditedAt.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const delta =
    data.previousScore == null
      ? ''
      : `<span class="delta ${data.overallScore >= data.previousScore ? 'up' : 'down'}">
           ${data.overallScore >= data.previousScore ? '▲' : '▼'} ${Math.abs(data.overallScore - data.previousScore)} vs. last audit
         </span>`;

  const quickWins = data.recommendations.filter((item) => item.kind === 'QUICK_WIN');
  const byPriority = (priority: Priority) => data.recommendations.filter((item) => item.priority === priority);

  const recommendationCard = (
    item: ReportData['recommendations'][number],
    index: number,
  ) => `
    <div class="rec">
      <div class="rec-head">
        <span class="rec-index">${index}</span>
        <h4>${esc(item.title)}</h4>
      </div>
      <div class="tags">
        <span class="tag" style="background:${PRIORITY_COLOR[item.priority]}1a;color:${PRIORITY_COLOR[item.priority]}">${item.priority}</span>
        <span class="tag tag-muted">${esc(CATEGORY_LABELS[item.category])}</span>
        <span class="tag tag-muted">${item.difficulty}</span>
        <span class="tag tag-muted">${esc(formatEstimate(item.estimatedMinutes))}</span>
      </div>
      <p class="rec-label">What to do</p>
      <p>${esc(item.explanation)}</p>
      <p class="rec-label">Expected impact</p>
      <p>${esc(item.expectedImpact)}</p>
    </div>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Website audit — ${esc(displayUrl(data.url, 60))}</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }

  *, *::before, *::after { box-sizing: border-box; }

  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif;
    color: #111827;
    font-size: 10.5pt;
    line-height: 1.6;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  h1, h2, h3, h4 { margin: 0; letter-spacing: -0.02em; }
  p { margin: 0 0 8px; }

  .cover {
    background: linear-gradient(135deg, ${accent}14, ${accent}05);
    border: 1px solid ${accent}33;
    border-radius: 16px;
    padding: 32px;
    margin-bottom: 28px;
  }
  .brand { display: flex; align-items: center; gap: 10px; margin-bottom: 24px; }
  .brand img { height: 28px; }
  .brand-name { font-weight: 600; font-size: 13pt; }
  .cover h1 { font-size: 22pt; margin-bottom: 6px; }
  .cover .url { color: #4b5563; font-family: ui-monospace, monospace; font-size: 10pt; }
  .cover-grid { display: flex; align-items: center; gap: 32px; margin-top: 24px; }
  .meta { color: #6b7280; font-size: 9.5pt; margin-top: 10px; }

  .delta { font-size: 9.5pt; font-weight: 600; margin-left: 8px; }
  .delta.up { color: #059669; }
  .delta.down { color: #e11d48; }

  section { margin-bottom: 26px; page-break-inside: avoid; }
  section > h2 {
    font-size: 14pt;
    padding-bottom: 8px;
    margin-bottom: 14px;
    border-bottom: 2px solid ${accent}33;
  }

  .bar-row { display: flex; align-items: center; gap: 12px; margin-bottom: 9px; }
  .bar-label { width: 110px; font-size: 9.5pt; color: #4b5563; }
  .bar-track { flex: 1; height: 7px; background: #f1f5f9; border-radius: 999px; overflow: hidden; }
  .bar-fill { display: block; height: 100%; border-radius: 999px; }
  .bar-value { width: 28px; text-align: right; font-weight: 600; font-size: 9.5pt; }

  .summary p { margin-bottom: 11px; }

  .two-col { display: flex; gap: 24px; }
  .two-col > div { flex: 1; }
  ul { margin: 0; padding-left: 16px; }
  li { margin-bottom: 6px; }

  .rec {
    border: 1px solid #e5e7eb;
    border-radius: 10px;
    padding: 14px 16px;
    margin-bottom: 10px;
    page-break-inside: avoid;
  }
  .rec-head { display: flex; align-items: baseline; gap: 10px; }
  .rec-index {
    color: ${accent};
    font-weight: 700;
    font-size: 11pt;
    min-width: 20px;
  }
  .rec h4 { font-size: 11pt; }
  .rec-label {
    font-size: 7.5pt;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #9ca3af;
    margin: 10px 0 2px;
  }
  .rec p { font-size: 9.5pt; color: #374151; }

  .tags { display: flex; flex-wrap: wrap; gap: 5px; margin: 8px 0 2px; }
  .tag {
    font-size: 7.5pt;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 999px;
    letter-spacing: 0.02em;
  }
  .tag-muted { background: #f1f5f9; color: #64748b; }

  table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
  th {
    text-align: left;
    font-size: 8pt;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #9ca3af;
    padding-bottom: 6px;
    border-bottom: 1px solid #e5e7eb;
  }
  td { padding: 8px 0; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
  td:first-child { width: 74px; }
  .sev { font-weight: 600; font-size: 8.5pt; }

  .metrics { display: flex; flex-wrap: wrap; gap: 10px; }
  .metric {
    flex: 1 1 30%;
    border: 1px solid #e5e7eb;
    border-radius: 10px;
    padding: 12px;
  }
  .metric-label { font-size: 8pt; color: #6b7280; text-transform: uppercase; letter-spacing: 0.06em; }
  .metric-value { font-size: 14pt; font-weight: 600; margin-top: 4px; }

  .shots { display: flex; gap: 12px; }
  .shots figure { flex: 1; margin: 0; border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden; }
  .shots img { width: 100%; display: block; }
  .shots figcaption { font-size: 8pt; color: #6b7280; padding: 6px 8px; background: #f9fafb; }

  footer {
    margin-top: 32px;
    padding-top: 14px;
    border-top: 1px solid #e5e7eb;
    font-size: 8.5pt;
    color: #9ca3af;
    display: flex;
    justify-content: space-between;
  }

  .page-break { page-break-before: always; }
</style>
</head>
<body>

<div class="cover">
  <div class="brand">
    ${branding.logoUrl ? `<img src="${esc(branding.logoUrl)}" alt="">` : ''}
    <span class="brand-name">${esc(productName)}</span>
  </div>

  <h1>Website audit report</h1>
  <p class="url">${esc(data.url)}</p>

  <div class="cover-grid">
    ${scoreGauge(data.overallScore, 128, branding.whiteLabel && branding.brandColor ? branding.brandColor : undefined)}
    <div style="flex:1">
      ${data.categories.map((entry) => categoryBar(CATEGORY_LABELS[entry.category], entry.score)).join('')}
    </div>
  </div>

  <p class="meta">
    Audited ${esc(auditedAt)} · ${esc(data.device.toLowerCase())} · ${data.recommendations.length} recommendations · ${data.issues.length} issues
    ${delta}
  </p>
</div>

${
  data.executiveSummary
    ? `<section class="summary">
        <h2>Executive summary</h2>
        ${data.executiveSummary
          .split(/\n{2,}/)
          .map((paragraph) => `<p>${esc(paragraph)}</p>`)
          .join('')}
      </section>`
    : ''
}

${
  data.strengths.length > 0 || data.weaknesses.length > 0
    ? `<section>
        <h2>Strengths and weaknesses</h2>
        <div class="two-col">
          <div>
            <h3 style="font-size:10.5pt;margin-bottom:8px;color:#059669">What's working</h3>
            <ul>${data.strengths.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>
          </div>
          <div>
            <h3 style="font-size:10.5pt;margin-bottom:8px;color:#e11d48">What's holding you back</h3>
            <ul>${data.weaknesses.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>
          </div>
        </div>
      </section>`
    : ''
}

${
  data.metrics
    ? `<section>
        <h2>Core Web Vitals</h2>
        <div class="metrics">
          ${[
            ['Largest Contentful Paint', formatMs(data.metrics.largestContentfulPaint)],
            ['First Contentful Paint', formatMs(data.metrics.firstContentfulPaint)],
            ['Cumulative Layout Shift', data.metrics.cumulativeLayoutShift?.toFixed(3) ?? '—'],
            ['Total Blocking Time', formatMs(data.metrics.totalBlockingTime)],
            ['Speed Index', formatMs(data.metrics.speedIndex)],
          ]
            .map(
              ([label, value]) =>
                `<div class="metric"><div class="metric-label">${esc(label)}</div><div class="metric-value">${esc(value)}</div></div>`,
            )
            .join('')}
        </div>
      </section>`
    : ''
}

${
  data.screenshots.length > 0
    ? `<section>
        <h2>How the page looks</h2>
        <div class="shots">
          ${data.screenshots
            .slice(0, 2)
            .map(
              (shot) =>
                `<figure><img src="${esc(shot.url)}" alt=""><figcaption>${esc(shot.kind.toLowerCase().replace(/_/g, ' '))}</figcaption></figure>`,
            )
            .join('')}
        </div>
      </section>`
    : ''
}

<div class="page-break"></div>

${
  quickWins.length > 0
    ? `<section>
        <h2>Quick wins</h2>
        <p style="color:#6b7280;font-size:9.5pt;margin-bottom:12px">
          High impact, low effort. Each of these takes under two hours.
        </p>
        ${quickWins.map((item, index) => recommendationCard(item, index + 1)).join('')}
      </section>`
    : ''
}

${(['HIGH', 'MEDIUM', 'LOW'] as Priority[])
  .map((priority) => {
    const items = byPriority(priority).filter((item) => item.kind !== 'QUICK_WIN');
    if (items.length === 0) return '';
    const label = priority === 'HIGH' ? 'High priority' : priority === 'MEDIUM' ? 'Medium priority' : 'Lower priority';
    return `<section>
      <h2>${label}</h2>
      ${items.map((item, index) => recommendationCard(item, index + 1)).join('')}
    </section>`;
  })
  .join('')}

${
  data.issues.length > 0
    ? `<section>
        <h2>All issues found</h2>
        <table>
          <thead><tr><th>Severity</th><th>Category</th><th>Issue</th></tr></thead>
          <tbody>
            ${data.issues
              .slice(0, 60)
              .map(
                (issue) => `<tr>
                  <td><span class="sev" style="color:${SEVERITY_COLOR[issue.severity]}">${issue.severity}</span></td>
                  <td>${esc(CATEGORY_LABELS[issue.category])}</td>
                  <td><strong>${esc(issue.title)}</strong><br><span style="color:#6b7280">${esc(issue.description)}</span></td>
                </tr>`,
              )
              .join('')}
          </tbody>
        </table>
      </section>`
    : ''
}

<footer>
  <span>${esc(branding.footerText ?? `${productName} · Website audit report`)}</span>
  <span>${esc(displayUrl(data.url, 40))} · ${esc(auditedAt)}</span>
</footer>

</body>
</html>`;
}
