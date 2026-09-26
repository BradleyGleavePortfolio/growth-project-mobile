/**
 * importRunStatusApi — S12-B3 transport seam for the two read-only server
 * reads behind the coach's import verdict (see src/types/importRunStatus.ts):
 *
 *   GET /api/scout/import/status?intent_id=…        (always, while paired)
 *   GET /api/scout/reconstruct/roster?intent_id=…   (only behind importReview)
 *
 * The run key is the text form of the pairing's server-issued
 * `import_intent_id` (backend lifecycle.dto `intent_id`). It is a correlation
 * handle, never a secret, and travels only as the query parameter the
 * contract defines. Both routes answer a uniform 404 whether the feature is
 * dark, the intent is unknown, or no evidence exists yet — deliberately
 * indistinguishable — so 404 is returned as the explicit `notFound` result
 * (rendered "not known yet"), never as an error, a zero, or a "no import".
 *
 * Bodies are returned raw and decoded by the caller for the exact intent it
 * asked about (decodeRunStatus / decodeRosterPage fail closed); every other
 * failure propagates so the hook can keep an earlier reading marked stale.
 */
import axios from 'axios';
import api from '../services/api';

export const IMPORT_STATUS_PATH = '/scout/import/status';
export const IMPORT_ROSTER_PATH = '/scout/reconstruct/roster';
export const IMPORT_STATUS_TIMEOUT_MS = 15_000;
export const IMPORT_ROSTER_PAGE_LIMIT = 50;

export type RawRead = { kind: 'body'; body: unknown } | { kind: 'notFound' };

async function readOrNotFound(run: () => Promise<{ data: unknown }>): Promise<RawRead> {
  try {
    const res = await run();
    return { kind: 'body', body: res.data };
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 404) return { kind: 'notFound' };
    throw err;
  }
}

export const importRunStatusApi = {
  status(intentId: string): Promise<RawRead> {
    return readOrNotFound(() =>
      api.get<unknown>(IMPORT_STATUS_PATH, {
        params: { intent_id: intentId },
        signal: AbortSignal.timeout(IMPORT_STATUS_TIMEOUT_MS),
      }),
    );
  },

  roster(intentId: string, cursor?: string): Promise<RawRead> {
    const params: Record<string, string> = { intent_id: intentId, limit: String(IMPORT_ROSTER_PAGE_LIMIT) };
    if (cursor) params.cursor = cursor;
    return readOrNotFound(() =>
      api.get<unknown>(IMPORT_ROSTER_PATH, {
        params,
        signal: AbortSignal.timeout(IMPORT_STATUS_TIMEOUT_MS),
      }),
    );
  },
};
