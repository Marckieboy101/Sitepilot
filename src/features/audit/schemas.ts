import { z } from 'zod';

import { assertPublicUrl } from '@/lib/url';

/**
 * Input contracts for the audit surface.
 *
 * The URL refinement runs the same SSRF check the engine will run, so an
 * invalid or private target is rejected at the form boundary with a readable
 * message rather than deep inside the fetch layer.
 */

export const auditUrlSchema = z
  .string()
  .min(1, 'Enter a website URL')
  .max(2048, 'That URL is too long')
  .trim()
  .superRefine((value, ctx) => {
    try {
      assertPublicUrl(value);
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: error instanceof Error ? error.message : 'Enter a valid public URL',
      });
    }
  });

export const deviceSchema = z.enum(['MOBILE', 'DESKTOP']).default('MOBILE');

export const startAuditSchema = z.object({
  url: auditUrlSchema,
  device: deviceSchema,
  projectId: z.string().cuid().optional(),
  websiteId: z.string().cuid().optional(),
});

export type StartAuditInput = z.infer<typeof startAuditSchema>;

export const publicAuditSchema = z.object({
  url: auditUrlSchema,
});

export type PublicAuditInput = z.infer<typeof publicAuditSchema>;

export const auditFiltersSchema = z.object({
  projectId: z.string().cuid().optional(),
  websiteId: z.string().cuid().optional(),
  status: z.enum(['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELED']).optional(),
  search: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type AuditFilters = z.infer<typeof auditFiltersSchema>;

export const updateRecommendationSchema = z.object({
  recommendationId: z.string().cuid(),
  status: z.enum(['OPEN', 'IN_PROGRESS', 'DONE', 'DISMISSED']),
});

export type UpdateRecommendationInput = z.infer<typeof updateRecommendationSchema>;
