import { lookup } from 'node:dns/promises';

import { errors } from './errors';
import { isPrivateHostname } from './url';

/**
 * Outbound HTTP for the audit engine.
 *
 * `safeFetch` is the only way the engine reaches the public internet. Beyond
 * the static checks in `assertPublicUrl`, it resolves the hostname and rejects
 * private addresses before connecting — closing the DNS-rebinding hole where
 * `evil.com` resolves to 169.254.169.254 — and caps both the timeout and the
 * number of bytes read so a hostile or merely enormous page cannot exhaust
 * memory or hold a serverless function open until it times out.
 */

export const USER_AGENT =
  'Mozilla/5.0 (compatible; SitePilotBot/1.0; +https://sitepilot.ai/bot) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export const MOBILE_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36 (compatible; SitePilotBot/1.0; +https://sitepilot.ai/bot)';

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024; // 8 MB
const MAX_REDIRECTS = 5;

export interface SafeFetchOptions {
  method?: 'GET' | 'HEAD' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxBytes?: number;
  /** Follow redirects manually so the chain can be recorded and re-validated. */
  followRedirects?: boolean;
  signal?: AbortSignal;
}

export interface SafeFetchResult {
  url: string;
  status: number;
  ok: boolean;
  headers: Headers;
  body: string;
  bytes: number;
  redirectChain: string[];
  timingMs: number;
  truncated: boolean;
}

async function assertResolvesPublic(hostname: string): Promise<void> {
  // Literal IPs are already covered by the static check; skip the DNS round-trip.
  if (/^\[?[0-9a-f:.]+\]?$/i.test(hostname)) return;

  let records: Array<{ address: string }>;
  try {
    records = await lookup(hostname, { all: true });
  } catch {
    throw errors.unreachable(hostname, 'DNS lookup failed');
  }

  if (records.length === 0) throw errors.unreachable(hostname, 'DNS returned no records');

  for (const record of records) {
    if (isPrivateHostname(record.address)) {
      throw errors.validation('That hostname resolves to a private address.');
    }
  }
}

/** Reads a response body with a hard byte ceiling. */
async function readCapped(
  response: Response,
  maxBytes: number,
): Promise<{ text: string; bytes: number; truncated: boolean }> {
  const reader = response.body?.getReader();
  if (!reader) return { text: '', bytes: 0, truncated: false };

  const chunks: Uint8Array[] = [];
  let received = 0;
  let truncated = false;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    received += value.byteLength;
    if (received > maxBytes) {
      chunks.push(value.slice(0, value.byteLength - (received - maxBytes)));
      truncated = true;
      await reader.cancel().catch(() => undefined);
      received = maxBytes;
      break;
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(received);
  let offset = 0;
  for (const part of chunks) {
    merged.set(part, offset);
    offset += part.byteLength;
  }

  return { text: new TextDecoder('utf-8', { fatal: false }).decode(merged), bytes: received, truncated };
}

export async function safeFetch(target: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const {
    method = 'GET',
    headers = {},
    body,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBytes = DEFAULT_MAX_BYTES,
    followRedirects = true,
    signal,
  } = options;

  const started = Date.now();
  const redirectChain: string[] = [];

  let current = target;
  let hops = 0;

  for (;;) {
    const url = new URL(current);
    if (isPrivateHostname(url.hostname)) {
      throw errors.validation('That URL points to a private or local address.');
    }
    await assertResolvesPublic(url.hostname);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });

    let response: Response;
    try {
      response = await fetch(current, {
        method,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          ...headers,
        },
        body,
        redirect: 'manual',
        signal: controller.signal,
      });
    } catch (error) {
      const reason =
        error instanceof Error && error.name === 'AbortError'
          ? `timed out after ${timeoutMs}ms`
          : error instanceof Error
            ? error.message
            : 'network error';
      throw errors.unreachable(current, reason);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }

    const isRedirect = response.status >= 300 && response.status < 400;
    const location = response.headers.get('location');

    if (isRedirect && location && followRedirects) {
      if (hops >= MAX_REDIRECTS) {
        throw errors.unreachable(target, `too many redirects (>${MAX_REDIRECTS})`);
      }
      await response.body?.cancel().catch(() => undefined);
      redirectChain.push(current);
      current = new URL(location, current).toString();
      hops += 1;
      continue;
    }

    const { text, bytes, truncated } =
      method === 'HEAD'
        ? { text: '', bytes: 0, truncated: false }
        : await readCapped(response, maxBytes);

    return {
      url: current,
      status: response.status,
      ok: response.ok,
      headers: response.headers,
      body: text,
      bytes,
      redirectChain,
      timingMs: Date.now() - started,
      truncated,
    };
  }
}

/**
 * Status-only probe used by the broken-link checker.
 * Falls back to GET because a surprising number of servers reject HEAD with
 * 405 even though the resource is fine — reporting those as broken would
 * fill the report with false positives.
 */
export async function probeStatus(
  target: string,
  timeoutMs = 8_000,
): Promise<{ status: number | null; ok: boolean }> {
  try {
    const head = await safeFetch(target, { method: 'HEAD', timeoutMs, maxBytes: 0 });
    if (head.status !== 405 && head.status !== 501) {
      return { status: head.status, ok: head.status < 400 };
    }
  } catch {
    // fall through to GET
  }

  try {
    const get = await safeFetch(target, { method: 'GET', timeoutMs, maxBytes: 64 * 1024 });
    return { status: get.status, ok: get.status < 400 };
  } catch {
    return { status: null, ok: false };
  }
}

/** Fetch JSON from a trusted first-party API (PageSpeed, Stripe). No SSRF gate. */
export async function fetchJson<T>(
  url: string,
  options: { timeoutMs?: number; headers?: Record<string, string> } = {},
): Promise<T> {
  const { timeoutMs = 60_000, headers = {} } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json', ...headers },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw errors.upstream(new URL(url).hostname, `Upstream responded ${response.status}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}
