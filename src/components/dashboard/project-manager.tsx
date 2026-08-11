'use client';

import * as React from 'react';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { FolderKanban, Globe, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { NewAuditButton } from '@/components/dashboard/new-audit-dialog';
import { EmptyState } from '@/components/shared/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  addWebsiteAction,
  createProjectAction,
  deleteProjectAction,
  deleteWebsiteAction,
} from '@/features/projects/actions';
import type { ProjectSummary } from '@/features/projects/queries';
import { BAND_COLORS, scoreBand } from '@/config/scoring';
import { cn } from '@/lib/utils';
import { displayUrl } from '@/lib/url';

const PROJECT_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#f43f5e', '#a855f7'];

const projectFormSchema = z.object({
  name: z.string().min(1, 'Give the project a name').max(80),
  description: z.string().max(400).optional(),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
});

type ProjectFormValues = z.infer<typeof projectFormSchema>;

export function ProjectManager({ projects }: { projects: ProjectSummary[] }) {
  const [createOpen, setCreateOpen] = React.useState(false);

  if (projects.length === 0) {
    return (
      <>
        <EmptyState
          icon={<FolderKanban />}
          title="No projects yet"
          description="Projects group the websites you track. Agencies usually create one per client; in-house teams often use one per property."
          action={
            <Button variant="gradient" size="lg" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" /> Create a project
            </Button>
          }
        />
        <CreateProjectDialog open={createOpen} onOpenChange={setCreateOpen} />
      </>
    );
  }

  return (
    <>
      <div className="space-y-5">
        {projects.map((project) => (
          <ProjectCard key={project.id} project={project} />
        ))}

        <Button variant="outline" size="lg" className="w-full" onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" /> New project
        </Button>
      </div>

      <CreateProjectDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}

function ProjectCard({ project }: { project: ProjectSummary }) {
  const router = useRouter();
  const [addOpen, setAddOpen] = React.useState(false);

  async function handleDelete() {
    const result = await deleteProjectAction(project.id);
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    toast.success(`Deleted “${project.name}”`);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className="mt-1 size-3 shrink-0 rounded-full"
            style={{ backgroundColor: project.color }}
            aria-hidden="true"
          />
          <div className="min-w-0">
            <CardTitle>{project.name}</CardTitle>
            {project.description && (
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{project.description}</p>
            )}
            <p className="mt-1.5 text-xs text-muted-foreground">
              {project.websiteCount} website{project.websiteCount === 1 ? '' : 's'} ·{' '}
              {project.auditCount} audit{project.auditCount === 1 ? '' : 's'}
              {project.averageScore != null && ` · average score ${project.averageScore}`}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="size-3.5" /> Website
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${project.name}`}>
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem destructive onSelect={() => void handleDelete()}>
                <Trash2 /> Delete project
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>

      <CardContent>
        {project.websites.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
            No websites in this project yet.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {project.websites.map((website) => (
              <WebsiteRow key={website.id} website={website} projectId={project.id} />
            ))}
          </ul>
        )}
      </CardContent>

      <AddWebsiteDialog open={addOpen} onOpenChange={setAddOpen} projectId={project.id} />
    </Card>
  );
}

function WebsiteRow({
  website,
  projectId,
}: {
  website: ProjectSummary['websites'][number];
  projectId: string;
}) {
  const router = useRouter();

  async function handleDelete() {
    const result = await deleteWebsiteAction(website.id);
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    toast.success('Website removed');
    router.refresh();
  }

  const band = website.latestScore != null ? BAND_COLORS[scoreBand(website.latestScore)] : null;

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Globe className="size-3.5" aria-hidden="true" />
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{website.label ?? website.domain}</p>
        <p className="truncate text-xs text-muted-foreground">{displayUrl(website.url, 52)}</p>
      </div>

      {website.latestScore != null && band ? (
        <Link
          href={`/dashboard/audits/${website.latestAuditId}`}
          className={cn('rounded-lg px-2.5 py-1 text-sm font-semibold tabular-nums ring-1', band.bg, band.text, band.ring)}
        >
          {website.latestScore}
        </Link>
      ) : (
        <Badge variant="muted">Not audited</Badge>
      )}

      <NewAuditButton
        variant="outline"
        size="sm"
        websiteId={website.id}
        projectId={projectId}
        defaultUrl={website.url}
      >
        Audit
      </NewAuditButton>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${website.domain}`}>
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem destructive onSelect={() => void handleDelete()}>
            <Trash2 /> Remove website
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

function CreateProjectDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();

  const form = useForm<ProjectFormValues>({
    resolver: zodResolver(projectFormSchema),
    defaultValues: { name: '', description: '', color: PROJECT_COLORS[0] },
  });

  const color = form.watch('color');

  async function onSubmit(values: ProjectFormValues) {
    const result = await createProjectAction(values);

    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }

    toast.success('Project created');
    form.reset({ name: '', description: '', color: PROJECT_COLORS[0] });
    onOpenChange(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>Group related websites so their audits stay together.</DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="project-name">Name</Label>
            <Input id="project-name" autoFocus placeholder="Acme Corp" {...form.register('name')} />
            {form.formState.errors.name && (
              <p className="text-xs text-destructive" role="alert">
                {form.formState.errors.name.message}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="project-description">Description (optional)</Label>
            <Textarea
              id="project-description"
              placeholder="Marketing site and docs"
              {...form.register('description')}
            />
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Colour</legend>
            <div className="flex gap-2">
              {PROJECT_COLORS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => form.setValue('color', option)}
                  aria-label={`Colour ${option}`}
                  aria-pressed={color === option}
                  className={cn(
                    'size-8 rounded-lg transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                    color === option && 'scale-110 ring-2 ring-foreground ring-offset-2 ring-offset-background',
                  )}
                  style={{ backgroundColor: option }}
                />
              ))}
            </div>
          </fieldset>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="gradient" loading={form.formState.isSubmitting}>
              Create project
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AddWebsiteDialog({
  open,
  onOpenChange,
  projectId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
}) {
  const router = useRouter();
  const [url, setUrl] = React.useState('');
  const [label, setLabel] = React.useState('');
  const [pending, setPending] = React.useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);

    const result = await addWebsiteAction({ projectId, url: url.trim(), label: label.trim() || undefined });
    setPending(false);

    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }

    toast.success('Website added');
    setUrl('');
    setLabel('');
    onOpenChange(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a website</DialogTitle>
          <DialogDescription>
            Track a specific page. Most people add their homepage and their main landing pages.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="website-url">URL</Label>
            <Input
              id="website-url"
              autoFocus
              inputMode="url"
              spellCheck={false}
              placeholder="acme.com/pricing"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              icon={<Globe />}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="website-label">Label (optional)</Label>
            <Input
              id="website-label"
              placeholder="Pricing page"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="gradient" loading={pending} disabled={!url.trim()}>
              Add website
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
