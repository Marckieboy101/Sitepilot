type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_WEIGHT: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * Structured JSON logger.
 *
 * Serverless platforms collect stdout line-by-line, so every entry is one JSON
 * object on one line — greppable in Vercel's log drain without a parser.
 * Values are redacted by key name to keep secrets out of shipped logs even when
 * a caller passes a whole config object by mistake.
 */

const REDACT_KEYS = /(?:key|token|secret|password|authorization|cookie|apikey)/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[depth-limit]';
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redact(item, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = REDACT_KEYS.test(key) ? '[redacted]' : redact(entry, depth + 1);
    }
    return out;
  }
  return value;
}

function currentLevel(): Level {
  const raw = process.env.LOG_LEVEL;
  return raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error' ? raw : 'info';
}

function emit(level: Level, message: string, context?: Record<string, unknown>) {
  if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[currentLevel()]) return;

  const entry = {
    level,
    time: new Date().toISOString(),
    message,
    ...(context ? (redact(context) as Record<string, unknown>) : {}),
  };

  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

function make(bindings: Record<string, unknown>): Logger {
  return {
    debug: (message, context) => emit('debug', message, { ...bindings, ...context }),
    info: (message, context) => emit('info', message, { ...bindings, ...context }),
    warn: (message, context) => emit('warn', message, { ...bindings, ...context }),
    error: (message, context) => emit('error', message, { ...bindings, ...context }),
    child: (extra) => make({ ...bindings, ...extra }),
  };
}

export const logger = make({});

/** Times an async operation and logs its outcome. Re-throws on failure. */
export async function timed<T>(
  log: Logger,
  operation: string,
  fn: () => Promise<T>,
  context?: Record<string, unknown>,
): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    log.debug(`${operation} completed`, { ...context, durationMs: Date.now() - start });
    return result;
  } catch (error) {
    log.error(`${operation} failed`, { ...context, durationMs: Date.now() - start, error });
    throw error;
  }
}
