import type { Difficulty, Priority, Severity } from '@prisma/client';

import { Badge } from '@/components/ui/badge';
import { DIFFICULTY_LABELS, PRIORITY_LABELS, SEVERITY_LABELS } from '@/config/scoring';

const SEVERITY_VARIANT: Record<Severity, 'destructive' | 'warning' | 'info' | 'muted'> = {
  CRITICAL: 'destructive',
  HIGH: 'destructive',
  MEDIUM: 'warning',
  LOW: 'info',
  INFO: 'muted',
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <Badge variant={SEVERITY_VARIANT[severity]}>{SEVERITY_LABELS[severity]}</Badge>;
}

const PRIORITY_VARIANT: Record<Priority, 'destructive' | 'warning' | 'muted'> = {
  HIGH: 'destructive',
  MEDIUM: 'warning',
  LOW: 'muted',
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  return <Badge variant={PRIORITY_VARIANT[priority]}>{PRIORITY_LABELS[priority]}</Badge>;
}

export function DifficultyBadge({ difficulty }: { difficulty: Difficulty }) {
  return <Badge variant="outline">{DIFFICULTY_LABELS[difficulty]}</Badge>;
}
