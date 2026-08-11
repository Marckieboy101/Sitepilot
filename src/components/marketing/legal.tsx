import { AlertTriangle } from 'lucide-react';

/**
 * Legal page scaffold.
 *
 * The content below is a structural placeholder, not legal advice, and it says
 * so on the page. Shipping convincing-looking terms that nobody reviewed is
 * worse than shipping an obvious placeholder: the first creates a false
 * impression of coverage, the second prompts someone to fix it.
 */

export interface LegalSection {
  heading: string;
  paragraphs: string[];
}

export const LEGAL_SECTIONS: Record<'privacy' | 'terms', LegalSection[]> = {
  privacy: [
    {
      heading: 'What we collect',
      paragraphs: [
        'Account data: your name, email address and authentication identifiers, held so you can sign in and so we can attribute your work to your account.',
        'Audit data: the URLs you submit, the public content of the pages we fetch at your request, and the results we derive from them.',
        'Usage data: which features you use and how often, used to enforce plan limits and to understand what to improve.',
        'Billing data: handled by Stripe. We store a customer identifier and invoice metadata; we never see or store your card details.',
      ],
    },
    {
      heading: 'How we use it',
      paragraphs: [
        'To run the audits you request, generate the reports, and show you your history.',
        'To enforce the limits of your plan and to bill you correctly.',
        'To send transactional email about your account and, only if you opt in, product updates.',
      ],
    },
    {
      heading: 'AI processing',
      paragraphs: [
        'Audit content is sent to our AI provider to generate the written analysis. Only the digest needed for the analysis is transmitted — page text, headings, calls to action, and the numeric results.',
        'Prompts are constructed so that page content is treated strictly as data to analyse, never as instructions.',
      ],
    },
    {
      heading: 'Retention and deletion',
      paragraphs: [
        'Audit history is retained according to your plan. Deleting your account removes your data immediately, including every project, audit and report.',
      ],
    },
    {
      heading: 'Sub-processors',
      paragraphs: [
        'We rely on infrastructure and service providers to operate the product, including our hosting platform, database provider, authentication provider, payment processor and AI provider.',
      ],
    },
  ],

  terms: [
    {
      heading: 'Using the service',
      paragraphs: [
        'You may audit websites you own or are authorised to analyse. Do not use the service to scan systems you have no permission to test.',
        'Automated or high-volume use beyond your plan limits, or attempts to circumvent them, may result in suspension.',
      ],
    },
    {
      heading: 'Plans and billing',
      paragraphs: [
        'Paid plans renew automatically for the interval you selected until cancelled. Cancelling stops the next renewal; access continues to the end of the period already paid for.',
        'Usage limits reset at the start of each calendar month in UTC.',
      ],
    },
    {
      heading: 'What the audit is and is not',
      paragraphs: [
        'Audit results, scores and AI-generated recommendations are informational. They are produced by automated analysis and, in part, by a language model.',
        'Automated accessibility testing detects a subset of accessibility barriers. Passing our checks is not a certification of WCAG conformance, and we say so in every report.',
        'You are responsible for verifying any recommendation before acting on it.',
      ],
    },
    {
      heading: 'Availability',
      paragraphs: [
        'We aim for high availability but do not guarantee uninterrupted service. Individual audits may degrade — for example when an upstream measurement provider is unavailable — and the report will say when that has happened.',
      ],
    },
    {
      heading: 'Your content',
      paragraphs: [
        'You retain ownership of everything you submit and of the reports generated for you. We process it only to provide the service.',
      ],
    },
  ],
};

export function LegalPage({
  title,
  updated,
  sections,
}: {
  title: string;
  updated: string;
  sections: LegalSection[];
}) {
  return (
    <div className="mx-auto max-w-3xl px-4 pb-24 pt-32 sm:px-6 lg:px-8">
      <h1 className="text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">{title}</h1>
      <p className="mt-3 text-sm text-muted-foreground">{updated}</p>

      <div className="mt-8 flex gap-3 rounded-xl border border-warning/30 bg-warning/[0.06] p-4">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
        <p className="text-sm leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">Placeholder document.</span> This outlines the
          structure and the substance a real policy would need to cover, but it has not been reviewed by a
          lawyer. Replace it with a version prepared for your jurisdiction before accepting customers.
        </p>
      </div>

      <div className="mt-12 space-y-10">
        {sections.map((section) => (
          <section key={section.heading}>
            <h2 className="text-xl font-semibold tracking-[-0.02em]">{section.heading}</h2>
            <div className="mt-3 space-y-3">
              {section.paragraphs.map((paragraph, index) => (
                <p key={index} className="leading-relaxed text-muted-foreground">
                  {paragraph}
                </p>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
