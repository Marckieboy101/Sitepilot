'use client';

import * as React from 'react';

import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  Accessibility,
  ArrowRight,
  BarChart3,
  Bot,
  Check,
  FileDown,
  Gauge,
  Layers,
  LineChart,
  Lock,
  MessageSquare,
  Paintbrush,
  Search,
  Sparkles,
  Target,
  Users,
} from 'lucide-react';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { PLANS, PLAN_ORDER, yearlySavingPercent } from '@/config/plans';
import { formatCurrency } from '@/lib/utils';
import { cn } from '@/lib/utils';

import { SectionGlow } from './aurora-background';

/**
 * Landing page sections.
 *
 * Every section shares one entrance treatment — a short rise on scroll, once,
 * with a stagger — because a page where each block animates differently reads
 * as a collection of templates rather than one product.
 */

const viewport = { once: true, margin: '-80px' } as const;

const rise = {
  hidden: { opacity: 0, y: 24 },
  visible: (index = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.55, delay: index * 0.07, ease: [0.16, 1, 0.3, 1] as const },
  }),
};

function SectionHeading({
  eyebrow,
  title,
  description,
  className,
}: {
  eyebrow: string;
  title: React.ReactNode;
  description?: string;
  className?: string;
}) {
  return (
    <motion.div
      initial="hidden"
      whileInView="visible"
      viewport={viewport}
      variants={rise}
      className={cn('mx-auto max-w-2xl text-center', className)}
    >
      <p className="text-sm font-medium uppercase tracking-[0.14em] text-primary">{eyebrow}</p>
      <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">{title}</h2>
      {description && (
        <p className="mt-4 text-base leading-relaxed text-muted-foreground sm:text-lg">{description}</p>
      )}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Trusted by
// ---------------------------------------------------------------------------

/**
 * Placeholder wordmarks. These are generic labels standing in for the real
 * customer logos a launched product would place here — deliberately not real
 * company names, so nothing on this page implies an endorsement that does not
 * exist.
 */
const TRUST_LABELS = [
  'Studio Kepler',
  'Northbeam Digital',
  'Latch & Co',
  'Fernway Labs',
  'Copperline',
  'Meridian Group',
];

export function TrustedBy() {
  return (
    <section className="border-y border-border/60 bg-muted/30 py-12">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <p className="text-center text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Trusted by agencies, freelancers and in-house teams
        </p>
        {/* Duplicated track gives the marquee a seamless loop at -50%. */}
        <div className="mask-fade-x mt-8 overflow-hidden">
          <div className="animate-marquee flex w-max items-center gap-14">
            {[...TRUST_LABELS, ...TRUST_LABELS].map((label, index) => (
              <span
                key={`${label}-${index}`}
                className="whitespace-nowrap text-lg font-semibold tracking-tight text-muted-foreground/45"
              >
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Features
// ---------------------------------------------------------------------------

const FEATURES = [
  {
    icon: Search,
    title: 'Complete SEO audit',
    description:
      'Titles, descriptions, headings, canonicals, structured data, indexability, keyword density and internal linking — checked against what actually affects rankings.',
  },
  {
    icon: Gauge,
    title: 'Real Core Web Vitals',
    description:
      'LCP, CLS, TBT and Speed Index measured through Google PageSpeed Insights, with the specific opportunities that would move each one.',
  },
  {
    icon: Accessibility,
    title: 'WCAG 2.2 AA testing',
    description:
      'A full axe-core pass in a real browser catches contrast failures, missing labels and keyboard traps that markup-only scanners miss entirely.',
  },
  {
    icon: Paintbrush,
    title: 'AI design review',
    description:
      'Palette, typography, spacing, consistency and visual balance judged from the rendered page, with concrete changes rather than vague critique.',
  },
  {
    icon: Target,
    title: 'Conversion analysis',
    description:
      'Where your call to action loses people, which forms create friction, and what a visitor is left uncertain about.',
  },
  {
    icon: Lock,
    title: 'Security headers',
    description:
      'HTTPS, HSTS, CSP, frame options and mixed content, each with the exact header value to add and what it protects you from.',
  },
  {
    icon: LineChart,
    title: 'History and trends',
    description:
      'Every audit is kept. Watch scores move as you ship, and see precisely which change moved which number.',
  },
  {
    icon: Users,
    title: 'Competitor benchmarking',
    description:
      'Run the same audit against competitors and see, category by category, where you genuinely lead and where you do not.',
  },
  {
    icon: FileDown,
    title: 'Client-ready PDF export',
    description:
      'Export the whole report — charts, screenshots and priority list — branded with your own logo on the Agency plan.',
  },
];

export function Features() {
  return (
    <section id="features" className="relative py-24 sm:py-32">
      <SectionGlow className="-top-20" color="a" />
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeading
          eyebrow="Everything in one pass"
          title="A complete picture of your website"
          description="Nine categories of analysis, run in a single audit, scored consistently so you can track them over time."
        />

        <div className="mt-16 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature, index) => (
            <motion.div
              key={feature.title}
              initial="hidden"
              whileInView="visible"
              viewport={viewport}
              variants={rise}
              custom={index % 3}
            >
              <Card variant="default" interactive className="h-full">
                <CardHeader>
                  <div className="mb-3 flex size-11 items-center justify-center rounded-xl bg-[linear-gradient(135deg,hsl(var(--glow-a)/0.14),hsl(var(--glow-b)/0.14))] text-primary">
                    <feature.icon className="size-5" aria-hidden="true" />
                  </div>
                  <CardTitle>{feature.title}</CardTitle>
                  <CardDescription>{feature.description}</CardDescription>
                </CardHeader>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// How it works
// ---------------------------------------------------------------------------

const STEPS = [
  {
    number: '01',
    title: 'Paste your URL',
    description:
      'One field, no configuration, no tracking script to install. We fetch and render the page exactly as a visitor would receive it.',
  },
  {
    number: '02',
    title: 'We run the full analysis',
    description:
      'Lighthouse, axe-core, HTML parsing, header inspection and link checking run in parallel, then AI reviews the rendered page for UX, design and copy.',
  },
  {
    number: '03',
    title: 'Read the report',
    description:
      'Scores per category, every issue with evidence, and an executive summary written for a decision-maker rather than a developer.',
  },
  {
    number: '04',
    title: 'Fix what matters first',
    description:
      'A prioritised list ranked by impact against effort — each item with an explanation, expected result and a realistic time estimate.',
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="relative py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeading
          eyebrow="How it works"
          title="From URL to action plan in about a minute"
          description="No setup, no integration, no waiting for a consultant to get back to you."
        />

        <div className="relative mt-16">
          {/* Connecting rail behind the steps on wide screens. */}
          <div
            className="absolute left-0 right-0 top-7 hidden h-px bg-gradient-to-r from-transparent via-border to-transparent lg:block"
            aria-hidden="true"
          />

          <ol className="grid gap-10 lg:grid-cols-4">
            {STEPS.map((step, index) => (
              <motion.li
                key={step.number}
                initial="hidden"
                whileInView="visible"
                viewport={viewport}
                variants={rise}
                custom={index}
                className="relative"
              >
                <div className="relative z-10 flex size-14 items-center justify-center rounded-2xl border border-border bg-card text-sm font-semibold text-primary shadow-sm">
                  {step.number}
                </div>
                <h3 className="mt-5 text-lg font-semibold tracking-[-0.015em]">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.description}</p>
              </motion.li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// AI features
// ---------------------------------------------------------------------------

const AI_CAPABILITIES = [
  {
    icon: Bot,
    title: 'Plain-English explanations',
    body: 'Every finding is translated out of jargon. "Cumulative Layout Shift is 0.31" becomes "your page jumps around while it loads, and visitors tap the wrong thing".',
  },
  {
    icon: MessageSquare,
    title: 'Chat with your audit',
    body: 'Ask "why is my SEO score low?" or "rewrite my homepage headline" and get answers grounded in your actual results — not generic advice.',
  },
  {
    icon: Layers,
    title: 'Prioritised, not just listed',
    body: 'Every recommendation carries expected impact, difficulty and a time estimate, ranked so the top of the list is genuinely where to start.',
  },
  {
    icon: BarChart3,
    title: 'Competitor context',
    body: 'AI reads the comparison and tells you which gaps are worth closing and which are noise, instead of leaving you with two columns of numbers.',
  },
];

const SAMPLE_CHAT = [
  { role: 'user' as const, text: 'Why is my SEO score only 62?' },
  {
    role: 'assistant' as const,
    text: 'Three things are pulling it down. Your page has no meta description, so Google is writing your search snippet for you. There are two H1 headings, which muddies the topic signal. And there is no structured data, so you are not eligible for rich results while two of your competitors are. The meta description is a ten-minute fix and would have the biggest immediate effect.',
  },
  { role: 'user' as const, text: 'Write me one.' },
  {
    role: 'assistant' as const,
    text: 'Here are three, all inside the 160-character limit:\n\n1. Handmade leather wallets built to last a decade. Free UK delivery, 30-day returns, lifetime repairs.\n2. Full-grain leather wallets, cut and stitched by hand in Bristol. Shipped free, guaranteed for life.\n3. The last wallet you will need to buy. Hand-stitched full-grain leather, lifetime repairs, free returns.',
  },
];

export function AiFeatures() {
  return (
    <section id="ai" className="relative overflow-hidden py-24 sm:py-32">
      <SectionGlow className="-top-32" color="c" />
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeading
          eyebrow="AI-first"
          title={
            <>
              The part other audit tools <span className="text-gradient">leave out</span>
            </>
          }
          description="Most tools hand you a list of numbers. SitePilot tells you what they mean for your business and what to do about them."
        />

        <div className="mt-16 grid items-start gap-12 lg:grid-cols-2">
          <div className="space-y-8">
            {AI_CAPABILITIES.map((capability, index) => (
              <motion.div
                key={capability.title}
                initial="hidden"
                whileInView="visible"
                viewport={viewport}
                variants={rise}
                custom={index}
                className="flex gap-4"
              >
                <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[linear-gradient(135deg,hsl(var(--glow-a)/0.14),hsl(var(--glow-c)/0.14))] text-primary">
                  <capability.icon className="size-5" aria-hidden="true" />
                </div>
                <div>
                  <h3 className="font-semibold tracking-[-0.015em]">{capability.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{capability.body}</p>
                </div>
              </motion.div>
            ))}
          </div>

          <motion.div initial="hidden" whileInView="visible" viewport={viewport} variants={rise}>
            <Card variant="glass" className="overflow-hidden">
              <div className="flex items-center gap-2.5 border-b border-border/60 px-5 py-3.5">
                <Sparkles className="size-4 text-primary" aria-hidden="true" />
                <span className="text-sm font-medium">SitePilot Assistant</span>
                <Badge variant="success" className="ml-auto">
                  Knows your audit
                </Badge>
              </div>

              <div className="space-y-4 p-5">
                {SAMPLE_CHAT.map((message, index) => (
                  <div
                    key={index}
                    className={cn('flex', message.role === 'user' ? 'justify-end' : 'justify-start')}
                  >
                    <div
                      className={cn(
                        'max-w-[85%] whitespace-pre-line rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
                        message.role === 'user'
                          ? 'rounded-br-md bg-primary text-primary-foreground'
                          : 'rounded-bl-md bg-muted text-foreground',
                      )}
                    >
                      {message.text}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

export function Pricing() {
  const [yearly, setYearly] = React.useState(false);

  return (
    <section id="pricing" className="relative py-24 sm:py-32">
      <SectionGlow className="-top-20" color="b" />
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeading
          eyebrow="Pricing"
          title="Start free. Upgrade when it pays for itself."
          description="Every plan includes the full technical audit. Paid plans add the AI report, history, competitor analysis and export."
        />

        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={viewport}
          variants={rise}
          className="mt-10 flex items-center justify-center gap-3"
        >
          <span className={cn('text-sm', !yearly && 'font-medium')}>Monthly</span>
          <Switch checked={yearly} onCheckedChange={setYearly} aria-label="Show yearly pricing" />
          <span className={cn('text-sm', yearly && 'font-medium')}>Yearly</span>
          <Badge variant="success">Save {yearlySavingPercent('PRO')}%</Badge>
        </motion.div>

        <div className="mt-12 grid gap-6 lg:grid-cols-3">
          {PLAN_ORDER.map((planId, index) => {
            const plan = PLANS[planId];
            const price = yearly ? plan.yearlyPriceCents : plan.monthlyPriceCents;
            const isFree = plan.monthlyPriceCents === 0;

            return (
              <motion.div
                key={planId}
                initial="hidden"
                whileInView="visible"
                viewport={viewport}
                variants={rise}
                custom={index}
              >
                <Card
                  variant={plan.highlighted ? 'gradient' : 'default'}
                  className={cn('relative flex h-full flex-col', plan.highlighted && 'lg:-mt-4 lg:mb-4')}
                >
                  {plan.highlighted && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <Badge className="bg-primary text-primary-foreground shadow-lg shadow-primary/25">
                        Most popular
                      </Badge>
                    </div>
                  )}

                  <CardHeader className="pb-4">
                    <CardTitle className="text-lg">{plan.name}</CardTitle>
                    <CardDescription>{plan.tagline}</CardDescription>

                    <div className="pt-5">
                      <span className="text-4xl font-semibold tracking-[-0.03em]">
                        {isFree ? 'Free' : formatCurrency(price)}
                      </span>
                      {!isFree && (
                        <span className="ml-1.5 text-sm text-muted-foreground">
                          /{yearly ? 'year' : 'month'}
                        </span>
                      )}
                    </div>
                  </CardHeader>

                  <CardContent className="flex flex-1 flex-col">
                    <ul className="flex-1 space-y-3">
                      {plan.bullets.map((bullet) => (
                        <li key={bullet} className="flex items-start gap-2.5 text-sm">
                          <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                          <span className="text-muted-foreground">{bullet}</span>
                        </li>
                      ))}
                    </ul>

                    <Button
                      variant={plan.highlighted ? 'gradient' : 'outline'}
                      size="lg"
                      className="mt-8 w-full"
                      asChild
                    >
                      <Link href={isFree ? '/signup' : `/signup?plan=${planId.toLowerCase()}`}>
                        {isFree ? 'Start free' : `Get ${plan.name}`}
                      </Link>
                    </Button>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>

        <p className="mt-8 text-center text-sm text-muted-foreground">
          All prices in USD. Cancel any time — no contract, no exit fee.
        </p>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Testimonials
// ---------------------------------------------------------------------------

/**
 * Placeholder testimonials. These are illustrative examples written to show
 * the layout, using invented names and companies — replace them with real,
 * attributed quotes before launch.
 */
const TESTIMONIALS = [
  {
    quote:
      'We had been guessing at why our landing page converted badly. The audit found the hero image was 3 MB and the CTA was below the fold on every phone. Two fixes, both done in an afternoon.',
    name: 'Priya Raman',
    role: 'Growth lead, Fernway Labs',
  },
  {
    quote:
      'I run audits for every new client during the pitch. Turning up with a branded PDF that already lists what is wrong with their site has won us work we would not otherwise have got.',
    name: 'Tomas Andersen',
    role: 'Founder, Studio Kepler',
  },
  {
    quote:
      'The accessibility pass caught eleven contrast failures our design system had been shipping for a year. Nobody had noticed because nobody was testing computed styles.',
    name: 'Dani Okonkwo',
    role: 'Engineering manager, Copperline',
  },
  {
    quote:
      'Being able to ask the assistant "what should I do first" and get an answer that references my own numbers is the part my team actually uses every week.',
    name: 'Marcus Feld',
    role: 'Head of digital, Meridian Group',
  },
];

export function Testimonials() {
  return (
    <section className="relative py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeading eyebrow="What people say" title="Built for the people who ship the fixes" />

        <div className="mt-16 grid gap-5 sm:grid-cols-2">
          {TESTIMONIALS.map((testimonial, index) => (
            <motion.figure
              key={testimonial.name}
              initial="hidden"
              whileInView="visible"
              viewport={viewport}
              variants={rise}
              custom={index % 2}
            >
              <Card variant="default" className="h-full">
                <CardContent className="pt-6">
                  <blockquote className="text-[0.9375rem] leading-relaxed text-foreground">
                    “{testimonial.quote}”
                  </blockquote>
                  <figcaption className="mt-5 flex items-center gap-3">
                    <span
                      className="flex size-9 items-center justify-center rounded-full bg-[linear-gradient(135deg,hsl(var(--glow-a)/0.22),hsl(var(--glow-b)/0.22))] text-xs font-semibold"
                      aria-hidden="true"
                    >
                      {testimonial.name
                        .split(' ')
                        .map((part) => part[0])
                        .join('')}
                    </span>
                    <span className="text-sm">
                      <span className="font-medium">{testimonial.name}</span>
                      <span className="block text-muted-foreground">{testimonial.role}</span>
                    </span>
                  </figcaption>
                </CardContent>
              </Card>
            </motion.figure>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// FAQ
// ---------------------------------------------------------------------------

const FAQS = [
  {
    question: 'How long does an audit take?',
    answer:
      'A full audit takes 30 to 90 seconds depending on how heavy the page is and how many links need checking. The free preview on the homepage skips the browser rendering and finishes in around 15 seconds.',
  },
  {
    question: 'Do I need to install anything on my website?',
    answer:
      'No. There is no script, no plugin and no DNS change. SitePilot fetches and renders your page from the outside, exactly the way a visitor or a search engine crawler would.',
  },
  {
    question: 'Where do the performance numbers come from?',
    answer:
      'Core Web Vitals come from Google PageSpeed Insights, which runs real Lighthouse on Google infrastructure — the same source Google uses. If PageSpeed is unavailable we fall back to our own measurement and label it clearly so you never mistake an estimate for a lab result.',
  },
  {
    question: 'Is the accessibility testing thorough enough to rely on?',
    answer:
      'We run a full axe-core pass against WCAG 2.2 AA in a real browser, which catches computed-style problems like colour contrast that markup scanners miss. Automated testing finds roughly a third of accessibility barriers, so we say so in every report — manual keyboard and screen-reader testing still matters.',
  },
  {
    question: 'Can I audit a site that is behind a login?',
    answer:
      'Not yet. Audits run against publicly reachable URLs. Authenticated crawling is on the roadmap.',
  },
  {
    question: 'What does the AI actually see?',
    answer:
      'The AI receives a digest of what our analyzers measured — your headings, page text, calls to action, sampled colours and fonts, and every score. It is explicitly instructed to judge only what it is given, so it cannot invent findings that are not in the data.',
  },
  {
    question: 'Can I use this for client work?',
    answer:
      'Yes, that is what the Agency plan is for. Unlimited projects and team members, plus white-label PDF exports carrying your own logo and brand colour rather than ours.',
  },
  {
    question: 'What happens when I cancel?',
    answer:
      'You keep access until the end of the period you have paid for, then drop to the Free plan. Your audit history stays where it is — nothing is deleted.',
  },
];

export function Faq() {
  return (
    <section id="faq" className="relative py-24 sm:py-32">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
        <SectionHeading eyebrow="FAQ" title="Questions, answered" />

        <motion.div initial="hidden" whileInView="visible" viewport={viewport} variants={rise} className="mt-12">
          <Accordion type="single" collapsible className="w-full">
            {FAQS.map((faq, index) => (
              <AccordionItem key={faq.question} value={`item-${index}`}>
                <AccordionTrigger>{faq.question}</AccordionTrigger>
                <AccordionContent>{faq.answer}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </motion.div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Final CTA
// ---------------------------------------------------------------------------

export function FinalCta() {
  return (
    <section className="relative py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <motion.div initial="hidden" whileInView="visible" viewport={viewport} variants={rise}>
          <div className="relative overflow-hidden rounded-3xl border border-border bg-card px-6 py-16 text-center sm:px-16">
            <div
              className="absolute inset-0 bg-[linear-gradient(120deg,hsl(var(--glow-a)/0.12),hsl(var(--glow-c)/0.1)_45%,hsl(var(--glow-b)/0.12))]"
              aria-hidden="true"
            />
            <div className="bg-grid absolute inset-0 opacity-30 [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]" aria-hidden="true" />

            <div className="relative">
              <h2 className="mx-auto max-w-2xl text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">
                Find out what your website is costing you
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
                Three full audits free, no card required. You will know within a minute whether there is
                anything worth fixing.
              </p>

              <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Button variant="gradient" size="xl" asChild>
                  <Link href="/signup">
                    Start free <ArrowRight className="size-4" />
                  </Link>
                </Button>
                <Button variant="outline" size="xl" asChild>
                  <Link href="#pricing">See pricing</Link>
                </Button>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
