import type { Metadata } from 'next';

import { ChatAssistant } from '@/components/dashboard/chat-assistant';
import { PageHeader } from '@/components/shared/page-header';
import { PLANS } from '@/config/plans';
import { requireSession } from '@/features/auth/session';
import { getLatestAudit } from '@/features/audit/queries';
import { getEntitlements } from '@/features/billing/quota';
import { db } from '@/lib/db';

export const metadata: Metadata = { title: 'AI assistant' };

export default async function AssistantPage() {
  const session = await requireSession();

  const [entitlements, latestAudit] = await Promise.all([
    getEntitlements(session.organizationId),
    getLatestAudit(session.organizationId),
  ]);

  const enabled = PLANS[entitlements.plan].features.aiChat;

  // Resume the most recent conversation for this audit rather than starting
  // fresh each visit — the history is the point of a grounded assistant.
  const existingSession = latestAudit
    ? await db.chatSession.findFirst({
        where: { userId: session.userId, auditId: latestAudit.id },
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          messages: {
            orderBy: { createdAt: 'asc' },
            take: 50,
            select: { id: true, role: true, content: true },
          },
        },
      })
    : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI assistant"
        description="Ask anything about your latest audit. It has your scores, issues and page content in context."
      />

      <ChatAssistant
        auditId={latestAudit?.id ?? null}
        auditUrl={latestAudit?.url ?? null}
        auditScore={latestAudit?.overallScore ?? null}
        initialSessionId={existingSession?.id ?? null}
        initialMessages={
          existingSession?.messages
            .filter((message) => message.role === 'USER' || message.role === 'ASSISTANT')
            .map((message) => ({
              id: message.id,
              role: message.role === 'USER' ? ('user' as const) : ('assistant' as const),
              content: message.content,
            })) ?? []
        }
        enabled={enabled}
        userName={session.name}
      />
    </div>
  );
}
