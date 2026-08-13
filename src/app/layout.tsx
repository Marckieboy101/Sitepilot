import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';

import { Providers } from '@/components/providers';
import { clientEnv } from '@/lib/env';

import './globals.css';

const sans = Inter({
  subsets: ['latin'],
  variable: '--font-geist-sans',
  display: 'swap',
  // Keeps the fallback metrics close to Inter's so swapping in the web font
  // doesn't shift the layout — this is most of our CLS budget.
  adjustFontFallback: true,
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
  display: 'swap',
});

const title = 'SitePilot AI — AI-powered website audits';
const description =
  'Audit any website in 60 seconds. SitePilot AI combines Lighthouse, axe-core and deep technical analysis with AI that explains what to fix, why it matters, and what to do first.';

export const metadata: Metadata = {
  metadataBase: new URL(clientEnv.NEXT_PUBLIC_APP_URL),
  title: { default: title, template: '%s · SitePilot AI' },
  description,
  applicationName: 'SitePilot AI',
  keywords: [
    'website audit',
    'SEO analysis',
    'Core Web Vitals',
    'accessibility testing',
    'Lighthouse',
    'AI website analysis',
    'conversion optimisation',
  ],
  authors: [{ name: 'SitePilot AI' }],
  openGraph: {
    type: 'website',
    siteName: 'SitePilot AI',
    title,
    description,
    url: clientEnv.NEXT_PUBLIC_APP_URL,
  },
  twitter: { card: 'summary_large_image', title, description },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large' },
  },
  icons: {
    icon: [{ url: '/icon.svg', type: 'image/svg+xml' }],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0c14' },
  ],
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // `suppressHydrationWarning` is required by next-themes: it writes the
    // theme class onto <html> before React hydrates, which is intentionally a
    // server/client mismatch and the only way to avoid a flash of light theme.
    <html lang="en" suppressHydrationWarning className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-dvh bg-background font-sans antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
        >
          Skip to content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
