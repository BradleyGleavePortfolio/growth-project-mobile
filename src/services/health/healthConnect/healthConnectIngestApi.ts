// PR-HK-2.b — Android Health Connect connector: ingestion API client.
//
// Posts normalized samples to the backend ingestion lane. All backend traffic
// flows through the shared axios instance (`services/api.ts`) so the hardened
// token-refresh concurrency contract is reused — never a second http client
// (50-Failures #40/#41).
//
// S14: the backend route exists (`POST /v1/wearables/samples/ingest`, gated
// by FEATURE_WEARABLES_INGEST_POST). The wire shape and batching are shared
// with the Apple Health connector in `../ingestBatching.ts`; the body never
// carries `userId` (the server derives the subject from the JWT).

import {
  WEARABLES_INGEST_PATH as SHARED_INGEST_PATH,
  postIngestBatches,
  toIngestWire,
  type IngestResult as SharedIngestResult,
  type PostIngestDeps,
} from '../ingestBatching';
import type { NormalizedSample, NormalizedSampleWire } from './types';

/** Endpoint the device posts normalized samples to (client-authenticated). */
export const WEARABLES_INGEST_PATH = SHARED_INGEST_PATH;

/** Backend response — counts of newly inserted vs deduped-skipped rows. */
export type IngestResult = SharedIngestResult;

/** Serialize a NormalizedSample to its over-the-wire (ISO time) shape. */
export function toWire(sample: NormalizedSample): NormalizedSampleWire {
  return toIngestWire(sample) as NormalizedSampleWire;
}

/**
 * POST normalized samples to the backend ingestion lane in request-sized
 * batches (see `../ingestBatching.ts`).
 *
 * Idempotent by construction: the backend computes a deterministic `dedup_key`
 * and inserts with `skipDuplicates`, so re-posting an overlapping window never
 * double-counts. An empty batch is a no-op (no request).
 */
export const healthConnectIngestApi = {
  ingest: async (samples: NormalizedSample[], deps?: PostIngestDeps): Promise<IngestResult> => {
    if (!Array.isArray(samples) || samples.length === 0) {
      return { inserted: 0, skipped: 0 };
    }
    const { inserted, skipped } = await postIngestBatches(samples, deps);
    return { inserted, skipped };
  },
};
