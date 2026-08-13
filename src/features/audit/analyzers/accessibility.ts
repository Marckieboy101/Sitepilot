import type { Difficulty, Severity } from '@prisma/client';

import { CATEGORY_WEIGHTS, impactScore } from '@/config/scoring';
import { toScore, unique } from '@/lib/utils';

import type {
  AccessibilityDetail,
  AnalyzerIssue,
  AnalyzerRecommendation,
  AxeViolation,
  CategoryResult,
  PageContext,
} from '../types';

/**
 * Accessibility analysis against WCAG 2.2 AA.
 *
 * When a headless browser is available we run axe-core against the rendered
 * page, which is the only way to catch computed-style failures like colour
 * contrast. Without one we fall back to static checks on the markup — fewer
 * rules, no false confidence: the result is explicitly labelled as a partial
 * scan so a clean static result is never mistaken for a clean axe run.
 */

const IMPACT_SEVERITY: Record<string, Severity> = {
  critical: 'CRITICAL',
  serious: 'HIGH',
  moderate: 'MEDIUM',
  minor: 'LOW',
};

/** Plain-English guidance for the axe rules users hit most. */
const RULE_GUIDANCE: Record<string, { fix: string; impact: string; minutes: number }> = {
  'color-contrast': {
    fix: 'Darken the text or lighten the background until the contrast ratio reaches 4.5:1 for body text and 3:1 for large text.',
    impact:
      'Low-contrast text is unreadable for anyone with reduced vision, and hard for everyone outdoors or on a dim screen. This is the most commonly failed accessibility rule on the web.',
    minutes: 90,
  },
  'image-alt': {
    fix: 'Add an alt attribute describing what each image conveys. Use alt="" for images that are purely decorative.',
    impact: 'Screen-reader users learn what the image shows instead of hearing a filename or nothing at all.',
    minutes: 45,
  },
  label: {
    fix: 'Give every form field a <label for="…"> or an aria-label.',
    impact: 'Without labels, a screen reader announces "edit text" with no indication of what to type.',
    minutes: 60,
  },
  'link-name': {
    fix: 'Give every link discernible text. For icon-only links, add an aria-label describing the destination.',
    impact: 'Screen-reader users navigate by listing links; unlabelled ones are announced as "link" and are useless.',
    minutes: 45,
  },
  'button-name': {
    fix: 'Give every button text content or an aria-label.',
    impact: 'An unnamed button is unusable with a screen reader — there is no way to know what it does.',
    minutes: 45,
  },
  'heading-order': {
    fix: 'Use headings in sequence — do not jump from H2 to H4 to satisfy a visual style.',
    impact: 'Screen-reader users navigate long pages by heading structure; gaps make the outline confusing.',
    minutes: 60,
  },
  'html-has-lang': {
    fix: 'Add a lang attribute to the <html> element.',
    impact: 'Screen readers use it to pick the right pronunciation rules; without it, content can be unintelligible.',
    minutes: 5,
  },
  'aria-required-attr': {
    fix: 'Supply the ARIA attributes each role requires, or drop the role and use the equivalent native element.',
    impact: 'Incomplete ARIA is worse than none — it makes assistive technology announce a control incorrectly.',
    minutes: 60,
  },
  region: {
    fix: 'Wrap page content in landmark elements — <header>, <nav>, <main>, <footer>.',
    impact: 'Landmarks let screen-reader users jump straight to the main content instead of hearing the nav every time.',
    minutes: 45,
  },
  'document-title': {
    fix: 'Give the document a descriptive <title>.',
    impact: 'The title is the first thing announced when a page loads, and how users tell tabs apart.',
    minutes: 10,
  },
};

interface StaticFindings {
  missingAltText: number;
  missingFormLabels: number;
  missingAriaLabels: number;
  headingOrderIssues: number;
  focusIssues: number;
  keyboardIssues: number;
  emptyLinks: number;
  missingLandmarks: boolean;
  missingLang: boolean;
  hasPositiveTabindex: number;
}

/** Markup-only checks. These run whether or not a browser was available. */
function staticScan(context: PageContext): StaticFindings {
  const { $ } = context;

  const missingAltText = $('img').toArray().filter((element) => {
    const $img = $(element);
    return (
      $img.attr('alt') === undefined &&
      $img.attr('role') !== 'presentation' &&
      $img.attr('aria-hidden') !== 'true'
    );
  }).length;

  const missingFormLabels = $('input, select, textarea').toArray().filter((element) => {
    const $field = $(element);
    const type = ($field.attr('type') ?? '').toLowerCase();
    if (['hidden', 'submit', 'button', 'reset', 'image'].includes(type)) return false;

    if ($field.attr('aria-label') || $field.attr('aria-labelledby') || $field.attr('title')) return false;

    const id = $field.attr('id');
    if (id) {
      // Cheerio needs the id escaped for the attribute selector to be valid.
      const escaped = id.replace(/["\\]/g, '\\$&');
      if ($(`label[for="${escaped}"]`).length > 0) return false;
    }

    // A field wrapped in its own label is correctly associated.
    return $field.parents('label').length === 0;
  }).length;

  const missingAriaLabels = $(
    'button, a[href], [role="button"], [role="link"], [role="tab"], [role="checkbox"]',
  )
    .toArray()
    .filter((element) => {
      const $control = $(element);
      const hasText = $control.text().replace(/\s+/g, '').length > 0;
      const hasLabel = Boolean($control.attr('aria-label') || $control.attr('aria-labelledby') || $control.attr('title'));
      // An icon-only control whose image has alt text is labelled.
      const hasLabelledImage = $control.find('img[alt]:not([alt=""])').length > 0;
      return !hasText && !hasLabel && !hasLabelledImage;
    }).length;

  let previousLevel = 0;
  let headingOrderIssues = 0;
  $('h1, h2, h3, h4, h5, h6').each((_, element) => {
    const level = Number(((element as { tagName?: string }).tagName ?? 'h6').slice(1));
    if (previousLevel > 0 && level > previousLevel + 1) headingOrderIssues += 1;
    previousLevel = level;
  });

  // `outline: none` without a replacement focus style is the classic way
  // keyboard navigation gets silently broken.
  const styleText = $('style').text();
  const focusIssues =
    /(?:^|[^-\w]):focus\s*\{[^}]*outline\s*:\s*(?:none|0)/i.test(styleText) &&
    !/:focus-visible/i.test(styleText)
      ? 1
      : 0;

  const hasPositiveTabindex = $('[tabindex]').toArray().filter((element) => {
    const value = Number($(element).attr('tabindex'));
    return Number.isFinite(value) && value > 0;
  }).length;

  // Click handlers on non-interactive elements are unreachable by keyboard.
  const keyboardIssues = $('div[onclick], span[onclick], li[onclick]').toArray().filter((element) => {
    const $element = $(element);
    return $element.attr('tabindex') === undefined && $element.attr('role') === undefined;
  }).length;

  return {
    missingAltText,
    missingFormLabels,
    missingAriaLabels,
    headingOrderIssues,
    focusIssues,
    keyboardIssues,
    emptyLinks: missingAriaLabels,
    missingLandmarks: $('main, [role="main"]').length === 0,
    missingLang: !$('html').attr('lang'),
    hasPositiveTabindex,
  };
}

function countViolationNodes(violations: AxeViolation[], predicate: (rule: string) => boolean): number {
  return violations
    .filter((violation) => predicate(violation.id))
    .reduce((sum, violation) => sum + violation.nodes.length, 0);
}

export function analyzeAccessibility(context: PageContext): CategoryResult<AccessibilityDetail> {
  const issues: AnalyzerIssue[] = [];
  const recommendations: AnalyzerRecommendation[] = [];

  const axe = context.browser?.axe ?? null;
  const statics = staticScan(context);

  const violations = axe?.violations ?? [];

  const criticalCount = violations.filter((violation) => violation.impact === 'critical').length;
  const seriousCount = violations.filter((violation) => violation.impact === 'serious').length;
  const moderateCount = violations.filter((violation) => violation.impact === 'moderate').length;
  const minorCount = violations.filter((violation) => violation.impact === 'minor').length;

  // -------------------------------------------------------------------------
  // axe-core violations
  // -------------------------------------------------------------------------
  for (const violation of violations) {
    const severity = IMPACT_SEVERITY[violation.impact ?? 'moderate'] ?? Severity.MEDIUM;
    const affected = violation.nodes.length;

    issues.push({
      code: `a11y.${violation.id}`,
      category: 'ACCESSIBILITY',
      severity,
      title: `${violation.help} (${affected} element${affected === 1 ? '' : 's'})`,
      description: violation.description,
      evidence: violation.nodes
        .slice(0, 3)
        .map((node) => node.target.join(' '))
        .join('\n'),
      helpUrl: violation.helpUrl,
    });

    const guidance = RULE_GUIDANCE[violation.id];
    if (guidance) {
      const difficulty = guidance.minutes > 120 ? 'MEDIUM' : 'EASY';
      recommendations.push({
        category: 'ACCESSIBILITY',
        title: violation.help,
        explanation: `${guidance.fix} ${affected} element${affected === 1 ? '' : 's'} on this page ${affected === 1 ? 'is' : 'are'} affected.`,
        expectedImpact: guidance.impact,
        difficulty,
        estimatedMinutes: guidance.minutes,
        priority: severity === 'CRITICAL' || severity === 'HIGH' ? 'HIGH' : 'MEDIUM',
        impactScore: impactScore({ severity: severity as Severity, difficulty: difficulty as Difficulty, categoryWeight: (CATEGORY_WEIGHTS as unknown as Record<string, number>).ACCESSIBILITY }),
        kind: guidance.minutes <= 120 ? 'QUICK_WIN' : 'LONG_TERM',
      });
    }
  }

  // -------------------------------------------------------------------------
  // Static checks — reported only when axe did not already cover the rule, so
  // the same problem is never listed twice.
  // -------------------------------------------------------------------------
  const axeRules = new Set(violations.map((violation) => violation.id));

  if (statics.missingAltText > 0 && !axeRules.has('image-alt')) {
    issues.push({
      code: 'a11y.static.image-alt',
      category: 'ACCESSIBILITY',
      severity: 'HIGH',
      title: `${statics.missingAltText} image${statics.missingAltText === 1 ? '' : 's'} missing alt text`,
      description:
        'Images without an alt attribute are announced as a filename, or skipped entirely, by screen readers.',
    });
    recommendations.push({
      category: 'ACCESSIBILITY',
      title: 'Add alt text to images',
      explanation: RULE_GUIDANCE['image-alt'].fix,
      expectedImpact: RULE_GUIDANCE['image-alt'].impact,
      difficulty: 'EASY',
      estimatedMinutes: Math.min(120, statics.missingAltText * 5),
      priority: 'HIGH',
      impactScore: impactScore({ severity: 'HIGH' as Severity, difficulty: 'EASY' as Difficulty, categoryWeight: (CATEGORY_WEIGHTS as unknown as Record<string, number>).ACCESSIBILITY }),
      kind: 'QUICK_WIN',
    });
  }

  if (statics.missingFormLabels > 0 && !axeRules.has('label')) {
    issues.push({
      code: 'a11y.static.form-labels',
      category: 'ACCESSIBILITY',
      severity: 'HIGH',
      title: `${statics.missingFormLabels} form field${statics.missingFormLabels === 1 ? '' : 's'} without a label`,
      description:
        'A placeholder is not a label — it disappears on focus and is not reliably announced. Every input needs an associated <label>.',
    });
    recommendations.push({
      category: 'ACCESSIBILITY',
      title: 'Label every form field',
      explanation: RULE_GUIDANCE.label.fix,
      expectedImpact: RULE_GUIDANCE.label.impact,
      difficulty: 'EASY',
      estimatedMinutes: Math.min(120, statics.missingFormLabels * 10),
      priority: 'HIGH',
      impactScore: impactScore({ severity: 'HIGH' as Severity, difficulty: 'EASY' as Difficulty, categoryWeight: (CATEGORY_WEIGHTS as unknown as Record<string, number>).ACCESSIBILITY }),
      kind: 'QUICK_WIN',
    });
  }

  if (statics.missingAriaLabels > 0 && !axeRules.has('button-name') && !axeRules.has('link-name')) {
    issues.push({
      code: 'a11y.static.control-names',
      category: 'ACCESSIBILITY',
      severity: 'HIGH',
      title: `${statics.missingAriaLabels} button${statics.missingAriaLabels === 1 ? '' : 's'} or link${statics.missingAriaLabels === 1 ? '' : 's'} with no accessible name`,
      description:
        'Icon-only controls with no text and no aria-label are announced as just "button" or "link", giving no clue what they do.',
    });
  }

  if (statics.headingOrderIssues > 0 && !axeRules.has('heading-order')) {
    issues.push({
      code: 'a11y.static.heading-order',
      category: 'ACCESSIBILITY',
      severity: 'MEDIUM',
      title: `Heading levels skip ${statics.headingOrderIssues} time${statics.headingOrderIssues === 1 ? '' : 's'}`,
      description:
        'Jumping from H2 straight to H4 breaks the document outline that screen-reader users rely on to navigate.',
    });
  }

  if (statics.missingLandmarks) {
    issues.push({
      code: 'a11y.static.no-main',
      category: 'ACCESSIBILITY',
      severity: 'MEDIUM',
      title: 'No <main> landmark',
      description:
        'Without a main landmark there is no "skip to content" target, so screen-reader users hear the entire navigation on every page.',
    });
  }

  if (statics.missingLang && !axeRules.has('html-has-lang')) {
    issues.push({
      code: 'a11y.static.no-lang',
      category: 'ACCESSIBILITY',
      severity: 'MEDIUM',
      title: 'No lang attribute on <html>',
      description: 'Screen readers need the page language to choose the correct pronunciation rules.',
    });
  }

  if (statics.focusIssues > 0) {
    issues.push({
      code: 'a11y.static.focus-removed',
      category: 'ACCESSIBILITY',
      severity: 'HIGH',
      title: 'Focus outlines are removed without a replacement',
      description:
        'Your CSS sets outline: none on :focus with no :focus-visible alternative. Keyboard users lose all indication of where they are on the page.',
    });
    recommendations.push({
      category: 'ACCESSIBILITY',
      title: 'Restore a visible focus indicator',
      explanation:
        'Replace `:focus { outline: none }` with a styled `:focus-visible` rule — a 2px outline in your brand colour with 2px of offset works well and looks deliberate.',
      expectedImpact:
        'Keyboard and switch-device users can see where they are. This is a WCAG 2.2 AA requirement, not a preference.',
      difficulty: 'EASY',
      estimatedMinutes: 30,
      priority: 'HIGH',
      impactScore: impactScore({ severity: 'HIGH' as Severity, difficulty: 'EASY' as Difficulty, categoryWeight: (CATEGORY_WEIGHTS as unknown as Record<string, number>).ACCESSIBILITY }),
      kind: 'QUICK_WIN',
    });
  }

  if (statics.keyboardIssues > 0) {
    issues.push({
      code: 'a11y.static.keyboard-traps',
      category: 'ACCESSIBILITY',
      severity: 'HIGH',
      title: `${statics.keyboardIssues} clickable element${statics.keyboardIssues === 1 ? '' : 's'} unreachable by keyboard`,
      description:
        'These elements have click handlers but are not focusable and have no interactive role, so they cannot be reached or activated without a mouse.',
    });
  }

  if (statics.hasPositiveTabindex > 0) {
    issues.push({
      code: 'a11y.static.positive-tabindex',
      category: 'ACCESSIBILITY',
      severity: 'MEDIUM',
      title: `${statics.hasPositiveTabindex} element${statics.hasPositiveTabindex === 1 ? '' : 's'} with a positive tabindex`,
      description:
        'Positive tabindex values override the natural tab order and almost always produce a confusing, unpredictable sequence.',
    });
  }

  const contrastIssues = countViolationNodes(violations, (rule) => rule === 'color-contrast');

  const detail: AccessibilityDetail = {
    violationCount: violations.length,
    passCount: axe?.passes ?? 0,
    incompleteCount: axe?.incomplete ?? 0,
    criticalCount,
    seriousCount,
    moderateCount,
    minorCount,
    contrastIssues,
    missingAltText: axeRules.has('image-alt')
      ? countViolationNodes(violations, (rule) => rule === 'image-alt')
      : statics.missingAltText,
    missingFormLabels: axeRules.has('label')
      ? countViolationNodes(violations, (rule) => rule === 'label')
      : statics.missingFormLabels,
    missingAriaLabels: statics.missingAriaLabels,
    headingOrderIssues: statics.headingOrderIssues,
    focusIssues: statics.focusIssues,
    keyboardIssues: statics.keyboardIssues,
    wcagTags: unique(violations.flatMap((violation) => violation.tags)).filter((tag) => tag.startsWith('wcag')),
    rawViolations: violations.slice(0, 40),
  };

  return {
    category: 'ACCESSIBILITY',
    score: computeScore(detail, Boolean(axe), issues.length),
    summary: buildSummary(detail, Boolean(axe)),
    issues,
    recommendations,
    detail,
  };
}

/**
 * Weighted by node count, not violation count: one rule failing on 40 elements
 * is a far bigger barrier than four rules failing once each, and a scoring
 * model that ignores that rewards sites for concentrating their problems.
 */
function computeScore(detail: AccessibilityDetail, hadAxe: boolean, staticIssueCount: number): number {
  if (!hadAxe) {
    // Static-only: score from what we could actually check, and cap the
    // ceiling so a partial scan never reads as a perfect result.
    const deductions =
      detail.missingAltText * 3 +
      detail.missingFormLabels * 5 +
      detail.missingAriaLabels * 3 +
      detail.headingOrderIssues * 2 +
      detail.focusIssues * 12 +
      detail.keyboardIssues * 6;
    return toScore(Math.min(92, 92 - deductions + (staticIssueCount === 0 ? 8 : 0)));
  }

  const weighted =
    countByImpact(detail, 'critical') * 9 +
    countByImpact(detail, 'serious') * 5 +
    countByImpact(detail, 'moderate') * 2 +
    countByImpact(detail, 'minor') * 0.6;

  return toScore(100 - weighted);
}

function countByImpact(detail: AccessibilityDetail, impact: string): number {
  return detail.rawViolations
    .filter((violation) => violation.impact === impact)
    .reduce((sum, violation) => sum + Math.min(violation.nodes.length, 10), 0);
}

function buildSummary(detail: AccessibilityDetail, hadAxe: boolean): string {
  if (!hadAxe) {
    return `Partial scan: we checked the markup but could not run a full axe-core pass, so colour contrast and computed-style rules were not tested. ${detail.missingAltText + detail.missingFormLabels + detail.missingAriaLabels} labelling problem${detail.missingAltText + detail.missingFormLabels + detail.missingAriaLabels === 1 ? '' : 's'} found in the HTML.`;
  }

  if (detail.violationCount === 0) {
    return `No axe-core violations across ${detail.passCount} automated checks. Automated tools catch roughly a third of accessibility barriers, so manual keyboard and screen-reader testing is still worth doing.`;
  }

  return `${detail.violationCount} accessibility rule${detail.violationCount === 1 ? '' : 's'} failing${detail.contrastIssues > 0 ? `, including ${detail.contrastIssues} colour-contrast failure${detail.contrastIssues === 1 ? '' : 's'}` : ''}. ${detail.criticalCount + detail.seriousCount} of them are critical or serious.`;
}
