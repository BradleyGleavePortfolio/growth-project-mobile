/**
 * importReviewApi — typed client for the IMPORTER-I reconstruct read (contract
 * 1.4.0): GET /api/scout/reconstruct/entities. Mirrors communityApi's wire
 * posture: Zod-validated at the boundary (drift THROWS as a `contract` error),
 * coach-scoped by the auth token (no id sent), cursor-paginated, read-only.
 */
import api from '../services/api';
import { call } from './apiCall';
import {
  ReconstructEntitiesPageSchema,
  type ReconstructEntitiesPage,
  type ReconstructFamily,
} from '../types/importReview';

export const RECONSTRUCT_REQUEST_TIMEOUT_MS = 15_000;
export const RECONSTRUCT_PAGE_LIMIT = 20;

export interface ReconstructPageParams {
  cursor?: string;
  limit?: number;
}

export const importReviewApi = {
  // One cursor page for one family. Coach-scoped server-side; no id sent. A
  // missing family is a normal empty page, never a 404 existence oracle.
  listEntities(
    family: ReconstructFamily,
    opts: ReconstructPageParams = {},
  ): Promise<ReconstructEntitiesPage> {
    const params: Record<string, string> = { family };
    const limit = opts.limit ?? RECONSTRUCT_PAGE_LIMIT;
    if (Number.isFinite(limit) && limit > 0) params.limit = String(limit);
    if (opts.cursor) params.cursor = opts.cursor;
    return call(
      ReconstructEntitiesPageSchema,
      () =>
        api.get<unknown>('/scout/reconstruct/entities', {
          params,
          signal: AbortSignal.timeout(RECONSTRUCT_REQUEST_TIMEOUT_MS),
        }),
      'reconstruct',
    );
  },
};

export type ImportReviewApi = typeof importReviewApi;
