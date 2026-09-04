# WebDataScout

AI-powered website auditing. Runs a full technical audit — SEO, Core Web Vitals,
accessibility, security, link health — then uses an LLM to judge UX, design and
content, explain every finding in plain English, and rank the fixes by impact
against effort.

Built with Next.js 15 (App Router), React 19, TypeScript, Prisma/PostgreSQL,
Supabase Auth, Tailwind CSS v4 and Stripe.

---

## Quick start

```bash
npm install
cp .env.example .env.local     # fill in DATABASE_URL at minimum
npm run db:migrate             # creates the schema
npm run db:seed                # optional: demo workspace with 3 months of history
npm run dev
```

The app boots with only `DATABASE_URL` set. Every integration beyond the
database is optional and degrades individually — see
[Progressive configuration](#progressive-configuration).

---

## Architecture

```
src/
├── app/                    Routes only — thin, delegating to features/
│   ├── (marketing)/        Landing, pricing, legal
│   ├── (auth)/             Sign in, sign up, password reset
│   ├── dashboard/          Authenticated app (force-dynamic)
│   ├── api/                Streaming chat, report export, Stripe webhook
│   └── auth/callback/      OAuth + email-link exchange
├── features/               Feature modules — the actual product logic
│   ├── audit/              Engine, analyzers, persistence, actions, queries
│   ├── ai/                 OpenAI client, prompts, analysis, report, chat
│   ├── auth/               Session, provisioning, auth actions
│   ├── billing/            Plans, quota enforcement, Stripe
│   ├── competitors/        Comparison runs
│   ├── projects/           Project and website CRUD
│   ├── reports/            PDF/HTML export
│   └── settings/           Preferences, workspace, account deletion
├── components/
│   ├── ui/                 Radix-based primitives
│   ├── marketing/          Landing sections
│   ├── dashboard/          App surfaces
│   ├── charts/             Recharts wrappers
│   └── shared/             Cross-cutting (score ring, empty state, …)
├── config/                 Plan catalogue, scoring model
└── lib/                    db, env, errors, logger, http, url, rate limiting
```

Each `features/*` module follows the same layout: `actions.ts` (`'use server'`
mutations), `queries.ts` (server-only reads), `schemas.ts` (Zod contracts) and
domain logic. Route files stay thin; nothing in `app/` contains business logic.

### The audit engine

`features/audit/engine.ts` orchestrates one run:

1. **Fetch** the page through the SSRF-guarded HTTP client. Fatal on failure —
   nothing else can proceed.
2. **In parallel:** headless-browser capture (axe-core, screenshots, computed
   styles) alongside the network-bound analyzers (PageSpeed, link probing).
3. **Synchronously:** SEO, security, content and accessibility analyzers, which
   are pure functions of the assembled `PageContext`.
4. **AI pass** judges UX, design and content from a digest of every
   deterministic result.
5. **Report** generation merges AI recommendations with rule-based ones,
   de-duplicated and ranked.

Every stage after the fetch is individually recoverable. A PageSpeed outage, a
Chromium crash or an OpenAI rate limit each degrade the report and record a
warning shown in the UI, rather than failing the run.

Analyzers never touch the database and never call each other. That is what
makes them testable against an HTML fixture with no network — see
`tests/analyzers.test.ts`.

### Scoring

Every analyzer emits 0-100. The overall score is their weighted mean, with SEO
and performance carrying the most weight. Categories that failed to run are
dropped from the mean rather than counted as zero.

Performance uses Lighthouse's log-normal curve (`config/scoring.ts`), so a
synthetic run without a PageSpeed key lands on the same scale as a real PSI
result and history stays comparable across sources.

---

## Progressive configuration

| Variable | Without it |
|---|---|
| `DATABASE_URL` | **Required.** Nothing works. |
| `NEXT_PUBLIC_SUPABASE_URL` + `_ANON_KEY` | Marketing site renders; sign-in unavailable. |
| `OPENAI_API_KEY` | Audits produce six deterministic categories instead of eight, with a rule-based report. No chat. |
| `GOOGLE_PAGESPEED_API_KEY` | Performance falls back to a synthetic estimate, labelled as such in the UI. |
| `CHROMIUM_EXECUTABLE_PATH` | No axe-core run, no screenshots, no visual profile. Accessibility drops to a static scan and says so. PDF export returns printable HTML. |
| `STRIPE_SECRET_KEY` | Everyone stays on Free; the billing page explains why. |

This is deliberate: a contributor with just Postgres gets a working app, and a
production outage in any one provider degrades one feature rather than the
product.

---

## Security

The parts worth reviewing carefully:

- **SSRF.** The service fetches arbitrary user-supplied URLs. `lib/url.ts`
  rejects non-HTTP schemes, embedded credentials, and private/link-local/
  loopback hostnames. `lib/http.ts` additionally resolves the hostname and
  re-checks the resolved addresses before connecting, closing the DNS-rebinding
  hole, and caps body size, timeout and redirect depth.
- **Tenancy.** Every query filters by `organizationId` in its `WHERE` clause,
  joined through Website → Project → Organization. Mutations use `updateMany`
  with the tenancy filter, so a forged id updates zero rows rather than someone
  else's data.
- **Prompt injection.** Page content is untrusted. It reaches the model inside
  a fenced block with an explicit instruction that its contents are data to
  analyse, never instructions to follow.
- **Server action surface.** Every export from a `'use server'` module is a
  public RPC endpoint. Read functions that take an id live in `queries.ts`
  instead, so they cannot be called from a browser.
- **Stripe webhook.** Signature verified against the untouched raw body; the
  middleware excludes the path so nothing parses it first. Handlers are
  idempotent full-state upserts, since Stripe retries and delivers out of order.
- **Quota.** Enforced with a conditional increment inside a transaction, so two
  concurrent requests cannot both spend the last credit.
- **Open redirect.** `next` parameters on login and the OAuth callback are
  validated as same-origin relative paths.

---

## Accessibility

WCAG 2.2 AA is a build target, not just something the product measures:

- One focus treatment applied globally; `:focus-visible` is restyled, never
  removed.
- Score bands pair colour with a numeric value and a text label, so colour
  never carries meaning alone.
- Every chart ships a screen-reader summary of its underlying numbers next to
  the SVG.
- All animation respects `prefers-reduced-motion` through a global rule.
- Dialogs, menus and tabs are Radix primitives with correct focus management.

---

## Commands

```bash
npm run dev          # development server
npm run build        # prisma generate + production build
npm run typecheck    # tsc --noEmit
npm run test         # vitest (133 tests, no network or database needed)
npm run db:migrate   # create/apply a migration
npm run db:studio    # browse the database
npm run db:seed      # demo workspace with 3 months of audit history
```

---

## Deployment

Designed for Vercel + Supabase.

1. Set every variable from `.env.example` in the Vercel project.
2. Point `DATABASE_URL` at the pooled (PgBouncer) connection and `DIRECT_URL`
   at the direct one — Prisma migrations need the direct connection.
3. Add `https://your-domain/auth/callback` to Supabase's redirect allow-list.
4. Add a Stripe webhook for `https://your-domain/api/webhooks/stripe`
   subscribing to `checkout.session.completed`, `customer.subscription.*` and
   `invoice.*`.
5. For screenshots and axe-core on serverless, set `CHROMIUM_EXECUTABLE_PATH`
   to a Lambda-compatible Chromium build.

Audits run inline in a server action, so `maxDuration` needs to accommodate a
30-90 second run. The seam for moving to a job queue is narrow —
`startAuditAction` would enqueue instead of awaiting `executeAudit`, and
nothing else changes.

---

## Roadmap

The schema and module boundaries already accommodate: scheduled audits and
email reports (`Website.monitoringCron`, `UserSettings.weeklyDigest`), team
collaboration (`OrganizationMember` roles), a public API (`ApiKey`, Agency
plan), and keyword tracking. Adding any of these means new modules under
`features/`, not reshaping existing tables.

---

## Known gaps

Stated plainly rather than left to be discovered:

- **Audits run inline**, not through a queue. Fine to ~90 seconds; a very slow
  site on a platform with a short function timeout will fail.
- **Screenshots are stored as data URLs** in Postgres. `storeScreenshot()` in
  `features/audit/persist.ts` is the single seam for moving them to object
  storage.
- **Rate limiting is per-instance**, in memory. It sheds load cheaply; the
  durable protection is the Postgres quota counter. Swapping in Redis means
  reimplementing `consume()` only.
- **Legal pages are marked placeholders** and say so on the page. They outline
  what a real policy must cover; they have not been reviewed by a lawyer.
- **Marketing testimonials and customer logos are clearly-labelled
  placeholders** using invented names, so nothing implies an endorsement that
  does not exist.
- **Authenticated-page auditing** is not supported; targets must be publicly
  reachable.
- **Team invitations** have a schema (`OrganizationMember`) but no invite flow
  yet — every workspace currently has one member.
