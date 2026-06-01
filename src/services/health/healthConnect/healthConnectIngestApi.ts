// PR-HK-2.b — Android Health Connect connector: ingestion API client.
//
// Posts normalized samples to the backend ingestion lane. All backend traffic
// flows through the shared axios instance (`services/api.ts`) so the hardened
// token-refresh concurrency contract is reused — never a second http client
// (50-Failures #40/#41).
//
// ── CONTRACT STUB (integration PR) ───────────────────────────────────────
// The backend `POST /v1/wearables/samples/ingest` HTTP endpoint does not yet
// exist at the time this connector lands. The backend foundation (PR-HK-0,
// merged d09aa799) ships `IngestionService.ingest(NormalizedSample[])` and
// `connections.controller.ts` documents the route as PR-HK-2.a's
// responsibility, but no controller currently binds the path. This client is
// therefore the agreed CONTRACT STUB for the integration PR — exactly the same
// posture as the Apple HealthKit connector (PR-HK-2.a): the device-side
// normalizer + sync are built and tested now; wiring the authenticated POST
// route on the backend is the integration step. The wire shape below
// (camelCase NormalizedSample[] with ISO time strings) is the binding contract
// the backend endpoint must accept.

import api from '../../api';
import type { NormalizedSample, NormalizedSampleWire } from './types';

/** Endpoint the device posts normalized samples to (client-authenticated). */
export const WEARABLES_INGEST_PATH = '/v1/wearables/samples/ingest';

/** Backend response — counts of newly inserted vs deduped-skipped rows. */
export interface IngestResult {
  inserted: number;
  skipped: number;
}

/** Serialize a NormalizedSample to its over-the-wire (ISO time) shape. */
export function toWire(sample: NormalizedSample): NormalizedSampleWire {
  return {
    ...sample,
    startAt: sample.startAt.toISOString(),
    endAt: sample.endAt.toISOString(),
  };
}

/**
 * POST a batch of normalized samples to the backend ingestion lane.
 *
 * Idempotent by construction: the backend computes a deterministic `dedup_key`
 * and upserts (`skipDuplicates`), so re-posting an overlapping window — the
 * normal case when `lastSyncAt` is rewound for safety — never double-counts
 * (Agent 2 §2.5 dedup contract). An empty batch is a no-op (no request).
 */
export const healthConnectIngestApi = {
  ingest: async (samples: NormalizedSample[]): Promise<IngestResult> => {
    if (!Array.isArray(samples) || samples.length === 0) {
      return { inserted: 0, skipped: 0 };
    }
    const body = samples.map(toWire);
    const res = await api.post<IngestResult>(WEARABLES_INGEST_PATH, body);
    return res.data;
  },
};
