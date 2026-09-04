import Link from 'next/link';

import { Logo } from '@/components/shared/logo';

const COLUMNS = [
  {
    title: 'Product',
    links: [
      { href: '#features', label: 'Features' },
      { href: '#how-it-works', label: 'How it works' },
      { href: '#ai', label: 'AI analysis' },
      { href: '#pricing', label: 'Pricing' },
      { href: '/signup', label: 'Start free' },
    ],
  },
  {
    title: 'Analysis',
    links: [
      { href: '#features', label: 'SEO audit' },
      { href: '#features', label: 'Core Web Vitals' },
      { href: '#features', label: 'Accessibility' },
      { href: '#features', label: 'Security headers' },
      { href: '#features', label: 'Competitor benchmarking' },
    ],
  },
  {
    title: 'Company',
    links: [
      { href: '#faq', label: 'FAQ' },
      { href: '/login', label: 'Sign in' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { href: '/privacy', label: 'Privacy' },
      { href: '/terms', label: 'Terms' },
    ],
  },
];

export function Footer() {
  return (
    <footer className="border-t border-border/60 bg-muted/20">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="grid gap-12 lg:grid-cols-[1.5fr_repeat(4,1fr)]">
          <div className="max-w-xs">
            <Logo />
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              AI-powered website auditing. Technical depth, explained in plain English, with a clear order
              to fix things in.
            </p>
          </div>

          {COLUMNS.map((column) => (
            <div key={column.title}>
              <h3 className="text-sm font-semibold">{column.title}</h3>
              <ul className="mt-4 space-y-2.5">
                {column.links.map((link) => (
                  <li key={`${column.title}-${link.label}`}>
                    <Link
                      href={link.href}
                      className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-14 flex flex-col items-center justify-between gap-4 border-t border-border/60 pt-8 sm:flex-row">
          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} WebDataScout. All rights reserved.
          </p>
          <p className="text-sm text-muted-foreground">
            Performance data from Google PageSpeed Insights · Accessibility testing by axe-core
          </p>
        </div>
      </div>
    </footer>
  );
}
