import type { Metadata } from 'next';

import { LegalPage, LEGAL_SECTIONS } from '@/components/marketing/legal';

export const metadata: Metadata = {
  title: 'Privacy policy',
  description: 'How Momo collects, uses and protects your data.',
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy policy"
      updated="This template was last revised on publication."
      sections={LEGAL_SECTIONS.privacy}
    />
  );
}
