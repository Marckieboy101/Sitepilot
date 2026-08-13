import { describe, expect, it } from 'vitest';

import { AppError, fail } from '@/lib/errors';
import { normalizeEnvValue, sanitizeSupabaseKey, sanitizeSupabaseUrl } from '@/lib/env';
import {
  assertPublicUrl,
  coerceUrl,
  displayUrl,
  domainOf,
  isPrivateHostname,
  isSameSite,
  normalizeUrl,
  resolveHref,
} from '@/lib/url';

describe('coerceUrl', () => {
  it('adds https to a bare domain', () => {
    expect(coerceUrl('example.com')).toBe('https://example.com');
    expect(coerceUrl('  example.com/path  ')).toBe('https://example.com/path');
  });

  it('leaves an existing scheme alone', () => {
    expect(coerceUrl('http://example.com')).toBe('http://example.com');
    expect(coerceUrl('https://example.com')).toBe('https://example.com');
  });
});

describe('normalizeUrl', () => {
  it('collapses spellings of the same page onto one key', () => {
    // Every one of these is the same page; if they normalized differently,
    // history would fragment across duplicate Website rows.
    const variants = [
      'https://Example.com',
      'https://example.com/',
      'https://example.com:443',
      'https://example.com/#section',
      'https://example.com/?utm_source=twitter',
    ];

    const normalized = variants.map(normalizeUrl);
    expect(new Set(normalized).size).toBe(1);
    expect(normalized[0]).toBe('https://example.com');
  });

  it('strips tracking parameters but keeps meaningful ones', () => {
    const result = normalizeUrl('https://example.com/products?utm_medium=cpc&category=shoes&fbclid=abc');
    expect(result).toContain('category=shoes');
    expect(result).not.toContain('utm_medium');
    expect(result).not.toContain('fbclid');
  });

  it('sorts query parameters so ordering does not create duplicates', () => {
    expect(normalizeUrl('https://example.com/a?b=2&a=1')).toBe(
      normalizeUrl('https://example.com/a?a=1&b=2'),
    );
  });

  it('removes a trailing slash from a path but keeps the path itself', () => {
    expect(normalizeUrl('https://example.com/blog/')).toBe('https://example.com/blog');
  });

  it('strips embedded credentials', () => {
    expect(normalizeUrl('https://user:pass@example.com/x')).not.toContain('user');
  });
});

describe('domainOf', () => {
  it('drops the www prefix and lowercases', () => {
    expect(domainOf('https://WWW.Example.com/page')).toBe('example.com');
  });
});

describe('isPrivateHostname', () => {
  // Each of these is an address an SSRF payload would actually use.
  const blocked = [
    'localhost',
    '127.0.0.1',
    '0.0.0.0',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254', // AWS/GCP instance metadata
    '::1',
    'fe80::1',
    'fd00::1',
    '::ffff:169.254.169.254', // IPv4-mapped metadata address
    'metadata.google.internal',
    'db.internal',
    'printer.local',
    'intranet', // bare hostname
    '100.64.0.1', // carrier-grade NAT
  ];

  it.each(blocked)('blocks %s', (host) => {
    expect(isPrivateHostname(host)).toBe(true);
  });

  const allowed = ['example.com', 'sub.example.co.uk', '8.8.8.8', '172.32.0.1', '192.169.0.1'];

  it.each(allowed)('allows %s', (host) => {
    expect(isPrivateHostname(host)).toBe(false);
  });
});

describe('assertPublicUrl', () => {
  it('accepts a normal public URL', () => {
    const result = assertPublicUrl('example.com/pricing');
    expect(result.domain).toBe('example.com');
    expect(result.normalized).toBe('https://example.com/pricing');
  });

  it.each([
    ['file:///etc/passwd', 'non-HTTP scheme'],
    ['javascript:alert(1)', 'javascript scheme'],
    ['http://127.0.0.1:8080/admin', 'loopback'],
    ['https://169.254.169.254/latest/meta-data/', 'cloud metadata'],
    ['https://user:pass@example.com', 'embedded credentials'],
    ['not a url at all', 'unparseable'],
  ])('rejects %s (%s)', (input) => {
    expect(() => assertPublicUrl(input)).toThrow(AppError);
  });
});

describe('resolveHref', () => {
  const base = 'https://example.com/blog/post';

  it('resolves relative paths against the page URL', () => {
    expect(resolveHref('/about', base)).toBe('https://example.com/about');
    expect(resolveHref('../index', base)).toBe('https://example.com/index');
  });

  it('ignores non-navigational hrefs', () => {
    for (const href of ['mailto:a@b.com', 'tel:+123', 'javascript:void(0)', '#top', '']) {
      expect(resolveHref(href, base)).toBeNull();
    }
  });

  it('strips fragments so the same page is not counted twice', () => {
    expect(resolveHref('/about#team', base)).toBe('https://example.com/about');
  });
});

describe('isSameSite', () => {
  it('treats www and apex as the same site', () => {
    expect(isSameSite('https://www.example.com/a', 'https://example.com/b')).toBe(true);
  });

  it('treats a different domain as external', () => {
    expect(isSameSite('https://other.com', 'https://example.com')).toBe(false);
  });
});

describe('displayUrl', () => {
  it('strips the scheme and truncates', () => {
    expect(displayUrl('https://example.com/')).toBe('example.com');
    expect(displayUrl('https://example.com/a/very/long/path/indeed', 12)).toHaveLength(12);
  });
});

describe('normalizeEnvValue', () => {
  it('strips wrapping quotes from env values', () => {
    expect(normalizeEnvValue('"info"')).toBe('info');
    expect(normalizeEnvValue("'https://example.com' ")).toBe('https://example.com');
    expect(normalizeEnvValue('')).toBeUndefined();
    expect(normalizeEnvValue(undefined)).toBeUndefined();
  });

  it('treats placeholder Supabase values as unset', () => {
    expect(sanitizeSupabaseUrl('https://your-project.supabase.co')).toBeUndefined();
    expect(sanitizeSupabaseUrl('https://real-project.supabase.co')).toBe('https://real-project.supabase.co');
    expect(sanitizeSupabaseKey('your-anon-key')).toBeUndefined();
    expect(sanitizeSupabaseKey('your-service-role-key')).toBeUndefined();
    expect(sanitizeSupabaseKey('real-anon-key')).toBe('real-anon-key');
  });
});

describe('fail', () => {
  it('maps missing configuration to a helpful configuration error', () => {
    const result = fail(new Error('Invalid server environment variables:\n  • DATABASE_URL: Required'));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('CONFIGURATION');
      expect(result.error.message).toContain('DATABASE_URL');
    }
  });
});
