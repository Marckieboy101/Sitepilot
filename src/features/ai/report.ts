import { AuditCategory, Difficulty, Priority, Severity } from '@prisma/client';

import { CATEGORY_LABELS, impactScore } from '@/config/scoring';
import { logger } from '@/lib/logger';
import { truncate } from '@/lib/utils';

import type { AnalyzerIssue, AnalyzerRecommendation, CategoryResult } from '../audit/types';

import { aiAvailable, completeJson, defaultModel } from './client';
import { REPORT_SYSTEM_PROMPT, buildReportPrompt, type ReportEvidence } from './prompts';
import { aiReportSchema, type AiReportPayload } from './schemas';

/**
 * Generates the human-readable report: executive summary, strengths,
 * weaknesses and a merged, ranked recommendation list.
 *
 * The AI does not replace the deterministic recommendations — it adds
 * judgement-based ones and, more importantly, it decides the narrative. The
 * two sets are merged and de-duplicated here, because the model will often
 * restate a rule-based finding in its own words and the user should see that
 * item once, not twice.
 */

const log = logger.child({ module: 'ai/report' });

const SEVERITY_RANK: Record<Severity, number> = {
  [Severity.CRITICAL]: 0,
  [Severity.HIGH]: 1,
  [Severity.MEDIUM]: 2,
  [Severity.LOW]: 3,
  [Severity.INFO]: 4,
};

const PRIORITY_RANK: Record<Priority, number> = {
  [Priority.HIGH]: 0,
  [Priority.MEDIUM]: 1,
  [Priority.LOW]: 2,
};

export interface ReportInput {
  url: string;
  overallScore: number;
  previousScore: number | null;
  categories: CategoryResult<unknown>[];
  issues: AnalyzerIssue[];
  recommendations: AnalyzerRecommendation[];
  aiFindings: string | null;
}

export interface GeneratedReport {
  executiveSummary: string;
  strengths: string[];
  weaknesses: string[];
  longTermOutlook: string | null;
  recommendations: AnalyzerRecommendation[];
  usage: { model: string; promptTokens: number; outputTokens: number; costCents: number } | null;
}

/**
 * Normalises a title for duplicate detection: lowercase, no punctuation, stop
 * words removed. "Add alt text to images" and "Add alt text for the images"
 * collapse to the same key.
 */
function dedupeKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !['the', 'and', 'for', 'your', 'this', 'add', 'all'].includes(word))
    .sort()
    .join(' ');
}

function mergeRecommendations(
  deterministic: AnalyzerRecommendation[],
  fromAi: AiReportPayload['recommendations'],
): AnalyzerRecommendation[] {
  const merged: AnalyzerRecommendation[] = [...deterministic];
  const seen = new Set(deterministic.map((recommendation) => dedupeKey(recommendation.title)));

  for (const candidate of fromAi) {
    const key = dedupeKey(candidate.title);
    if (seen.has(key)) continue;
    seen.add(key);

    const category = (AuditCategory[candidate.category as keyof typeof AuditCategory] ??
      AuditCategory.UX) as AuditCategory;
    const difficulty = Difficulty[candidate.difficulty];
    const priority = Priority[candidate.priority];

    merged.push({
      category,
      title: candidate.title,
      explanation: candidate.explanation,
      expectedImpact: candidate.expectedImpact,
      difficulty,
      estimatedMinutes: candidate.estimatedMinutes,
      priority,
      impactScore: impactScore({
        severity:
          priority === Priority.HIGH ? Severity.HIGH : priority === Priority.MEDIUM ? Severity.MEDIUM : Severity.LOW,
        difficulty,
      }),
      kind: candidate.kind,
    });
  }

  // Rank: priority bucket first, then impact-per-effort inside it. This is the
  // order the priority list and the PDF both render.
  return merged.sort((a, b) => {
    const byPriority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (byPriority !== 0) return byPriority;
    return b.impactScore - a.impactScore;
  });
}

/** Deterministic fallback report, used when AI is unavailable or fails. */
export function buildFallbackReport(input: ReportInput): GeneratedReport {
  const sorted = [...input.categories].sort((a, b) => a.score - b.score);
  const weakest = sorted.slice(0, 3);
  const strongest = [...sorted].reverse().slice(0, 3);

  const criticalCount = input.issues.filter(
    (issue) => issue.severity === Severity.CRITICAL || issue.severity === Severity.HIGH,
  ).length;

  const trend =
    input.previousScore == null
      ? ''
      : input.overallScore === input.previousScore
        ? ' The score is unchanged since the last audit.'
        : ` That is ${Math.abs(input.overallScore - input.previousScore)} points ${input.overallScore > input.previousScore ? 'better' : 'worse'} than the previous audit.`;

  const executiveSummary = [
    `${input.url} scores ${input.overallScore} out of 100 overall.${trend}`,
    criticalCount > 0
      ? `We found ${criticalCount} high-severity issue${criticalCount === 1 ? '' : 's'} that are actively costing this site traffic, conversions or both.`
      : 'No high-severity issues were found, which puts this site ahead of most.',
    `The weakest areas are ${weakest.map((category) => `${CATEGORY_LABELS[category.category]} (${category.score})`).join(', ')}. ${weakest[0]?.summary ?? ''}`,
    `The strongest are ${strongest.map((category) => `${CATEGORY_LABELS[category.category]} (${category.score})`).join(', ')}.`,
    'Work through the prioritised list below from the top — the quick wins are ordered by impact against the effort they take.',
  ].join('\n\n');

  return {
    executiveSummary,
    strengths: strongest
      .filter((category) => category.score >= 60)
      .map((category) => `${CATEGORY_LABELS[category.category]}: ${category.summary}`),
    weaknesses: weakest
      .filter((category) => category.score < 80)
      .map((category) => `${CATEGORY_LABELS[category.category]}: ${category.summary}`),
    longTermOutlook: null,
    recommendations: mergeRecommendations(input.recommendations, []),
    usage: null,
  };
}

export async function generateReport(input: ReportInput): Promise<GeneratedReport> {
  if (!aiAvailable()) return buildFallbackReport(input);

  const evidence: ReportEvidence = {
    url: input.url,
    overallScore: input.overallScore,
    previousScore: input.previousScore,
    categoryScores: input.categories.map((category) => ({
      category: CATEGORY_LABELS[category.category],
      score: category.score,
      summary: category.summary,
    })),
    // Cap the issue list: past ~30 items the marginal signal is nil and the
    // prompt grows without improving the report.
    topIssues: [...input.issues]
      .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
      .slice(0, 30)
      .map((issue) => ({
        severity: issue.severity,
        category: CATEGORY_LABELS[issue.category],
        title: issue.title,
        description: truncate(issue.description, 300),
      })),
    existingRecommendations: input.recommendations.slice(0, 20).map((recommendation) => ({
      title: recommendation.title,
      category: CATEGORY_LABELS[recommendation.category],
      priority: recommendation.priority,
      difficulty: recommendation.difficulty,
      estimatedMinutes: recommendation.estimatedMinutes,
    })),
    aiFindings: input.aiFindings ?? '(UX, design and content analysis was not available for this audit)',
  };

  try {
    const { data, usage } = await completeJson({
      schema: aiReportSchema,
      system: REPORT_SYSTEM_PROMPT,
      user: buildReportPrompt(evidence),
      model: defaultModel(),
      temperature: 0.5,
      maxTokens: 4500,
    });

    return {
      executiveSummary: data.executiveSummary,
      strengths: data.strengths,
      weaknesses: data.weaknesses,
      longTermOutlook: data.longTermOutlook || null,
      recommendations: mergeRecommendations(input.recommendations, data.recommendations),
      usage,
    };
  } catch (error) {
    // A failed report must not fail the audit — the scores and issues are
    // still worth showing, and the fallback narrative is genuinely useful.
    log.error('AI report generation failed; using deterministic fallback', { url: input.url, error });
    return buildFallbackReport(input);
  }
}
