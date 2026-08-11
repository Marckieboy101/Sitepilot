import { z } from 'zod';

/**
 * Schemas for every structured AI response.
 *
 * These do double duty: they validate what comes back, and their shape is
 * rendered into the prompt as the contract the model must follow. Keeping the
 * two derived from one definition is what stops the prompt and the parser from
 * drifting apart.
 */

const score = z.number().min(0).max(100).transform((value) => Math.round(value));

/** One judged dimension — a score, a one-line verdict, and the reasoning. */
export const dimensionSchema = z.object({
  score,
  verdict: z.string().min(1).max(200),
  notes: z.string().min(1).max(1200),
});

export type Dimension = z.infer<typeof dimensionSchema>;

export const uxAnalysisSchema = z.object({
  score,
  navigation: dimensionSchema,
  callToActions: dimensionSchema,
  visualHierarchy: dimensionSchema,
  readability: dimensionSchema,
  layout: dimensionSchema,
  mobileExperience: dimensionSchema,
  forms: dimensionSchema,
  userFlow: dimensionSchema,
  conversionOpportunities: z.array(z.string().max(400)).max(8),
});

export const designAnalysisSchema = z.object({
  score,
  colorPalette: dimensionSchema,
  typography: dimensionSchema,
  consistency: dimensionSchema,
  whiteSpace: dimensionSchema,
  modernity: dimensionSchema,
  branding: dimensionSchema,
  visualBalance: dimensionSchema,
  trustAndProfessionalism: dimensionSchema,
  improvements: z.array(z.string().max(400)).max(8),
});

export const contentAnalysisSchema = z.object({
  score,
  clarity: dimensionSchema,
  persuasiveness: dimensionSchema,
  toneAndVoice: dimensionSchema,
  messagingHierarchy: dimensionSchema,
  improvements: z.array(z.string().max(400)).max(8),
});

export type UxAnalysis = z.infer<typeof uxAnalysisSchema>;
export type DesignAnalysis = z.infer<typeof designAnalysisSchema>;
export type ContentAnalysis = z.infer<typeof contentAnalysisSchema>;

/** The combined single-call analysis, which is what the engine actually runs. */
export const combinedAnalysisSchema = z.object({
  ux: uxAnalysisSchema,
  design: designAnalysisSchema,
  content: contentAnalysisSchema,
});

export type CombinedAnalysis = z.infer<typeof combinedAnalysisSchema>;

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export const aiRecommendationSchema = z.object({
  title: z.string().min(1).max(140),
  category: z.enum(['SEO', 'PERFORMANCE', 'ACCESSIBILITY', 'UX', 'DESIGN', 'CONTENT', 'SECURITY', 'TECHNICAL']),
  priority: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']),
  estimatedMinutes: z.number().int().min(5).max(4800),
  explanation: z.string().min(1).max(1500),
  expectedImpact: z.string().min(1).max(800),
  kind: z.enum(['QUICK_WIN', 'LONG_TERM']),
});

export type AiRecommendation = z.infer<typeof aiRecommendationSchema>;

export const aiReportSchema = z.object({
  executiveSummary: z.string().min(50).max(3000),
  strengths: z.array(z.string().max(400)).min(1).max(8),
  weaknesses: z.array(z.string().max(400)).min(1).max(8),
  longTermOutlook: z.string().max(2000),
  recommendations: z.array(aiRecommendationSchema).min(1).max(14),
});

export type AiReportPayload = z.infer<typeof aiReportSchema>;

// ---------------------------------------------------------------------------
// Competitor comparison
// ---------------------------------------------------------------------------

export const comparisonSummarySchema = z.object({
  summary: z.string().min(50).max(2500),
  yourAdvantages: z.array(z.string().max(300)).max(6),
  theirAdvantages: z.array(z.string().max(300)).max(6),
  priorityActions: z.array(z.string().max(300)).max(6),
});

export type ComparisonSummary = z.infer<typeof comparisonSummarySchema>;
