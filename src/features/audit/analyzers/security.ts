import { AuditCategory, Difficulty, Priority, Severity } from '@prisma/client';

import { CATEGORY_WEIGHTS, impactScore } from '@/config/scoring';
import { toScore } from '@/lib/utils';

import type { AnalyzerIssue, AnalyzerRecommendation, CategoryResult, PageContext } from '../types';

/**
 * Transport security and protective HTTP headers.
 *
 * Scored additively rather than by subtracting penalties: headers are a
 * checklist of things you either have or don't, and a weighted "points earned"
 * model produces a score that moves predictably as a team works through the
 * list. HTTPS dominates the weighting because everything else is decoration
 * without it.
 */

interface HeaderCheck {
  key: string;
  weight: number;
  label: string;
  severity: Severity;
  present: (context: PageContext) => boolean;
  description: string;
  fix: string;
  impact: string;
  minutes: number;
}

const CHECKS: HeaderCheck[] = [
  {
    key: 'security.https',
    weight: 34,
    label: 'HTTPS',
    severity: Severity.CRITICAL,
    present: ({ page }) => new URL(page.finalUrl).protocol === 'https:',
    description:
      'The page is served over plain HTTP. Anything a visitor types — passwords, card details, search terms — travels unencrypted and can be read or modified in transit.',
    fix: 'Install a TLS certificate and 301-redirect all HTTP traffic to HTTPS.',
    impact: 'Removes the "Not secure" browser warning and protects every form on the site.',
    minutes: 120,
  },
  {
    key: 'security.hsts',
    weight: 16,
    label: 'Strict-Transport-Security',
    severity: Severity.HIGH,
    present: ({ page }) => page.headers.has('strict-transport-security'),
    description:
      'No HSTS header. Without it the very first request of a session can still be made over HTTP, which is the window an attacker on the same network needs.',
    fix: 'Send Strict-Transport-Security: max-age=31536000; includeSubDomains once you are confident every subdomain serves HTTPS.',
    impact: 'Browsers refuse to talk to your domain over HTTP at all, closing the downgrade window.',
    minutes: 30,
  },
  {
    key: 'security.csp',
    weight: 20,
    label: 'Content-Security-Policy',
    severity: Severity.HIGH,
    present: ({ page }) => page.headers.has('content-security-policy'),
    description:
      'No Content-Security-Policy. CSP is the main defence against cross-site scripting: it tells the browser which sources may execute code, so an injected <script> is blocked rather than run.',
    fix: 'Start with a report-only policy to find violations without breaking the site, then enforce a policy that names your real script and style sources.',
    impact: 'Turns most XSS attempts into a blocked request instead of a compromised session.',
    minutes: 240,
  },
  {
    key: 'security.x-frame-options',
    weight: 10,
    label: 'X-Frame-Options',
    severity: Severity.MEDIUM,
    present: ({ page }) =>
      page.headers.has('x-frame-options') ||
      /frame-ancestors/i.test(page.headers.get('content-security-policy') ?? ''),
    description:
      'Nothing stops another site from loading your pages inside an invisible iframe, which is how clickjacking works — the visitor thinks they are clicking your button but they are clicking something else.',
    fix: 'Send X-Frame-Options: SAMEORIGIN, or the modern equivalent frame-ancestors directive in your CSP.',
    impact: 'Blocks clickjacking attacks that trick users into actions they did not intend.',
    minutes: 15,
  },
  {
    key: 'security.x-content-type-options',
    weight: 8,
    label: 'X-Content-Type-Options',
    severity: Severity.MEDIUM,
    present: ({ page }) => page.headers.has('x-content-type-options'),
    description:
      'Without nosniff, browsers may guess a response\'s type and execute an uploaded file as JavaScript.',
    fix: 'Send X-Content-Type-Options: nosniff on every response.',
    impact: 'Stops MIME-sniffing attacks against user-uploaded content.',
    minutes: 10,
  },
  {
    key: 'security.referrer-policy',
    weight: 7,
    label: 'Referrer-Policy',
    severity: Severity.LOW,
    present: ({ page }) => page.headers.has('referrer-policy'),
    description:
      'No Referrer-Policy, so full URLs — including any tokens or ids in the path — are sent to every third-party resource the page loads.',
    fix: 'Send Referrer-Policy: strict-origin-when-cross-origin.',
    impact: 'Prevents leaking internal URLs and query parameters to external sites.',
    minutes: 10,
  },
  {
    key: 'security.permissions-policy',
    weight: 5,
    label: 'Permissions-Policy',
    severity: Severity.LOW,
    present: ({ page }) => page.headers.has('permissions-policy'),
    description:
      'No Permissions-Policy. Embedded third-party frames can request camera, microphone and geolocation access on your origin.',
    fix: 'Send Permissions-Policy: camera=(), microphone=(), geolocation=() and enable only what you use.',
    impact: 'Removes powerful browser capabilities from third-party code running on your page.',
    minutes: 15,
  },
];

export function analyzeSecurity(context: PageContext): CategoryResult<null> {
  const issues: AnalyzerIssue[] = [];
  const recommendations: AnalyzerRecommendation[] = [];

  let earned = 0;
  const total = CHECKS.reduce((sum, check) => sum + check.weight, 0);
  const missing: string[] = [];

  for (const check of CHECKS) {
    if (check.present(context)) {
      earned += check.weight;
      continue;
    }

    missing.push(check.label);

    issues.push({
      code: check.key,
      category: AuditCategory.SECURITY,
      severity: check.severity,
      title: `Missing ${check.label}`,
      description: check.description,
      helpUrl: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers',
    });

    recommendations.push({
      category: AuditCategory.SECURITY,
      title: `Add ${check.label}`,
      explanation: check.fix,
      expectedImpact: check.impact,
      difficulty: check.minutes > 120 ? Difficulty.MEDIUM : Difficulty.EASY,
      estimatedMinutes: check.minutes,
      priority:
        check.severity === Severity.CRITICAL || check.severity === Severity.HIGH
          ? Priority.HIGH
          : check.severity === Severity.MEDIUM
            ? Priority.MEDIUM
            : Priority.LOW,
      impactScore: impactScore({
        severity: check.severity,
        difficulty: check.minutes > 120 ? Difficulty.MEDIUM : Difficulty.EASY,
        categoryWeight: CATEGORY_WEIGHTS.SECURITY,
      }),
      kind: check.minutes <= 120 ? 'QUICK_WIN' : 'LONG_TERM',
    });
  }

  // Mixed content: an HTTPS page that pulls sub-resources over HTTP is only as
  // secure as the weakest one, and browsers block or downgrade it anyway.
  const { $, page } = context;
  if (new URL(page.finalUrl).protocol === 'https:') {
    const insecure = $('script[src^="http://"], link[href^="http://"], img[src^="http://"], iframe[src^="http://"]');
    if (insecure.length > 0) {
      issues.push({
        code: 'security.mixed-content',
        category: AuditCategory.SECURITY,
        severity: Severity.HIGH,
        title: `${insecure.length} resource${insecure.length === 1 ? '' : 's'} loaded over insecure HTTP`,
        description:
          'This HTTPS page loads sub-resources over plain HTTP. Browsers block active mixed content outright and flag the rest, so the page is both less secure and potentially broken.',
      });
      earned = Math.max(0, earned - 12);
    }
  }

  const score = toScore((earned / total) * 100);

  return {
    category: AuditCategory.SECURITY,
    score,
    summary:
      missing.length === 0
        ? 'All the protective headers we check for are present, over HTTPS.'
        : `${missing.length} security header${missing.length === 1 ? '' : 's'} missing: ${missing.slice(0, 4).join(', ')}${missing.length > 4 ? '…' : ''}.`,
    issues,
    recommendations,
    detail: null,
  };
}
