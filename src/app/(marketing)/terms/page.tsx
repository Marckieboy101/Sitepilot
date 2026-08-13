import type { Metadata } from 'next';

import { LegalPage, LEGAL_SECTIONS } from '@/components/marketing/legal';

export const metadata: Metadata = {
  title: 'Terms of service',
  description: 'The terms that govern your use of Momo.',
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of service"
      updated="This template was last revised on publication."
      sections={LEGAL_SECTIONS.terms}
    />
  );
}
