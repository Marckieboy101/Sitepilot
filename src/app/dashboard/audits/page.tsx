import type { Metadata } from 'next';

import { AuditList } from '@/components/dashboard/audit-list';
import { NewAuditButton } from '@/components/dashboard/new-audit-dialog';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { requireSession } from '@/features/auth/session';
import { listAudits } from '@/features/audit/queries';

export const metadata: Metadata = { title: 'Website audits' };

interface PageProps {
  searchParams: Promise<{ page?: string; status?: string; projectId?: string }>;
}

export default async function AuditsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const session = await requireSession();

  const page = Number.parseInt(params.page ?? '1', 10) || 1;

  const { items, total, pageSize } = await listAudits(session.organizationId, {
    page,
    pageSize: 20,
    status: params.status as never,
    projectId: params.projectId,
  });

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-8">
      <PageHeader
        title="Website audits"
        description={`${total} audit${total === 1 ? '' : 's'} across your projects.`}
        actions={<NewAuditButton />}
      />

      <AuditList audits={items} />

      {totalPages > 1 && (
        <nav className="flex items-center justify-between" aria-label="Pagination">
          <p className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} asChild={page > 1}>
              {page > 1 ? <a href={`/dashboard/audits?page=${page - 1}`}>Previous</a> : <span>Previous</span>}
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} asChild={page < totalPages}>
              {page < totalPages ? (
                <a href={`/dashboard/audits?page=${page + 1}`}>Next</a>
              ) : (
                <span>Next</span>
              )}
            </Button>
          </div>
        </nav>
      )}
    </div>
  );
}
