import type { Metadata } from 'next';

import { ProjectManager } from '@/components/dashboard/project-manager';
import { PageHeader } from '@/components/shared/page-header';
import { requireSession } from '@/features/auth/session';
import { listProjects } from '@/features/projects/queries';

export const metadata: Metadata = { title: 'Projects' };

export default async function ProjectsPage() {
  const session = await requireSession();
  const projects = await listProjects(session.organizationId);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Projects"
        description="Group the websites you track. Each project keeps its own audits and history."
      />
      <ProjectManager projects={projects} />
    </div>
  );
}
