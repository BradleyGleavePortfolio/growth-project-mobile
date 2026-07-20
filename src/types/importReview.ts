/**
 * Strict Zod boundary for the IMPORTER-I reconstruct read (backend contract
 * 1.4.0): GET /api/scout/reconstruct/entities. A drifted response THROWS here
 * (surfaced as a `contract` error) rather than feeding React state.
 *
 * Honesty (Rule 18): `page_count` is page-local, NEVER a total/completion;
 * `next_cursor` is opaque. Site-agnostic: no source-platform label appears.
 */
import { z } from 'zod';

// Closed, site-agnostic family enum.
export const RECONSTRUCT_FAMILIES = ['workouts', 'client_history'] as const;
export type ReconstructFamily = (typeof RECONSTRUCT_FAMILIES)[number];

// Neutral display labels — canonical family names, never a source platform.
export const FAMILY_LABELS: Record<ReconstructFamily, string> = {
  workouts: 'Workouts',
  client_history: 'Client history',
};

// PII-minimal: only an opaque id + family on the wire; contents never rendered.
export const ReconstructedEntitySchema = z
  .object({
    id: z.string().uuid(),
    family: z.enum(RECONSTRUCT_FAMILIES),
  })
  .strict();
export type ReconstructedEntity = z.infer<typeof ReconstructedEntitySchema>;

// Coarse {code,message} reason, rendered verbatim; no counts/ids/PII.
export const ReconstructReasonSchema = z
  .object({
    code: z.string(),
    message: z.string(),
  })
  .strict();
export type ReconstructReason = z.infer<typeof ReconstructReasonSchema>;

// One cursor page for one family. next_cursor is opaque; null on the last page.
export const ReconstructEntitiesPageSchema = z
  .object({
    family: z.enum(RECONSTRUCT_FAMILIES),
    entities: z.array(ReconstructedEntitySchema),
    reasons: z.array(ReconstructReasonSchema),
    page_count: z.number().int().nonnegative(),
    next_cursor: z.string().nullable(),
  })
  .strict();
export type ReconstructEntitiesPage = z.infer<
  typeof ReconstructEntitiesPageSchema
>;
