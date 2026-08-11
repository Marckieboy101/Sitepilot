'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { db } from '@/lib/db';
import { errors, fail, ok, type ActionResult } from '@/lib/errors';
import { RATE_LIMITS, enforceRateLimit } from '@/lib/rate-limit';
import { assertPublicUrl, domainOf, faviconFor, normalizeUrl } from '@/lib/url';

import { requireSession } from '../auth/session';
import { assertWithinCountLimit, getEntitlements } from '../billing/quota';

const projectSchema = z.object({
  name: z.string().min(1, 'Give the project a name').max(80).trim(),
  description: z.string().max(400).trim().optional(),
  color: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i, 'Pick a colour')
    .default('#6366f1'),
});

const websiteSchema = z.object({
  projectId: z.string().cuid(),
  url: z.string().min(1, 'Enter a website URL').max(2048),
  label: z.string().max(80).trim().optional(),
});

export type CreateProjectInput = z.infer<typeof projectSchema>;
export type AddWebsiteInput = z.infer<typeof websiteSchema>;

export async function createProjectAction(input: CreateProjectInput): Promise<ActionResult<{ id: string }>> {
  try {
    const session = await requireSession();
    enforceRateLimit(`mutate:${session.userId}`, RATE_LIMITS.mutation);

    const parsed = projectSchema.safeParse(input);
    if (!parsed.success) throw errors.validation(parsed.error.issues[0]?.message ?? 'Check the form.');

    await assertWithinCountLimit(session.organizationId, 'projects');

    const project = await db.project.create({
      data: {
        organizationId: session.organizationId,
        name: parsed.data.name,
        description: parsed.data.description || null,
        color: parsed.data.color,
      },
      select: { id: true },
    });

    revalidatePath('/dashboard/projects');
    return ok(project);
  } catch (error) {
    return fail(error);
  }
}

export async function updateProjectAction(
  projectId: string,
  input: CreateProjectInput,
): Promise<ActionResult<null>> {
  try {
    const session = await requireSession();
    enforceRateLimit(`mutate:${session.userId}`, RATE_LIMITS.mutation);

    const parsed = projectSchema.safeParse(input);
    if (!parsed.success) throw errors.validation(parsed.error.issues[0]?.message ?? 'Check the form.');

    // Tenancy is part of the filter, so a forged id updates nothing.
    const updated = await db.project.updateMany({
      where: { id: projectId, organizationId: session.organizationId },
      data: {
        name: parsed.data.name,
        description: parsed.data.description || null,
        color: parsed.data.color,
      },
    });

    if (updated.count === 0) throw errors.notFound('Project');

    revalidatePath('/dashboard/projects');
    return ok(null);
  } catch (error) {
    return fail(error);
  }
}

export async function archiveProjectAction(projectId: string): Promise<ActionResult<null>> {
  try {
    const session = await requireSession();

    const updated = await db.project.updateMany({
      where: { id: projectId, organizationId: session.organizationId },
      data: { archived: true },
    });

    if (updated.count === 0) throw errors.notFound('Project');

    revalidatePath('/dashboard/projects');
    return ok(null);
  } catch (error) {
    return fail(error);
  }
}

export async function deleteProjectAction(projectId: string): Promise<ActionResult<null>> {
  try {
    const session = await requireSession();

    const project = await db.project.findFirst({
      where: { id: projectId, organizationId: session.organizationId },
      select: { id: true },
    });
    if (!project) throw errors.notFound('Project');

    // Cascades through websites → audits → results.
    await db.project.delete({ where: { id: projectId } });

    revalidatePath('/dashboard/projects');
    revalidatePath('/dashboard/audits');
    return ok(null);
  } catch (error) {
    return fail(error);
  }
}

export async function addWebsiteAction(input: AddWebsiteInput): Promise<ActionResult<{ id: string }>> {
  try {
    const session = await requireSession();
    enforceRateLimit(`mutate:${session.userId}`, RATE_LIMITS.mutation);

    const parsed = websiteSchema.safeParse(input);
    if (!parsed.success) throw errors.validation(parsed.error.issues[0]?.message ?? 'Check the form.');

    const project = await db.project.findFirst({
      where: { id: parsed.data.projectId, organizationId: session.organizationId },
      select: { id: true, _count: { select: { websites: true } } },
    });
    if (!project) throw errors.notFound('Project');

    const { limits } = await getEntitlements(session.organizationId);
    if (limits.websitesPerProject != null && project._count.websites >= limits.websitesPerProject) {
      throw errors.quotaExceeded(
        `This plan allows ${limits.websitesPerProject} websites per project. Upgrade to add more.`,
      );
    }

    // Validates the URL is public and safe before we ever store it.
    const safe = assertPublicUrl(parsed.data.url);
    const normalized = normalizeUrl(parsed.data.url);
    const domain = domainOf(normalized);

    const website = await db.website.upsert({
      where: { projectId_url: { projectId: parsed.data.projectId, url: normalized } },
      create: {
        projectId: parsed.data.projectId,
        url: normalized,
        domain,
        label: parsed.data.label || domain,
        faviconUrl: faviconFor(safe.domain),
      },
      update: { label: parsed.data.label || undefined },
      select: { id: true },
    });

    revalidatePath('/dashboard/projects');
    return ok(website);
  } catch (error) {
    return fail(error);
  }
}

export async function deleteWebsiteAction(websiteId: string): Promise<ActionResult<null>> {
  try {
    const session = await requireSession();

    const website = await db.website.findFirst({
      where: { id: websiteId, project: { organizationId: session.organizationId } },
      select: { id: true },
    });
    if (!website) throw errors.notFound('Website');

    await db.website.delete({ where: { id: websiteId } });

    revalidatePath('/dashboard/projects');
    return ok(null);
  } catch (error) {
    return fail(error);
  }
}
