import { AuditCategory, Difficulty, Priority, Severity } from '@prisma/client';

import { CATEGORY_WEIGHTS, impactScore } from '@/config/scoring';
import { logger } from '@/lib/logger';
import { formatBytes, formatMs, truncate, unique } from '@/lib/utils';

import type {
  AnalyzerRecommendation,
  CategoryResult,
  PageContext,
  AccessibilityDetail,
  ContentDetail,
  PerformanceDetail,
  SeoDetail,
  TechnicalDetail,
} from '../audit/types';

import { aiAvailable, completeJson, defaultModel } from './client';
import { ANALYSIS_SYSTEM_PROMPT, buildAnalysisPrompt, type AnalysisEvidence } from './prompts';
import { combinedAnalysisSchema, type CombinedAnalysis, type Dimension } from './schemas';

/**
 * The AI half of the audit: UX, design and content-quality judgement.
 *
 * All three run in one call rather than three. They share the same evidence —
 * roughly 4-6k tokens of page digest — so three calls would send it three
 * times for no benefit, tripling both cost and latency. The single call also
 * lets the model keep its assessments internally consistent (it cannot praise
 * the visual hierarchy under "design" while condemning it under "UX").
 */

const log = logger.child({ module: 'ai/analysis' });

const BODY_EXCERPT_CHARS = 6000;
const HEADING_EXCERPT_CHARS = 1500;

export interface AnalysisInput {
  context: PageContext;
  seo: CategoryResult<SeoDetail>;
  performance: CategoryResult<PerformanceDetail>;
  accessibility: CategoryResult<AccessibilityDetail>;
  technical: CategoryResult<TechnicalDetail>;
  content: CategoryResult<ContentDetail>;
}

export interface AiAnalysisResult {
  ux: CategoryResult<Record<string, Dimension>>;
  design: CategoryResult<Record<string, Dimension>>;
  content: CategoryResult<Record<string, Dimension>>;
  usage: { model: string; promptTokens: number; outputTokens: number; costCents: number };
  raw: CombinedAnalysis;
}

/** Compresses the audit into the digest the prompt is built from. */
function buildEvidence(input: AnalysisInput): AnalysisEvidence {
  const { context, seo, performance, accessibility, technical, content } = input;
  const { $, page, text, browser } = context;

  const navigationLabels = unique(
    $('nav a, header a, [role="navigation"] a')
      .toArray()
      .map((element) => $(element).text().replace(/\s+/g, ' ').trim())
      .filter((label) => label.length > 0 && label.length < 40),
  ).slice(0, 24);

  const forms = $('form').toArray();
  const formSummary =
    forms.length === 0
      ? '(no forms on the page)'
      : forms
          .slice(0, 4)
          .map((form, index) => {
            const $form = $(form);
            const fields = $form
              .find('input:not([type="hidden"]), select, textarea')
              .toArray()
              .map((field) => {
                const $field = $(field);
                return (
                  $field.attr('name') ??
                  $field.attr('placeholder') ??
                  $field.attr('aria-label') ??
                  $field.attr('type') ??
                  'field'
                );
              });
            const submit = $form.find('button, input[type="submit"]').first().text().trim();
            return `Form ${index + 1}: ${fields.length} field(s) [${fields.slice(0, 10).join(', ')}]${submit ? `, submit: "${submit}"` : ''}`;
          })
          .join('\n');

  const visual = browser?.visual;
  const visualProfile = visual
    ? [
        `Text colours in use: ${visual.colors.slice(0, 6).join(', ')}`,
        `Background colours: ${visual.backgroundColors.slice(0, 6).join(', ')}`,
        `Font families: ${visual.fontFamilies.slice(0, 4).join(', ')}`,
        `Font sizes present (px): ${visual.fontSizes.join(', ')}`,
        `Distinct border radii: ${visual.borderRadii.slice(0, 5).join(', ') || 'none — all square corners'}`,
        `Page height: ${visual.documentHeight}px at ${visual.viewportWidth}px wide`,
        `${visual.buttonCount} buttons, ${visual.formCount} forms, ${visual.imageCount} images, ${visual.headingCount} headings`,
      ].join('\n')
    : '(the page could not be rendered, so no computed visual data is available)';

  const seoDetail = seo.detail;
  const perfDetail = performance.detail;
  const a11yDetail = accessibility.detail;
  const techDetail = technical.detail;
  const contentDetail = content.detail;

  return {
    url: page.finalUrl,
    device: context.device,
    title: seoDetail.title,
    metaDescription: seoDetail.metaDescription,

    headings: truncate(
      seoDetail.headingOutline.map((entry) => `${'  '.repeat(entry.level - 1)}H${entry.level}: ${entry.text}`).join('\n'),
      HEADING_EXCERPT_CHARS,
    ),

    bodyExcerpt: truncate(text, BODY_EXCERPT_CHARS),

    ctaLabels: contentDetail.ctaLabels,
    navigationLabels,
    formSummary,
    visualProfile,

    seoSummary: `${seo.score}/100. ${seoDetail.wordCount} words, ${seoDetail.h1Count} H1 / ${seoDetail.h2Count} H2, ${seoDetail.imageCount} images (${seoDetail.imagesMissingAlt} missing alt), structured data: ${seoDetail.structuredDataTypes.join(', ') || 'none'}. ${seo.summary}`,

    performanceSummary: `${performance.score}/100 (${perfDetail.source}). LCP ${formatMs(perfDetail.largestContentfulPaint)}, FCP ${formatMs(perfDetail.firstContentfulPaint)}, CLS ${perfDetail.cumulativeLayoutShift ?? 'n/a'}, TBT ${formatMs(perfDetail.totalBlockingTime)}, page weight ${formatBytes(perfDetail.totalBytes)} over ${perfDetail.requestCount ?? '?'} requests.`,

    accessibilitySummary: `${accessibility.score}/100. ${a11yDetail.violationCount} axe violations (${a11yDetail.criticalCount} critical, ${a11yDetail.seriousCount} serious), ${a11yDetail.contrastIssues} contrast failures, ${a11yDetail.missingFormLabels} unlabelled fields.`,

    technicalSummary: `${technical.score}/100. ${techDetail.httpsEnabled ? 'HTTPS' : 'HTTP only'}, ${techDetail.totalLinks} links (${techDetail.brokenLinks} broken), ${techDetail.scriptCount} scripts, ${techDetail.renderBlockingCount} render-blocking resources. Stack: ${techDetail.detectedTech.join(', ') || 'not detected'}.`,

    contentSummary: `${content.score}/100. ${contentDetail.wordCount} words, reading ease ${contentDetail.readability ?? 'n/a'}, ${contentDetail.paragraphCount} paragraphs, CTAs: ${contentDetail.ctaLabels.join(' / ') || 'none'}. Trust signals: ${contentDetail.trustSignals.join(', ') || 'none found'}.`,
  };
}

/** Turns the model's dimension map into the category result the engine expects. */
function toCategoryResult(
  category: AuditCategory,
  score: number,
  dimensions: Record<string, Dimension>,
  suggestions: string[],
): CategoryResult<Record<string, Dimension>> {
  // The AI does not emit Issue rows — those are reserved for deterministic
  // findings that we can point at a specific element. Its output becomes
  // recommendations, where a judgement call is what the user wants.
  const recommendations: AnalyzerRecommendation[] = suggestions.map((suggestion, index) => {
    const difficulty = index < 2 ? Difficulty.EASY : Difficulty.MEDIUM;
    const severity = score < 50 ? Severity.HIGH : score < 75 ? Severity.MEDIUM : Severity.LOW;

    return {
      category,
      title: truncate(suggestion.split(/[.;]/)[0] ?? suggestion, 120),
      explanation: suggestion,
      expectedImpact: weakestDimensionImpact(dimensions, category),
      difficulty,
      estimatedMinutes: difficulty === Difficulty.EASY ? 60 : 150,
      priority: score < 50 ? Priority.HIGH : score < 75 ? Priority.MEDIUM : Priority.LOW,
      impactScore: impactScore({ severity, difficulty, categoryWeight: CATEGORY_WEIGHTS[category] }),
      kind: difficulty === Difficulty.EASY ? 'QUICK_WIN' : 'LONG_TERM',
    };
  });

  const weakest = Object.entries(dimensions).sort((a, b) => a[1].score - b[1].score)[0];

  return {
    category,
    score,
    summary: weakest ? `${weakest[1].verdict}` : `Scored ${score}/100.`,
    issues: [],
    recommendations,
    detail: dimensions,
  };
}

function weakestDimensionImpact(dimensions: Record<string, Dimension>, category: AuditCategory): string {
  const weakest = Object.entries(dimensions).sort((a, b) => a[1].score - b[1].score)[0];
  if (!weakest) return 'Improves how visitors experience this page.';
  const label = weakest[0].replace(/([A-Z])/g, ' $1').toLowerCase().trim();
  return `Addresses the weakest ${category.toLowerCase()} dimension on this page — ${label}, currently ${weakest[1].score}/100.`;
}

function dimensionsOf<T extends Record<string, unknown>>(source: T, keys: readonly string[]): Record<string, Dimension> {
  const out: Record<string, Dimension> = {};
  for (const key of keys) {
    const value = source[key];
    if (value && typeof value === 'object' && 'score' in value) out[key] = value as Dimension;
  }
  return out;
}

const UX_KEYS = [
  'navigation',
  'callToActions',
  'visualHierarchy',
  'readability',
  'layout',
  'mobileExperience',
  'forms',
  'userFlow',
] as const;

const DESIGN_KEYS = [
  'colorPalette',
  'typography',
  'consistency',
  'whiteSpace',
  'modernity',
  'branding',
  'visualBalance',
  'trustAndProfessionalism',
] as const;

const CONTENT_KEYS = ['clarity', 'persuasiveness', 'toneAndVoice', 'messagingHierarchy'] as const;

/**
 * Runs the AI analysis. Returns null when AI is not configured — the engine
 * then produces an audit with six deterministic categories instead of eight,
 * which is a degraded product but a working one.
 */
export async function runAiAnalysis(input: AnalysisInput): Promise<AiAnalysisResult | null> {
  if (!aiAvailable()) {
    log.info('AI not configured; skipping UX/design/content analysis');
    return null;
  }

  const evidence = buildEvidence(input);

  const { data, usage } = await completeJson({
    schema: combinedAnalysisSchema,
    system: ANALYSIS_SYSTEM_PROMPT,
    user: buildAnalysisPrompt(evidence),
    model: defaultModel(),
    temperature: 0.35,
    maxTokens: 4500,
  });

  return {
    ux: toCategoryResult(AuditCategory.UX, data.ux.score, dimensionsOf(data.ux, UX_KEYS), data.ux.conversionOpportunities),
    design: toCategoryResult(
      AuditCategory.DESIGN,
      data.design.score,
      dimensionsOf(data.design, DESIGN_KEYS),
      data.design.improvements,
    ),
    content: toCategoryResult(
      AuditCategory.CONTENT,
      data.content.score,
      dimensionsOf(data.content, CONTENT_KEYS),
      data.content.improvements,
    ),
    usage,
    raw: data,
  };
}

/** Flattens the AI findings into the text block the report prompt consumes. */
export function summarizeAiFindings(analysis: CombinedAnalysis): string {
  const render = (label: string, score: number, dimensions: Record<string, Dimension>, extras: string[]) =>
    [
      `${label} — ${score}/100`,
      ...Object.entries(dimensions).map(
        ([key, dimension]) => `  ${key} (${dimension.score}): ${dimension.verdict} ${dimension.notes}`,
      ),
      extras.length > 0 ? `  Suggested: ${extras.join(' | ')}` : '',
    ]
      .filter(Boolean)
      .join('\n');

  return [
    render('UX', analysis.ux.score, dimensionsOf(analysis.ux, UX_KEYS), analysis.ux.conversionOpportunities),
    render('DESIGN', analysis.design.score, dimensionsOf(analysis.design, DESIGN_KEYS), analysis.design.improvements),
    render('CONTENT', analysis.content.score, dimensionsOf(analysis.content, CONTENT_KEYS), analysis.content.improvements),
  ].join('\n\n');
}
