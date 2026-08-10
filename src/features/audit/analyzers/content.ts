import { AuditCategory, Difficulty, Priority, Severity } from '@prisma/client';

import { CATEGORY_WEIGHTS, impactScore, scoreFromIssues } from '@/config/scoring';
import { unique } from '@/lib/utils';

import type {
  AnalyzerIssue,
  AnalyzerRecommendation,
  CategoryResult,
  ContentDetail,
  PageContext,
} from '../types';

/**
 * Content quality: readability, structure, calls to action and trust signals.
 *
 * These are the deterministic parts of content analysis. Tone, persuasiveness
 * and positioning are judged by the AI pass — this analyzer sticks to things
 * that can be measured the same way twice.
 */

const CTA_PATTERNS = [
  /\bget started\b/i,
  /\bstart (?:free|now|today)\b/i,
  /\btry (?:it )?(?:free|now|today)\b/i,
  /\bsign up\b/i,
  /\bbook a (?:demo|call|consultation)\b/i,
  /\brequest a (?:demo|quote)\b/i,
  /\bcontact (?:us|sales)\b/i,
  /\bbuy now\b/i,
  /\badd to (?:cart|basket)\b/i,
  /\bsubscribe\b/i,
  /\bdownload\b/i,
  /\blearn more\b/i,
  /\bschedule\b/i,
  /\bjoin\b/i,
];

const TRUST_PATTERNS: Array<{ label: string; test: RegExp }> = [
  { label: 'Customer testimonials', test: /\b(?:testimonial|what our (?:clients|customers) say|review[s]?)\b/i },
  { label: 'Case studies', test: /\bcase stud(?:y|ies)\b/i },
  { label: 'Privacy policy', test: /\bprivacy polic(?:y|ies)\b/i },
  { label: 'Terms of service', test: /\bterms (?:of (?:service|use)|and conditions)\b/i },
  { label: 'Money-back guarantee', test: /\b(?:money[- ]back|satisfaction) guarantee\b/i },
  { label: 'Security or compliance badge', test: /\b(?:SOC ?2|ISO ?27001|GDPR|HIPAA|PCI[- ]DSS)\b/i },
  { label: 'Physical address', test: /\b\d{1,5}\s+[A-Z][a-z]+\s+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr)\b/ },
  { label: 'Phone number', test: /(?:\+\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/ },
  { label: 'Contact email', test: /[\w.+-]+@[\w-]+\.[\w.]{2,}/ },
  { label: 'Named team or about page', test: /\b(?:about us|our team|meet the team|founded in)\b/i },
];

/**
 * Flesch reading-ease. Higher is easier: 60-70 is plain English, below 30
 * reads like an academic paper.
 */
export function fleschReadingEase(text: string): number | null {
  const sentences = text.split(/[.!?]+(?:\s|$)/).filter((sentence) => sentence.trim().length > 0);
  const words = text.split(/\s+/).filter(Boolean);

  if (sentences.length < 3 || words.length < 50) return null;

  const syllables = words.reduce((sum, word) => sum + countSyllables(word), 0);

  const score =
    206.835 - 1.015 * (words.length / sentences.length) - 84.6 * (syllables / words.length);

  return Number(Math.max(0, Math.min(100, score)).toFixed(1));
}

/** Vowel-group heuristic. Not perfect, but stable and good enough for a band. */
function countSyllables(word: string): number {
  const cleaned = word.toLowerCase().replace(/[^a-z]/g, '');
  if (cleaned.length === 0) return 0;
  if (cleaned.length <= 3) return 1;

  const trimmed = cleaned
    .replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '')
    .replace(/^y/, '');

  const groups = trimmed.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups?.length ?? 1);
}

export function analyzeContent(context: PageContext): CategoryResult<ContentDetail> {
  const { $, text } = context;
  const issues: AnalyzerIssue[] = [];
  const recommendations: AnalyzerRecommendation[] = [];

  const words = text.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const readingTimeSec = Math.round((wordCount / 225) * 60);

  const sentences = text.split(/[.!?]+(?:\s|$)/).filter((sentence) => sentence.trim().length > 0);
  const averageSentenceLength = sentences.length > 0 ? Math.round(wordCount / sentences.length) : 0;
  const paragraphCount = $('p').length;

  const readability = fleschReadingEase(text);

  // CTAs are looked for in interactive elements, not body prose — the word
  // "subscribe" in a paragraph is not a call to action.
  const ctaCandidates = unique(
    $('a, button, input[type="submit"], [role="button"]')
      .toArray()
      .map((element) => {
        const $element = $(element);
        return ($element.attr('value') ?? $element.text()).replace(/\s+/g, ' ').trim();
      })
      .filter((label) => label.length > 0 && label.length <= 60),
  );

  const ctaLabels = ctaCandidates.filter((label) => CTA_PATTERNS.some((pattern) => pattern.test(label)));

  const haystack = `${text} ${$('a[href]').text()}`;
  const trustSignals = TRUST_PATTERNS.filter((signal) => signal.test.test(haystack)).map((signal) => signal.label);

  // -------------------------------------------------------------------------
  // Findings
  // -------------------------------------------------------------------------

  if (wordCount < 150) {
    issues.push({
      code: 'content.length.minimal',
      category: AuditCategory.CONTENT,
      severity: Severity.HIGH,
      title: `Only ${wordCount} words on the page`,
      description:
        'There is very little for a visitor to read, and almost nothing for a search engine to understand. Even a landing page usually needs a few hundred words to answer the obvious questions.',
    });
  }

  if (ctaLabels.length === 0) {
    issues.push({
      code: 'content.cta.missing',
      category: AuditCategory.CONTENT,
      severity: Severity.HIGH,
      title: 'No clear call to action',
      description:
        'We could not find a button or link that tells visitors what to do next. Without an obvious next step, even interested visitors leave.',
    });
    recommendations.push({
      category: AuditCategory.CONTENT,
      title: 'Add a clear primary call to action',
      explanation:
        'Decide on the one action you most want a visitor to take, and put it in a prominent button above the fold with specific wording — "Book a 15-minute demo" beats "Submit". Repeat it at the end of the page.',
      expectedImpact:
        'A single obvious next step is consistently one of the largest conversion improvements available on a page that currently lacks one.',
      difficulty: Difficulty.EASY,
      estimatedMinutes: 60,
      priority: Priority.HIGH,
      impactScore: impactScore({ severity: Severity.HIGH, difficulty: Difficulty.EASY, categoryWeight: CATEGORY_WEIGHTS.CONTENT }),
      kind: 'QUICK_WIN',
    });
  } else if (ctaLabels.length > 8) {
    issues.push({
      code: 'content.cta.competing',
      category: AuditCategory.CONTENT,
      severity: Severity.LOW,
      title: `${ctaLabels.length} competing calls to action`,
      description:
        'When everything is a priority, nothing is. Too many equally-weighted CTAs make visitors hesitate rather than act.',
      evidence: ctaLabels.slice(0, 8).join(', '),
    });
  }

  const genericCtas = ctaLabels.filter((label) => /^(?:submit|click here|learn more|read more)$/i.test(label.trim()));
  if (genericCtas.length > 0) {
    issues.push({
      code: 'content.cta.generic',
      category: AuditCategory.CONTENT,
      severity: Severity.LOW,
      title: 'Generic call-to-action wording',
      description:
        '"Submit" and "Click here" describe the mechanic, not the benefit. Specific labels that name the outcome convert better and are clearer to screen-reader users.',
      evidence: genericCtas.join(', '),
    });
  }

  if (readability !== null && readability < 40) {
    issues.push({
      code: 'content.readability.difficult',
      category: AuditCategory.CONTENT,
      severity: Severity.MEDIUM,
      title: `Reading ease is ${readability}/100 — hard going`,
      description:
        'Long sentences and long words make the page tiring to read. Unless you are writing for a specialist audience, aim for 60 or above, which is roughly the level of a good newspaper.',
    });
    recommendations.push({
      category: AuditCategory.CONTENT,
      title: 'Simplify the writing',
      explanation:
        'Break sentences over 25 words in two, swap jargon for plain equivalents, and lead each paragraph with its point rather than building up to it.',
      expectedImpact:
        'Easier text keeps more visitors reading to the end, which is where your call to action usually is.',
      difficulty: Difficulty.MEDIUM,
      estimatedMinutes: 150,
      priority: Priority.MEDIUM,
      impactScore: impactScore({ severity: Severity.MEDIUM, difficulty: Difficulty.MEDIUM, categoryWeight: CATEGORY_WEIGHTS.CONTENT }),
      kind: 'LONG_TERM',
    });
  }

  if (averageSentenceLength > 28) {
    issues.push({
      code: 'content.sentences.long',
      category: AuditCategory.CONTENT,
      severity: Severity.LOW,
      title: `Sentences average ${averageSentenceLength} words`,
      description:
        'Long sentences are hard to follow on a screen, especially on mobile. Aim for an average around 15-20 words with deliberate variation.',
    });
  }

  if (wordCount > 400 && paragraphCount < 4) {
    issues.push({
      code: 'content.structure.wall-of-text',
      category: AuditCategory.CONTENT,
      severity: Severity.MEDIUM,
      title: 'Content is a wall of text',
      description:
        `${wordCount} words across only ${paragraphCount} paragraph${paragraphCount === 1 ? '' : 's'}. Visitors scan before they read; dense blocks get skipped entirely.`,
    });
    recommendations.push({
      category: AuditCategory.CONTENT,
      title: 'Break the content into scannable sections',
      explanation:
        'Split the text into paragraphs of 2-4 sentences, add subheadings every few paragraphs, and pull key points into a short bulleted list.',
      expectedImpact: 'Scannable pages hold attention longer and get read further down.',
      difficulty: Difficulty.EASY,
      estimatedMinutes: 60,
      priority: Priority.MEDIUM,
      impactScore: impactScore({ severity: Severity.MEDIUM, difficulty: Difficulty.EASY, categoryWeight: CATEGORY_WEIGHTS.CONTENT }),
      kind: 'QUICK_WIN',
    });
  }

  if (trustSignals.length < 2) {
    issues.push({
      code: 'content.trust.weak',
      category: AuditCategory.CONTENT,
      severity: Severity.MEDIUM,
      title: 'Few trust signals on the page',
      description:
        'We found little of the evidence visitors look for before acting — testimonials, real contact details, policies, guarantees or recognisable customers.',
    });
    recommendations.push({
      category: AuditCategory.CONTENT,
      title: 'Add credibility markers',
      explanation:
        'Add two or three of: a named customer testimonial with a photo, logos of companies you work with, a physical address and phone number in the footer, and links to your privacy policy and terms.',
      expectedImpact:
        'Trust markers reduce the hesitation that stops first-time visitors from buying or getting in touch.',
      difficulty: Difficulty.EASY,
      estimatedMinutes: 90,
      priority: Priority.MEDIUM,
      impactScore: impactScore({ severity: Severity.MEDIUM, difficulty: Difficulty.EASY, categoryWeight: CATEGORY_WEIGHTS.CONTENT }),
      kind: 'QUICK_WIN',
    });
  }

  const detail: ContentDetail = {
    wordCount,
    readingTimeSec,
    readability,
    averageSentenceLength,
    paragraphCount,
    hasCallToAction: ctaLabels.length > 0,
    ctaLabels: ctaLabels.slice(0, 12),
    trustSignals,
  };

  const score = scoreFromIssues(issues);

  return {
    category: AuditCategory.CONTENT,
    score,
    summary: buildSummary(score, detail),
    issues,
    recommendations,
    detail,
  };
}

function buildSummary(score: number, detail: ContentDetail): string {
  const readability = detail.readability !== null ? `Reading ease ${detail.readability}/100.` : '';
  if (score >= 85) {
    return `Well-structured content: ${detail.wordCount} words, a clear call to action and ${detail.trustSignals.length} trust signal${detail.trustSignals.length === 1 ? '' : 's'}. ${readability}`;
  }
  if (score >= 60) {
    return `Decent content with gaps — ${detail.hasCallToAction ? 'the CTA is present' : 'no clear CTA'} and ${detail.trustSignals.length} trust signal${detail.trustSignals.length === 1 ? '' : 's'} found. ${readability}`;
  }
  return `Content needs work: ${detail.wordCount} words, ${detail.hasCallToAction ? 'a CTA is present but' : 'no clear call to action and'} limited supporting evidence for a visitor deciding whether to act. ${readability}`;
}
