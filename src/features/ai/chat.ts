import { AuditStatus, ChatRole } from '@prisma/client';

import { CATEGORY_LABELS } from '@/config/scoring';
import { db } from '@/lib/db';
import { errors } from '@/lib/errors';
import { formatBytes, formatMs, truncate } from '@/lib/utils';

import { buildChatContext, CHAT_SYSTEM_PROMPT } from './prompts';

/**
 * Chat grounding.
 *
 * The assistant's usefulness comes entirely from the context assembled here:
 * it is answering about one specific audit, not about websites in general.
 * The context is rebuilt on every request rather than cached on the session,
 * so re-running an audit immediately updates what the assistant knows.
 *
 * Size is bounded deliberately — issues and recommendations are capped and the
 * page excerpt truncated — because an unbounded context on a content-heavy
 * site would cost more per message than the plan charges per month.
 */

const MAX_HISTORY_MESSAGES = 20;
const CONTENT_EXCERPT_CHARS = 2500;

export interface GroundedChat {
  systemPrompt: string;
  auditId: string;
  auditUrl: string;
}

/** Builds the system prompt for a chat grounded in a specific audit. */
export async function buildGroundedPrompt(
  auditId: string,
  organizationId: string,
): Promise<GroundedChat> {
  const audit = await db.audit.findFirst({
    where: {
      id: auditId,
      status: AuditStatus.COMPLETED,
      website: { project: { organizationId } },
    },
    select: {
      id: true,
      url: true,
      createdAt: true,
      overallScore: true,
      categoryScores: { select: { category: true, score: true } },
      issues: {
        orderBy: { severity: 'asc' },
        take: 25,
        select: { severity: true, category: true, title: true },
      },
      recommendations: {
        orderBy: [{ priority: 'asc' }, { sortOrder: 'asc' }],
        take: 15,
        select: { priority: true, title: true, expectedImpact: true },
      },
      aiReport: { select: { executiveSummary: true } },
      seoResult: {
        select: {
          title: true,
          metaDescription: true,
          h1Count: true,
          wordCount: true,
          imageCount: true,
          imagesMissingAlt: true,
          structuredDataTypes: true,
          headingOutline: true,
        },
      },
      performanceResult: {
        select: {
          largestContentfulPaint: true,
          firstContentfulPaint: true,
          cumulativeLayoutShift: true,
          totalBlockingTime: true,
          totalBytes: true,
        },
      },
    },
  });

  if (!audit) throw errors.notFound('Audit');

  const seo = audit.seoResult;
  const perf = audit.performanceResult;

  const headings = Array.isArray(seo?.headingOutline)
    ? (seo.headingOutline as Array<{ level: number; text: string }>)
        .map((entry) => `H${entry.level}: ${entry.text}`)
        .join('\n')
    : '';

  const systemPrompt = `${CHAT_SYSTEM_PROMPT}

${buildChatContext({
  url: audit.url,
  auditedAt: audit.createdAt.toISOString().slice(0, 10),
  overallScore: audit.overallScore ?? 0,
  categoryScores: audit.categoryScores.map((entry) => ({
    category: CATEGORY_LABELS[entry.category],
    score: entry.score,
  })),
  issues: audit.issues.map((issue) => ({
    severity: issue.severity,
    category: CATEGORY_LABELS[issue.category],
    title: issue.title,
  })),
  recommendations: audit.recommendations,
  executiveSummary: audit.aiReport?.executiveSummary ?? null,
  seoFacts: seo
    ? `title "${seo.title ?? 'none'}", meta description ${seo.metaDescription ? `"${truncate(seo.metaDescription, 120)}"` : 'missing'}, ${seo.h1Count} H1, ${seo.wordCount} words, ${seo.imagesMissingAlt}/${seo.imageCount} images missing alt, structured data: ${seo.structuredDataTypes.join(', ') || 'none'}`
    : 'not measured',
  performanceFacts: perf
    ? `LCP ${formatMs(perf.largestContentfulPaint)}, FCP ${formatMs(perf.firstContentfulPaint)}, CLS ${perf.cumulativeLayoutShift ?? 'n/a'}, TBT ${formatMs(perf.totalBlockingTime)}, page weight ${formatBytes(perf.totalBytes)}`
    : 'not measured',
  contentExcerpt: truncate(headings, CONTENT_EXCERPT_CHARS) || '(no heading outline captured)',
})}`;

  return { systemPrompt, auditId: audit.id, auditUrl: audit.url };
}

/** Finds or creates the chat session for an audit. */
export async function resolveChatSession(input: {
  userId: string;
  auditId: string | null;
  sessionId?: string;
}): Promise<{ id: string; auditId: string | null }> {
  if (input.sessionId) {
    const existing = await db.chatSession.findFirst({
      where: { id: input.sessionId, userId: input.userId },
      select: { id: true, auditId: true },
    });
    if (existing) return existing;
  }

  const created = await db.chatSession.create({
    data: { userId: input.userId, auditId: input.auditId },
    select: { id: true, auditId: true },
  });

  return created;
}

export async function loadHistory(
  sessionId: string,
): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
  const messages = await db.chatMessage.findMany({
    where: { sessionId, role: { in: [ChatRole.USER, ChatRole.ASSISTANT] } },
    orderBy: { createdAt: 'desc' },
    take: MAX_HISTORY_MESSAGES,
    select: { role: true, content: true },
  });

  // Fetched newest-first so the cap keeps recent turns, then reversed back
  // into chronological order for the model.
  return messages
    .reverse()
    .map((message) => ({
      role: message.role === ChatRole.USER ? ('user' as const) : ('assistant' as const),
      content: message.content,
    }));
}

export async function appendMessage(input: {
  sessionId: string;
  role: 'USER' | 'ASSISTANT';
  content: string;
}): Promise<void> {
  await db.$transaction([
    db.chatMessage.create({
      data: {
        sessionId: input.sessionId,
        role: input.role === 'USER' ? ChatRole.USER : ChatRole.ASSISTANT,
        content: input.content,
      },
    }),
    // Bump the session so the sidebar orders by real activity.
    db.chatSession.update({
      where: { id: input.sessionId },
      data: { updatedAt: new Date() },
    }),
  ]);
}

/** Titles a session from its first user message, once. */
export async function ensureSessionTitle(sessionId: string, firstMessage: string): Promise<void> {
  const session = await db.chatSession.findUnique({
    where: { id: sessionId },
    select: { title: true },
  });

  if (session?.title) return;

  await db.chatSession.update({
    where: { id: sessionId },
    data: { title: truncate(firstMessage.replace(/\s+/g, ' ').trim(), 60) },
  });
}

export const SUGGESTED_QUESTIONS = [
  'What should I fix first, and why?',
  'Why is my SEO score low?',
  'Rewrite my page title and meta description.',
  'How can I make this page convert better?',
  'Explain my Core Web Vitals in plain English.',
  'Write me three stronger call-to-action buttons.',
] as const;
