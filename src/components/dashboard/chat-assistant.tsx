'use client';

import * as React from 'react';

import Link from 'next/link';
import { ArrowUp, Bot, Loader2, Lock, Sparkles } from 'lucide-react';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { SUGGESTED_QUESTIONS } from '@/features/ai/chat';
import { cn, initialsOf } from '@/lib/utils';
import { displayUrl } from '@/lib/url';

/**
 * Chat UI.
 *
 * The stream is NDJSON — one JSON object per line — rather than SSE, because
 * the payload includes a metadata frame (the session id) alongside text
 * deltas, and a line-delimited format handles mixed frame types without the
 * event-name ceremony SSE requires.
 *
 * Partial lines are buffered across chunks: a network chunk boundary lands
 * mid-JSON often enough that parsing per-chunk would corrupt roughly one
 * message in ten.
 */

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

interface ChatAssistantProps {
  auditId: string | null;
  auditUrl: string | null;
  auditScore: number | null;
  initialSessionId: string | null;
  initialMessages: Message[];
  enabled: boolean;
  userName: string | null;
}

export function ChatAssistant({
  auditId,
  auditUrl,
  auditScore,
  initialSessionId,
  initialMessages,
  enabled,
  userName,
}: ChatAssistantProps) {
  const [messages, setMessages] = React.useState<Message[]>(initialMessages);
  const [input, setInput] = React.useState('');
  const [streaming, setStreaming] = React.useState(false);
  const [sessionId, setSessionId] = React.useState(initialSessionId);
  const [error, setError] = React.useState<string | null>(null);

  const scrollRef = React.useRef<HTMLDivElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, streaming]);

  function autoResize() {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${Math.min(node.scrollHeight, 200)}px`;
  }

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || streaming) return;

    setError(null);
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    const userMessage: Message = { id: crypto.randomUUID(), role: 'user', content: trimmed };
    const assistantId = crypto.randomUUID();

    setMessages((current) => [
      ...current,
      userMessage,
      { id: assistantId, role: 'assistant', content: '' },
    ]);
    setStreaming(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed, auditId, sessionId }),
      });

      if (!response.ok || !response.body) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? 'The assistant is unavailable right now.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        // The last element is either empty or a partial line; keep it buffered.
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;

          let frame: { type: string; value?: string; sessionId?: string; message?: string };
          try {
            frame = JSON.parse(line);
          } catch {
            continue;
          }

          if (frame.type === 'meta' && frame.sessionId) {
            setSessionId(frame.sessionId);
          } else if (frame.type === 'delta' && frame.value) {
            const delta = frame.value;
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantId ? { ...message, content: message.content + delta } : message,
              ),
            );
          } else if (frame.type === 'error') {
            setError(frame.message ?? 'The assistant stopped responding.');
          }
        }
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong.');
      // Drop the empty assistant bubble so the error isn't shown under a
      // blank reply.
      setMessages((current) =>
        current.filter((message) => !(message.id === assistantId && message.content === '')),
      );
    } finally {
      setStreaming(false);
    }
  }

  if (!enabled) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center py-16 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
            <Lock className="size-5" aria-hidden="true" />
          </span>
          <h2 className="mt-5 text-lg font-semibold">The AI assistant is a Pro feature</h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
            Ask questions about your audit, get rewrites for your copy, and find out what to prioritise —
            all grounded in your own results.
          </p>
          <Button variant="gradient" size="lg" className="mt-6" asChild>
            <Link href="/dashboard/billing">Upgrade to Pro</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="flex h-[calc(100dvh-13rem)] flex-col overflow-hidden">
      {auditUrl && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-5 py-3">
          <Sparkles className="size-4 text-primary" aria-hidden="true" />
          <span className="text-sm text-muted-foreground">Grounded in your audit of</span>
          <span className="font-mono text-sm">{displayUrl(auditUrl, 36)}</span>
          {auditScore != null && <Badge variant="secondary">{auditScore}/100</Badge>}
        </div>
      )}

      <div ref={scrollRef} className="flex-1 space-y-6 overflow-y-auto p-5" aria-live="polite">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,hsl(var(--glow-a)/0.18),hsl(var(--glow-b)/0.18))] text-primary">
              <Bot className="size-5" aria-hidden="true" />
            </span>
            <h2 className="mt-5 font-semibold">
              {auditUrl ? 'Ask me about your audit' : 'Run an audit to get started'}
            </h2>
            <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
              {auditUrl
                ? 'I have your latest results in front of me — scores, issues and the page content.'
                : 'Once you have run an audit I can answer questions about it and rewrite your copy.'}
            </p>

            {auditUrl && (
              <div className="mt-7 grid w-full max-w-lg gap-2 sm:grid-cols-2">
                {SUGGESTED_QUESTIONS.map((question) => (
                  <button
                    key={question}
                    type="button"
                    onClick={() => void send(question)}
                    className="rounded-xl border border-border px-3.5 py-2.5 text-left text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {question}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              userName={userName}
              streaming={streaming && message.role === 'assistant' && message.content === ''}
            />
          ))
        )}

        {error && (
          <p role="alert" className="rounded-xl border border-destructive/25 bg-destructive/[0.06] p-3 text-sm text-destructive">
            {error}
          </p>
        )}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send(input);
        }}
        className="shrink-0 border-t border-border p-4"
      >
        <div className="flex items-end gap-2 rounded-xl border border-input bg-background p-2 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/40">
          <label htmlFor="chat-input" className="sr-only">
            Message the assistant
          </label>
          <textarea
            id="chat-input"
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={(event) => {
              setInput(event.target.value);
              autoResize();
            }}
            onKeyDown={(event) => {
              // Enter sends, Shift-Enter breaks the line — the convention
              // every chat interface uses.
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void send(input);
              }
            }}
            placeholder={auditUrl ? 'Ask about your audit…' : 'Ask a question…'}
            disabled={streaming}
            className="max-h-48 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-60"
          />
          <Button
            type="submit"
            size="icon-sm"
            variant="gradient"
            disabled={!input.trim() || streaming}
            aria-label="Send message"
          >
            {streaming ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
          </Button>
        </div>
        <p className="mt-2 px-1 text-xs text-muted-foreground">
          Answers come from your audit data. Verify anything you are about to act on.
        </p>
      </form>
    </Card>
  );
}

function MessageBubble({
  message,
  userName,
  streaming,
}: {
  message: Message;
  userName: string | null;
  streaming: boolean;
}) {
  const isUser = message.role === 'user';

  return (
    <div className={cn('flex gap-3', isUser && 'flex-row-reverse')}>
      <Avatar className="size-8 shrink-0">
        <AvatarFallback className={cn('text-[0.625rem]', !isUser && 'bg-primary/12 text-primary')}>
          {isUser ? initialsOf(userName) : <Bot className="size-4" aria-hidden="true" />}
        </AvatarFallback>
      </Avatar>

      <div
        className={cn(
          'max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
          isUser ? 'rounded-br-md bg-primary text-primary-foreground' : 'rounded-bl-md bg-muted',
        )}
      >
        {streaming ? (
          <span className="flex gap-1 py-1" aria-label="The assistant is typing">
            {[0, 1, 2].map((index) => (
              <span
                key={index}
                className="size-1.5 animate-bounce rounded-full bg-muted-foreground/50"
                style={{ animationDelay: `${index * 140}ms` }}
              />
            ))}
          </span>
        ) : (
          <MessageContent content={message.content} />
        )}
      </div>
    </div>
  );
}

/**
 * Minimal markdown rendering: paragraphs, list items and bold.
 *
 * Deliberately not a full markdown parser. The model is prompted to keep
 * formatting light, and hand-rolling the three constructs it actually uses
 * avoids shipping a parser — plus every fragment goes through React's own
 * escaping, so model output can never inject markup.
 */
function MessageContent({ content }: { content: string }) {
  const blocks = content.split(/\n{2,}/);

  return (
    <div className="space-y-2.5">
      {blocks.map((block, blockIndex) => {
        const lines = block.split('\n');
        const isList = lines.every((line) => /^\s*(?:[-*•]|\d+\.)\s+/.test(line));

        if (isList) {
          return (
            <ul key={blockIndex} className="space-y-1 pl-4">
              {lines.map((line, lineIndex) => (
                <li key={lineIndex} className="list-disc">
                  <Inline text={line.replace(/^\s*(?:[-*•]|\d+\.)\s+/, '')} />
                </li>
              ))}
            </ul>
          );
        }

        return (
          <p key={blockIndex}>
            {lines.map((line, lineIndex) => (
              <React.Fragment key={lineIndex}>
                {lineIndex > 0 && <br />}
                <Inline text={line} />
              </React.Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);

  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={index}>{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
          return (
            <code key={index} className="rounded bg-background/60 px-1 py-0.5 font-mono text-xs">
              {part.slice(1, -1)}
            </code>
          );
        }
        return <React.Fragment key={index}>{part}</React.Fragment>;
      })}
    </>
  );
}
