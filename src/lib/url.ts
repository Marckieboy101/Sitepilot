import { errors } from './errors';

/**
 * URL normalization and safety checks.
 *
 * The audit engine fetches arbitrary user-supplied URLs from our servers, which
 * is textbook SSRF exposure. Everything that reaches the network must go
 * through `assertPublicUrl` first: it rejects non-HTTP schemes, credentials in
 * the URL, and hostnames that resolve to private / link-local / loopback space
 * so an audit can never be pointed at internal infrastructure or a cloud
 * metadata endpoint.
 */

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

// Hostnames that are never legitimate audit targets.
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
]);

const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa', '.onion'];

/** Adds a scheme when the user typed a bare domain. */
export function coerceUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/**
 * Canonical form used as the `Website.url` key: lowercase host, no default
 * port, no fragment, no trailing slash, tracking parameters stripped.
 * Two spellings of the same page must normalize to the same string or history
 * and trend charts fragment across duplicate website rows.
 */
export function normalizeUrl(input: string): string {
  const url = new URL(coerceUrl(input));

  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  url.hash = '';
  url.username = '';
  url.password = '';

  if (
    (url.protocol === 'https:' && url.port === '443') ||
    (url.protocol === 'http:' && url.port === '80')
  ) {
    url.port = '';
  }

  const TRACKING = /^(utm_|fbclid$|gclid$|mc_(e|c)id$|_hs|ref$|igshid$|msclkid$|yclid$)/i;
  for (const key of Array.from(url.searchParams.keys())) {
    if (TRACKING.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();

  if (url.pathname !== '/' && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.replace(/\/+$/, '');
  }

  const serialized = url.toString();
  return url.pathname === '/' && !url.search ? serialized.replace(/\/$/, '') : serialized;
}

/** Registrable-ish domain for display and grouping (drops a leading `www.`). */
export function domainOf(input: string): string {
  return new URL(coerceUrl(input)).hostname.toLowerCase().replace(/^www\./, '');
}

function isPrivateIPv4(host: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return false;

  const octets = match.slice(1).map(Number);
  if (octets.some((octet) => octet > 255)) return true; // malformed — refuse

  const [a, b] = octets as [number, number, number, number];

  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 192 && b === 0) return true; // IETF protocol assignments
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a >= 224) return true; // multicast + reserved + broadcast

  return false;
}

function isPrivateIPv6(host: string): boolean {
  const address = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (address === '::1' || address === '::') return true;
  if (address.startsWith('fe80')) return true; // link-local
  if (/^f[cd]/.test(address)) return true; // unique local
  // IPv4-mapped (::ffff:169.254.169.254) tunnels straight back to IPv4 space.
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(address);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return false;
}

export function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  if (BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  if (!host.includes('.') && !host.includes(':')) return true; // bare hostname => intranet
  return isPrivateIPv4(host) || isPrivateIPv6(host);
}

export interface SafeUrl {
  normalized: string;
  url: URL;
  domain: string;
}

/**
 * Validates that a URL is safe for the server to fetch.
 * Throws `AppError` with a user-readable reason on rejection.
 *
 * Note: this checks the hostname as written. A hostname that resolves to a
 * private address via DNS is additionally caught at fetch time by
 * `safeFetch`, which re-checks the resolved address.
 */
export function assertPublicUrl(input: string): SafeUrl {
  let url: URL;
  try {
    url = new URL(coerceUrl(input));
  } catch {
    throw errors.validation("That doesn't look like a valid URL.");
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw errors.validation('Only http:// and https:// URLs can be audited.');
  }

  if (url.username || url.password) {
    throw errors.validation('URLs with embedded credentials are not supported.');
  }

  if (isPrivateHostname(url.hostname)) {
    throw errors.validation('That URL points to a private or local address.');
  }

  return { normalized: normalizeUrl(input), url, domain: domainOf(input) };
}

/** Best-effort favicon for list rows. Uses Google's public S2 service. */
export function faviconFor(domain: string, size = 64): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=${size}`;
}

export function displayUrl(input: string, max = 42): string {
  const stripped = input.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return stripped.length <= max ? stripped : `${stripped.slice(0, max - 1)}…`;
}

/** Resolves a possibly-relative href against a page URL; null if unusable. */
export function resolveHref(href: string, base: string): string | null {
  const trimmed = href.trim();
  if (!trimmed) return null;
  if (/^(mailto:|tel:|javascript:|data:|#)/i.test(trimmed)) return null;
  try {
    const resolved = new URL(trimmed, base);
    if (!ALLOWED_PROTOCOLS.has(resolved.protocol)) return null;
    resolved.hash = '';
    return resolved.toString();
  } catch {
    return null;
  }
}

export function isSameSite(candidate: string, base: string): boolean {
  try {
    return domainOf(candidate) === domainOf(base);
  } catch {
    return false;
  }
}
