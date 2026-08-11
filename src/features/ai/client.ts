import OpenAI from 'openai';
import type { z } from 'zod';

import { serverEnv } from '@/lib/env';
import { errors } from '@/lib/errors';
import { logger } from '@/lib/logger';

/**
 * OpenAI access layer.
 *
 * Everything the product does with the model goes through `completeJson` or
 * `streamText` so that retries, token accounting, timeouts and schema
 * validation are implemented once. In particular, model output is *always*
 * parsed through a Zod schema before it reaches the database or the UI — an
 * LLM that returns a field as a string instead of a number should surface as
 * a clean validation failure, not a runtime crash three layers away.
 */

const log = logger.child({ module: 'ai/client' });

let cached: OpenAI | null = null;

export function openai(): OpenAI {
  if (cached) return cached;

  const apiKey = serverEnv().OPENAI_API_KEY;
  if (!apiKey) {
    throw errors.configuration('AI features require OPENAI_API_KEY to be configured.');
  }

  cached = new OpenAI({ apiKey, maxRetries: 0, timeout: 120_000 });
  return cached;
}

export function aiAvailable(): boolean {
  return Boolean(serverEnv().OPENAI_API_KEY);
}

export function defaultModel(): string {
  return serverEnv().OPENAI_MODEL;
}

export function fastModel(): string {
  return serverEnv().OPENAI_MODEL_FAST;
}

/**
 * Published per-million-token prices, used for the cost figures shown to
 * Agency customers. Unknown models fall back to the gpt-4o rate rather than
 * reporting zero, so an unmapped model never looks free.
 */
const PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4.1': { input: 2, output: 8 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
};

export function estimateCostCents(model: string, promptTokens: number, outputTokens: number): number {
  const rate = PRICING[model] ?? PRICING['gpt-4o'];
  const dollars = (promptTokens / 1_000_000) * rate.input + (outputTokens / 1_000_000) * rate.output;
  return Number((dollars * 100).toFixed(4));
}

export interface CompletionUsage {
  model: string;
  promptTokens: number;
  outputTokens: number;
  costCents: number;
}

export interface CompleteJsonOptions<T> {
  schema: z.ZodType<T>;
  system: string;
  user: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** Retries on transport errors and on output that fails schema validation. */
  maxAttempts?: number;
}

export interface CompleteJsonResult<T> {
  data: T;
  usage: CompletionUsage;
}

/**
 * Requests a JSON object and validates it.
 *
 * `response_format: json_object` guarantees syntactically valid JSON but says
 * nothing about shape, which is why the Zod parse is not optional. On a schema
 * failure we retry with the validation error fed back to the model — in
 * practice that recovers the large majority of malformed responses.
 */
export async function completeJson<T>(options: CompleteJsonOptions<T>): Promise<CompleteJsonResult<T>> {
  const {
    schema,
    system,
    user,
    model = defaultModel(),
    temperature = 0.4,
    maxTokens = 4096,
    maxAttempts = 3,
  } = options;

  const client = openai();
  let lastError: unknown;
  let correction: string | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await client.chat.completions.create({
        model,
        temperature,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
          ...(correction
            ? [
                {
                  role: 'system' as const,
                  content: `Your previous response did not match the required schema: ${correction}. Return corrected JSON only.`,
                },
              ]
            : []),
        ],
      });

      const content = response.choices[0]?.message?.content;
      if (!content) throw new Error('Model returned an empty response');

      const parsed = schema.safeParse(JSON.parse(content));
      if (!parsed.success) {
        correction = parsed.error.issues
          .slice(0, 5)
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ');
        throw new Error(`Schema validation failed — ${correction}`);
      }

      const promptTokens = response.usage?.prompt_tokens ?? 0;
      const outputTokens = response.usage?.completion_tokens ?? 0;

      return {
        data: parsed.data,
        usage: {
          model,
          promptTokens,
          outputTokens,
          costCents: estimateCostCents(model, promptTokens, outputTokens),
        },
      };
    } catch (error) {
      lastError = error;
      log.warn('AI completion attempt failed', { attempt, model, error });

      if (attempt < maxAttempts) {
        // Exponential backoff with jitter, so a burst of concurrent audits
        // hitting a rate limit doesn't retry in lockstep.
        const backoff = 400 * 2 ** (attempt - 1) + Math.random() * 250;
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }
    }
  }

  log.error('AI completion exhausted retries', { model, error: lastError });
  throw errors.upstream('The AI service', 'The AI service could not complete this request. Please try again.');
}

export interface StreamTextOptions {
  system: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

/** Token stream for the chat assistant. */
export async function* streamText(options: StreamTextOptions): AsyncGenerator<string> {
  const { system, messages, model = defaultModel(), temperature = 0.6, maxTokens = 1600, signal } = options;

  const stream = await openai().chat.completions.create(
    {
      model,
      temperature,
      max_tokens: maxTokens,
      stream: true,
      messages: [{ role: 'system', content: system }, ...messages],
    },
    { signal },
  );

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) yield delta;
  }
}
