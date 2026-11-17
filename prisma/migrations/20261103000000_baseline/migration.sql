-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."AuditCategory" AS ENUM ('SEO', 'PERFORMANCE', 'ACCESSIBILITY', 'UX', 'DESIGN', 'CONTENT', 'SECURITY', 'TECHNICAL');

-- CreateEnum
CREATE TYPE "public"."AuditStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "public"."ChatRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "public"."DeviceStrategy" AS ENUM ('MOBILE', 'DESKTOP');

-- CreateEnum
CREATE TYPE "public"."Difficulty" AS ENUM ('EASY', 'MEDIUM', 'HARD');

-- CreateEnum
CREATE TYPE "public"."MemberRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER');

-- CreateEnum
CREATE TYPE "public"."Plan" AS ENUM ('FREE', 'PRO', 'AGENCY');

-- CreateEnum
CREATE TYPE "public"."Priority" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "public"."RecommendationKind" AS ENUM ('QUICK_WIN', 'LONG_TERM');

-- CreateEnum
CREATE TYPE "public"."RecommendationStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'DONE', 'DISMISSED');

-- CreateEnum
CREATE TYPE "public"."ScreenshotKind" AS ENUM ('DESKTOP_VIEWPORT', 'DESKTOP_FULL', 'MOBILE_VIEWPORT', 'MOBILE_FULL');

-- CreateEnum
CREATE TYPE "public"."Severity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO');

-- CreateEnum
CREATE TYPE "public"."SubscriptionStatus" AS ENUM ('ACTIVE', 'TRIALING', 'PAST_DUE', 'CANCELED', 'INCOMPLETE', 'INCOMPLETE_EXPIRED', 'UNPAID', 'PAUSED');

-- CreateEnum
CREATE TYPE "public"."ThemePreference" AS ENUM ('SYSTEM', 'LIGHT', 'DARK');

-- CreateTable
CREATE TABLE "public"."accessibility_results" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "violationCount" INTEGER NOT NULL DEFAULT 0,
    "passCount" INTEGER NOT NULL DEFAULT 0,
    "incompleteCount" INTEGER NOT NULL DEFAULT 0,
    "criticalCount" INTEGER NOT NULL DEFAULT 0,
    "seriousCount" INTEGER NOT NULL DEFAULT 0,
    "moderateCount" INTEGER NOT NULL DEFAULT 0,
    "minorCount" INTEGER NOT NULL DEFAULT 0,
    "contrastIssues" INTEGER NOT NULL DEFAULT 0,
    "missingAltText" INTEGER NOT NULL DEFAULT 0,
    "missingFormLabels" INTEGER NOT NULL DEFAULT 0,
    "missingAriaLabels" INTEGER NOT NULL DEFAULT 0,
    "headingOrderIssues" INTEGER NOT NULL DEFAULT 0,
    "focusIssues" INTEGER NOT NULL DEFAULT 0,
    "keyboardIssues" INTEGER NOT NULL DEFAULT 0,
    "wcagTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rawViolations" JSONB,

    CONSTRAINT "accessibility_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ai_analyses" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "uxScore" INTEGER NOT NULL,
    "designScore" INTEGER NOT NULL,
    "contentScore" INTEGER NOT NULL,
    "uxFindings" JSONB,
    "designFindings" JSONB,
    "contentFindings" JSONB,
    "model" TEXT NOT NULL,
    "promptTokens" INTEGER,
    "outputTokens" INTEGER,
    "costCents" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ai_reports" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "executiveSummary" TEXT NOT NULL,
    "strengths" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "weaknesses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "longTermOutlook" TEXT,
    "sections" JSONB,
    "model" TEXT NOT NULL,
    "promptTokens" INTEGER,
    "outputTokens" INTEGER,
    "costCents" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."api_keys" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdById" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "hashedKey" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."audits" (
    "id" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "requestedById" UUID,
    "url" TEXT NOT NULL,
    "status" "public"."AuditStatus" NOT NULL DEFAULT 'QUEUED',
    "device" "public"."DeviceStrategy" NOT NULL DEFAULT 'MOBILE',
    "overallScore" INTEGER,
    "previousScore" INTEGER,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "errorMessage" TEXT,
    "warnings" JSONB,
    "pageMeta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."category_scores" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "category" "public"."AuditCategory" NOT NULL,
    "score" INTEGER NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "summary" TEXT,

    CONSTRAINT "category_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."chat_messages" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "role" "public"."ChatRole" NOT NULL,
    "content" TEXT NOT NULL,
    "tokens" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."chat_sessions" (
    "id" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "auditId" TEXT,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."comparison_entries" (
    "id" TEXT NOT NULL,
    "comparisonId" TEXT NOT NULL,
    "auditId" TEXT,
    "competitorId" TEXT,
    "label" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "isSelf" BOOLEAN NOT NULL DEFAULT false,
    "overallScore" INTEGER NOT NULL,
    "seoScore" INTEGER NOT NULL,
    "performanceScore" INTEGER NOT NULL,
    "accessibilityScore" INTEGER NOT NULL,
    "uxScore" INTEGER NOT NULL,
    "designScore" INTEGER NOT NULL,
    "contentScore" INTEGER NOT NULL,
    "securityScore" INTEGER NOT NULL,

    CONSTRAINT "comparison_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."comparisons" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "title" TEXT,
    "aiSummary" TEXT,
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comparisons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."competitors" (
    "id" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "competitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."invoices" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "stripeInvoiceId" TEXT NOT NULL,
    "number" TEXT,
    "amountDue" INTEGER NOT NULL,
    "amountPaid" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "status" TEXT NOT NULL,
    "hostedInvoiceUrl" TEXT,
    "invoicePdfUrl" TEXT,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."issues" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "category" "public"."AuditCategory" NOT NULL,
    "severity" "public"."Severity" NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "evidence" TEXT,
    "helpUrl" TEXT,

    CONSTRAINT "issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."link_records" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "href" TEXT NOT NULL,
    "anchorText" TEXT,
    "isInternal" BOOLEAN NOT NULL,
    "isNofollow" BOOLEAN NOT NULL DEFAULT false,
    "statusCode" INTEGER,
    "isBroken" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "link_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."notifications" (
    "id" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "href" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'system',
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."organization_members" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "role" "public"."MemberRole" NOT NULL DEFAULT 'MEMBER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logoUrl" TEXT,
    "ownerId" UUID NOT NULL,
    "brandColor" TEXT,
    "brandLogoUrl" TEXT,
    "reportFooterText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."performance_results" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'psi',
    "firstContentfulPaint" DOUBLE PRECISION,
    "largestContentfulPaint" DOUBLE PRECISION,
    "cumulativeLayoutShift" DOUBLE PRECISION,
    "totalBlockingTime" DOUBLE PRECISION,
    "speedIndex" DOUBLE PRECISION,
    "timeToInteractive" DOUBLE PRECISION,
    "serverResponseTime" DOUBLE PRECISION,
    "totalBytes" INTEGER,
    "imageBytes" INTEGER,
    "scriptBytes" INTEGER,
    "styleBytes" INTEGER,
    "fontBytes" INTEGER,
    "documentBytes" INTEGER,
    "requestCount" INTEGER,
    "usesCompression" BOOLEAN,
    "usesHttp2" BOOLEAN,
    "usesTextCaching" BOOLEAN,
    "usesModernImages" BOOLEAN,
    "opportunities" JSONB,

    CONSTRAINT "performance_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."projects" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT '#6366f1',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."recommendations" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "category" "public"."AuditCategory" NOT NULL,
    "kind" "public"."RecommendationKind" NOT NULL DEFAULT 'QUICK_WIN',
    "priority" "public"."Priority" NOT NULL,
    "status" "public"."RecommendationStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "expectedImpact" TEXT NOT NULL,
    "difficulty" "public"."Difficulty" NOT NULL,
    "estimatedMinutes" INTEGER NOT NULL,
    "impactScore" INTEGER NOT NULL DEFAULT 50,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."screenshots" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "kind" "public"."ScreenshotKind" NOT NULL,
    "url" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "bytes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "screenshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."seo_results" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "title" TEXT,
    "titleLength" INTEGER,
    "metaDescription" TEXT,
    "descriptionLength" INTEGER,
    "canonicalUrl" TEXT,
    "robotsDirectives" TEXT,
    "indexable" BOOLEAN NOT NULL DEFAULT true,
    "lang" TEXT,
    "h1Count" INTEGER NOT NULL DEFAULT 0,
    "h2Count" INTEGER NOT NULL DEFAULT 0,
    "h3Count" INTEGER NOT NULL DEFAULT 0,
    "headingOutline" JSONB,
    "wordCount" INTEGER NOT NULL DEFAULT 0,
    "readingTimeSec" INTEGER NOT NULL DEFAULT 0,
    "keywordDensity" JSONB,
    "duplicateContentRatio" DOUBLE PRECISION,
    "imageCount" INTEGER NOT NULL DEFAULT 0,
    "imagesMissingAlt" INTEGER NOT NULL DEFAULT 0,
    "hasOpenGraph" BOOLEAN NOT NULL DEFAULT false,
    "hasTwitterCard" BOOLEAN NOT NULL DEFAULT false,
    "hasStructuredData" BOOLEAN NOT NULL DEFAULT false,
    "structuredDataTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "hasSitemap" BOOLEAN NOT NULL DEFAULT false,
    "sitemapUrl" TEXT,
    "hasRobotsTxt" BOOLEAN NOT NULL DEFAULT false,
    "urlDepth" INTEGER NOT NULL DEFAULT 0,
    "urlIsReadable" BOOLEAN NOT NULL DEFAULT true,
    "internalLinkCount" INTEGER NOT NULL DEFAULT 0,
    "externalLinkCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "seo_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."subscriptions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "plan" "public"."Plan" NOT NULL DEFAULT 'FREE',
    "status" "public"."SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "stripePriceId" TEXT,
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "canceledAt" TIMESTAMP(3),
    "trialEndsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."technical_results" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "httpsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "sslValid" BOOLEAN,
    "sslIssuer" TEXT,
    "sslExpiresAt" TIMESTAMP(3),
    "hstsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "cspEnabled" BOOLEAN NOT NULL DEFAULT false,
    "xFrameOptions" BOOLEAN NOT NULL DEFAULT false,
    "xContentTypeOptions" BOOLEAN NOT NULL DEFAULT false,
    "referrerPolicy" BOOLEAN NOT NULL DEFAULT false,
    "permissionsPolicy" BOOLEAN NOT NULL DEFAULT false,
    "securityScore" INTEGER NOT NULL DEFAULT 0,
    "statusCode" INTEGER,
    "redirectCount" INTEGER NOT NULL DEFAULT 0,
    "redirectChain" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "hasCanonical" BOOLEAN NOT NULL DEFAULT false,
    "canonicalSelfReferencing" BOOLEAN,
    "totalLinks" INTEGER NOT NULL DEFAULT 0,
    "brokenLinks" INTEGER NOT NULL DEFAULT 0,
    "internalLinks" INTEGER NOT NULL DEFAULT 0,
    "externalLinks" INTEGER NOT NULL DEFAULT 0,
    "nofollowLinks" INTEGER NOT NULL DEFAULT 0,
    "scriptCount" INTEGER NOT NULL DEFAULT 0,
    "stylesheetCount" INTEGER NOT NULL DEFAULT 0,
    "inlineScriptCount" INTEGER NOT NULL DEFAULT 0,
    "renderBlockingCount" INTEGER NOT NULL DEFAULT 0,
    "detectedTech" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "technical_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."usage_records" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "auditsRun" INTEGER NOT NULL DEFAULT 0,
    "aiReports" INTEGER NOT NULL DEFAULT 0,
    "aiChatMessages" INTEGER NOT NULL DEFAULT 0,
    "pdfExports" INTEGER NOT NULL DEFAULT 0,
    "competitorRuns" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usage_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."user_settings" (
    "id" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "theme" "public"."ThemePreference" NOT NULL DEFAULT 'SYSTEM',
    "weeklyDigest" BOOLEAN NOT NULL DEFAULT true,
    "auditCompleteEmails" BOOLEAN NOT NULL DEFAULT true,
    "productUpdates" BOOLEAN NOT NULL DEFAULT false,
    "defaultDevice" "public"."DeviceStrategy" NOT NULL DEFAULT 'MOBILE',
    "locale" TEXT NOT NULL DEFAULT 'en',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "avatarUrl" TEXT,
    "emailVerified" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."websites" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "label" TEXT,
    "faviconUrl" TEXT,
    "monitoringEnabled" BOOLEAN NOT NULL DEFAULT false,
    "monitoringCron" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "websites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accessibility_results_auditId_key" ON "public"."accessibility_results"("auditId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ai_analyses_auditId_key" ON "public"."ai_analyses"("auditId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ai_reports_auditId_key" ON "public"."ai_reports"("auditId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_hashedKey_key" ON "public"."api_keys"("hashedKey" ASC);

-- CreateIndex
CREATE INDEX "api_keys_organizationId_idx" ON "public"."api_keys"("organizationId" ASC);

-- CreateIndex
CREATE INDEX "audits_status_createdAt_idx" ON "public"."audits"("status" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "audits_websiteId_createdAt_idx" ON "public"."audits"("websiteId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "category_scores_auditId_category_key" ON "public"."category_scores"("auditId" ASC, "category" ASC);

-- CreateIndex
CREATE INDEX "chat_messages_sessionId_createdAt_idx" ON "public"."chat_messages"("sessionId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "chat_sessions_userId_updatedAt_idx" ON "public"."chat_sessions"("userId" ASC, "updatedAt" ASC);

-- CreateIndex
CREATE INDEX "comparison_entries_comparisonId_idx" ON "public"."comparison_entries"("comparisonId" ASC);

-- CreateIndex
CREATE INDEX "comparisons_organizationId_createdAt_idx" ON "public"."comparisons"("organizationId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "comparisons_websiteId_createdAt_idx" ON "public"."comparisons"("websiteId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "competitors_websiteId_url_key" ON "public"."competitors"("websiteId" ASC, "url" ASC);

-- CreateIndex
CREATE INDEX "invoices_organizationId_createdAt_idx" ON "public"."invoices"("organizationId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "invoices_stripeInvoiceId_key" ON "public"."invoices"("stripeInvoiceId" ASC);

-- CreateIndex
CREATE INDEX "issues_auditId_category_idx" ON "public"."issues"("auditId" ASC, "category" ASC);

-- CreateIndex
CREATE INDEX "issues_auditId_severity_idx" ON "public"."issues"("auditId" ASC, "severity" ASC);

-- CreateIndex
CREATE INDEX "link_records_auditId_isBroken_idx" ON "public"."link_records"("auditId" ASC, "isBroken" ASC);

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_createdAt_idx" ON "public"."notifications"("userId" ASC, "readAt" ASC, "createdAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "organization_members_organizationId_userId_key" ON "public"."organization_members"("organizationId" ASC, "userId" ASC);

-- CreateIndex
CREATE INDEX "organization_members_userId_idx" ON "public"."organization_members"("userId" ASC);

-- CreateIndex
CREATE INDEX "organizations_ownerId_idx" ON "public"."organizations"("ownerId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "public"."organizations"("slug" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "performance_results_auditId_key" ON "public"."performance_results"("auditId" ASC);

-- CreateIndex
CREATE INDEX "projects_organizationId_archived_idx" ON "public"."projects"("organizationId" ASC, "archived" ASC);

-- CreateIndex
CREATE INDEX "recommendations_auditId_priority_sortOrder_idx" ON "public"."recommendations"("auditId" ASC, "priority" ASC, "sortOrder" ASC);

-- CreateIndex
CREATE INDEX "screenshots_auditId_idx" ON "public"."screenshots"("auditId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "seo_results_auditId_key" ON "public"."seo_results"("auditId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_organizationId_key" ON "public"."subscriptions"("organizationId" ASC);

-- CreateIndex
CREATE INDEX "subscriptions_stripeCustomerId_idx" ON "public"."subscriptions"("stripeCustomerId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_stripeCustomerId_key" ON "public"."subscriptions"("stripeCustomerId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_stripeSubscriptionId_key" ON "public"."subscriptions"("stripeSubscriptionId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "technical_results_auditId_key" ON "public"."technical_results"("auditId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "usage_records_organizationId_periodStart_key" ON "public"."usage_records"("organizationId" ASC, "periodStart" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "user_settings_userId_key" ON "public"."user_settings"("userId" ASC);

-- CreateIndex
CREATE INDEX "users_createdAt_idx" ON "public"."users"("createdAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "public"."users"("email" ASC);

-- CreateIndex
CREATE INDEX "websites_domain_idx" ON "public"."websites"("domain" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "websites_projectId_url_key" ON "public"."websites"("projectId" ASC, "url" ASC);

-- AddForeignKey
ALTER TABLE "public"."accessibility_results" ADD CONSTRAINT "accessibility_results_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "public"."audits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ai_analyses" ADD CONSTRAINT "ai_analyses_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "public"."audits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ai_reports" ADD CONSTRAINT "ai_reports_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "public"."audits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."api_keys" ADD CONSTRAINT "api_keys_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."api_keys" ADD CONSTRAINT "api_keys_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."audits" ADD CONSTRAINT "audits_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."audits" ADD CONSTRAINT "audits_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "public"."websites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."category_scores" ADD CONSTRAINT "category_scores_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "public"."audits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."chat_messages" ADD CONSTRAINT "chat_messages_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "public"."chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."chat_sessions" ADD CONSTRAINT "chat_sessions_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "public"."audits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."chat_sessions" ADD CONSTRAINT "chat_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."comparison_entries" ADD CONSTRAINT "comparison_entries_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "public"."audits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."comparison_entries" ADD CONSTRAINT "comparison_entries_comparisonId_fkey" FOREIGN KEY ("comparisonId") REFERENCES "public"."comparisons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."comparison_entries" ADD CONSTRAINT "comparison_entries_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "public"."competitors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."competitors" ADD CONSTRAINT "competitors_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "public"."websites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."invoices" ADD CONSTRAINT "invoices_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."issues" ADD CONSTRAINT "issues_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "public"."audits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."link_records" ADD CONSTRAINT "link_records_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "public"."audits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."organization_members" ADD CONSTRAINT "organization_members_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."organization_members" ADD CONSTRAINT "organization_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."organizations" ADD CONSTRAINT "organizations_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."performance_results" ADD CONSTRAINT "performance_results_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "public"."audits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."projects" ADD CONSTRAINT "projects_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."recommendations" ADD CONSTRAINT "recommendations_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "public"."audits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."screenshots" ADD CONSTRAINT "screenshots_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "public"."audits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."seo_results" ADD CONSTRAINT "seo_results_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "public"."audits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."subscriptions" ADD CONSTRAINT "subscriptions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."technical_results" ADD CONSTRAINT "technical_results_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "public"."audits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."usage_records" ADD CONSTRAINT "usage_records_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_settings" ADD CONSTRAINT "user_settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."websites" ADD CONSTRAINT "websites_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
