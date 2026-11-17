import type { Metadata } from 'next';

import { Hero } from '@/components/marketing/hero';
import {
  AiFeatures,
  Faq,
  Features,
  FinalCta,
  HowItWorks,
  Pricing,
  Testimonials,
  TrustedBy,
} from '@/components/marketing/sections';
import { serverEnv } from '@/lib/env';

export const metadata: Metadata = {
  title: 'GetTravik — Audit any website in 60 seconds',
  description:
    'Run a complete technical audit — SEO, Core Web Vitals, accessibility and security — then let AI explain the results in plain English and tell you what to fix first.',
};

export default function LandingPage() {
  const currency = serverEnv().MOLLIE_CURRENCY;

  return (
    <>
      <Hero currency={currency} />
      <TrustedBy />
      <Features />
      <HowItWorks />
      <AiFeatures />
      <Pricing currency={currency} />
      <Testimonials />
      <Faq />
      <FinalCta />
    </>
  );
}
