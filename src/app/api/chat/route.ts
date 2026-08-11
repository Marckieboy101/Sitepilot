import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { isAppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/rate-limit';
import { requireSession } from '@/features/auth/session';
import { consumeQuota, requireFeature } from '@/features/billing/quota';
import { aiAvailable, streamText } from '@/features/ai/client';
import {
  appendMessage,
  buildGroundedPrompt,
  ensureSessionTitle,
  loadHistory,
  resolveChatSession,
} from '@/features/ai/chat';
import { CHAT_SYSTEM_PROMPT } from '@/features/ai/prompts';

/**
 * Streaming chat endpoint.
 *
 * A route handler rather than a server action, because server actions cannot
 * stream a response — and a chat that waits ten seconds then dumps a wall of
 * text feels broken regardless of how good the answer is.
 *
 * The assistant's reply is persisted after the stream completes. If the client
 * disconnects mid-stream we still write what was generated: the user paid a
 * message credit for it, and losing a half-written answer on a flaky connection
 * is worse than showing a truncated one.
 */

const log = logger.child({ module: 'api/chat' });

export const maxDuration = 60;

const bodySchema = z.object({
  message: z.string().min(1).max(4000),
  auditId: z.string().cuid().nullish(),
  sessionId: z.string().cuid().nullish(),
});

export async function POST(request: NextRequest) {
  try {
    const session = await requireSession();
    enforceRateLimit(`chat:${session.userId}`, RATE_LIMITS.aiChat);

    await requireFeature(session.organizationId, 'aiChat');

    if (!aiAvailable()) {
      return NextResponse.json(
        { error: 'The AI assistant is not configured on this deployment.' },
        { status: 503 },
      );
    }

    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'Send a message between 1 and 4000 characters.' }, { status: 422 });
    }

    const { message, auditId, sessionId } = parsed.data;

    await consumeQuota(session.organizationId, 'aiChatMessages');

    const chatSession = await resolveChatSession({
      userId: session.userId,
      auditId: auditId ?? null,
      sessionId: sessionId ?? undefined,
    });

    // Grounding is rebuilt per request, so re-running an audit immediately
    // changes what the assistant knows.
    const grounded = chatSession.auditId
      ? await buildGroundedPrompt(chatSession.auditId, session.organizationId)
      : null;

    const history = await loadHistory(chatSession.id);

    await appendMessage({ sessionId: chatSession.id, role: 'USER', content: message });
    await ensureSessionTitle(chatSession.id, message);

    const encoder = new TextEncoder();
    let assembled = '';

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        // The session id goes out first so a brand-new conversation can be
        // continued by the client without a second round trip.
        controller.enqueue(
          encoder.encode(`${JSON.stringify({ type: 'meta', sessionId: chatSession.id })}\n`),
        );

        try {
          for await (const delta of streamText({
            system: grounded?.systemPrompt ?? CHAT_SYSTEM_PROMPT,
            messages: [...history, { role: 'user', content: message }],
            temperature: 0.6,
            maxTokens: 1600,
          })) {
            assembled += delta;
            controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'delta', value: delta })}\n`));
          }
        } catch (error) {
          log.error('chat stream failed', { error });
          controller.enqueue(
            encoder.encode(
              `${JSON.stringify({ type: 'error', message: 'The assistant stopped responding. Please try again.' })}\n`,
            ),
          );
        } finally {
          if (assembled.trim()) {
            await appendMessage({
              sessionId: chatSession.id,
              role: 'ASSISTANT',
              content: assembled,
            }).catch((error) => log.error('could not persist assistant reply', { error }));
          }
          controller.close();
        }
      },
    });

    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-store, no-transform',
        // Stops nginx and similar proxies from buffering the stream into one
        // response, which would defeat the point entirely.
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    if (isAppError(error)) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    log.error('chat request failed', { error });
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 });
  }
}
