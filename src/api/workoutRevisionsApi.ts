/**
 * AIB-6 — read-only revision history (b#808: GET /workout-plans/:planId/revisions, newest first, max 50).
 * A 404 (route not deployed, or the autosave/undo switch is off) resolves to null so the sheet says so plainly.
 */
import axios from 'axios';
import { z } from 'zod';
import api from '../services/api';

const RevisionSchema = z.object({
  revision_index: z.number().int(),
  author_kind: z.string(),
  cause: z.string(),
  created_at: z.string(),
  summary: z.string(),
});
export type WorkoutRevision = z.infer<typeof RevisionSchema>;

export async function listWorkoutRevisions(planId: string, limit = 20): Promise<WorkoutRevision[] | null> {
  try {
    const res = await api.get(`/workout-plans/${encodeURIComponent(planId)}/revisions`, { params: { limit } });
    return z.array(RevisionSchema).parse(res.data);
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 404) return null;
    throw err;
  }
}
