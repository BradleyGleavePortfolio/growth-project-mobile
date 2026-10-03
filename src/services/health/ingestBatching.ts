/**
 * S14 — shared on-device ingest wire contract and batching.
 *
 * Both on-device connectors (Apple Health on iOS, Health Connect on Android)
 * post through this one module so the wire shape cannot drift between them.
 *
 * Contract with `POST /v1/wearables/samples/ingest` (backend
 * `src/wearables/samples/dto/ingest-samples.dto.ts`, `.strict()`):
 *  - Exactly the keys in {@link IngestWireSample}. The body never names the
 *    subject user: the server takes it from the JWT and rejects a body
 *    `userId` with `WEARABLES_INGEST_USER_ID_FORBIDDEN`. {@link toIngestWire}
 *    builds each sample from an allow-list, so no extra key can leak through.
 *  - `bucket` must match the canonical bucket of `metric`.
 *  - At most 2000 samples per request; in practice the binding limit is the
 *    backend's default 100 KB JSON body limit, so batches are capped by both a
 *    sample count and a serialized size well under it.
 *
 * The shared fixture `contracts/wearables-ingest-v1.fixture.json` (pinned by
 * sha256 in this repo and in growth-project-backend) is produced from the real
 * normalizers through {@link toIngestWire}; the backend contract test parses
 * the same bytes with its schema.
 */

import axios from 'axios';
import api from '../api';

/** Endpoint the device posts normalized samples to (JWT-authenticated). */
export const WEARABLES_INGEST_PATH = '/v1/wearables/samples/ingest';

/** Upper bound on samples per request (backend schema cap is 2000). */
export const MAX_SAMPLES_PER_REQUEST = 250;

/**
 * Upper bound on the UTF-8 encoded JSON body per request, in bytes. The
 * backend uses the default 100 KB (102,400 byte) JSON limit; 90,000 leaves
 * headroom for headers-free framing differences. Sizes are counted as UTF-8
 * bytes (see {@link utf8ByteLength}), not UTF-16 string length, so multi-byte
 * characters (for example the unit string for Celsius) are counted correctly.
 */
export const MAX_REQUEST_BYTES = 90_000;

/** Attempts per batch when the server answers 429 (rate limited). */
export const MAX_ATTEMPTS_PER_BATCH = 3;

/** Longest wait honoured from a Retry-After header, in milliseconds. */
export const MAX_RETRY_WAIT_MS = 60_000;

/** The exact over-the-wire sample shape the backend schema accepts. */
export interface IngestWireSample {
  connectionId: string;
  provider: string;
  metric: string;
  bucket: string;
  value: number;
  unit: string;
  startAt: string;
  endAt: string;
  sourceTz?: string | null;
  sourceRecordId?: string | null;
  rawRef?: string | null;
}

/** Any connector's normalized sample (Date or ISO string time fields). */
export interface IngestableSample {
  connectionId: string;
  provider: string;
  metric: string;
  bucket: string;
  value: number;
  unit: string;
  startAt: Date | string;
  endAt: Date | string;
  sourceTz?: string | null;
  sourceRecordId?: string | null;
  rawRef?: string | null;
}

/** Backend response — counts of newly inserted vs deduplicated rows. */
export interface IngestResult {
  inserted: number;
  skipped: number;
}

function toIso(t: Date | string): string {
  return typeof t === 'string' ? t : t.toISOString();
}

/**
 * Build the wire sample from an explicit allow-list of keys. Optional fields
 * are included only when present so the payload stays small.
 */
export function toIngestWire(sample: IngestableSample): IngestWireSample {
  const wire: IngestWireSample = {
    connectionId: sample.connectionId,
    provider: sample.provider,
    metric: sample.metric,
    bucket: sample.bucket,
    value: sample.value,
    unit: sample.unit,
    startAt: toIso(sample.startAt),
    endAt: toIso(sample.endAt),
  };
  if (sample.sourceTz != null) wire.sourceTz = sample.sourceTz;
  if (sample.sourceRecordId != null) wire.sourceRecordId = sample.sourceRecordId;
  if (sample.rawRef != null) wire.rawRef = sample.rawRef;
  return wire;
}

/**
 * UTF-8 encoded byte length of a string. Counted by hand (no TextEncoder) so
 * it behaves the same on Hermes, JSC and Node. A valid surrogate pair is one
 * 4-byte code point; a lone surrogate is encoded by JSON.stringify as a
 * 6-character ASCII escape before it reaches here, and is otherwise counted as
 * the 3-byte replacement character.
 */
export function utf8ByteLength(str: string): number {
  let bytes = 0;
  for (let i = 0; i < str.length; i += 1) {
    const code = str.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
      const next = str.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i += 1;
      } else {
        bytes += 3;
      }
    } else bytes += 3;
  }
  return bytes;
}

/** Result of {@link chunkForIngest}. */
export interface IngestChunks {
  batches: IngestWireSample[][];
  /** Samples whose own encoded size cannot fit one request; never sent. */
  oversized: IngestWireSample[];
}

/**
 * Split wire samples into request-sized batches, bounded by both
 * {@link MAX_SAMPLES_PER_REQUEST} and {@link MAX_REQUEST_BYTES} (UTF-8
 * bytes). Order is preserved. A sample that alone exceeds the byte bound is
 * returned in `oversized` instead of being sent (the server would reject the
 * whole request); every batch holds at least one sample.
 */
export function chunkForIngestWithReport(samples: IngestWireSample[]): IngestChunks {
  const batches: IngestWireSample[][] = [];
  const oversized: IngestWireSample[] = [];
  let current: IngestWireSample[] = [];
  let bytes = 2; // the enclosing [ ]
  for (const sample of samples) {
    const size = utf8ByteLength(JSON.stringify(sample)) + 1; // + separating comma
    if (size + 2 > MAX_REQUEST_BYTES) {
      oversized.push(sample);
      continue;
    }
    if (
      current.length > 0 &&
      (current.length >= MAX_SAMPLES_PER_REQUEST || bytes + size > MAX_REQUEST_BYTES)
    ) {
      batches.push(current);
      current = [];
      bytes = 2;
    }
    current.push(sample);
    bytes += size;
  }
  if (current.length > 0) batches.push(current);
  return { batches, oversized };
}

/** {@link chunkForIngestWithReport} batches only (oversized samples dropped). */
export function chunkForIngest(samples: IngestWireSample[]): IngestWireSample[][] {
  return chunkForIngestWithReport(samples).batches;
}

/** Injectable seams for tests. */
export interface PostIngestDeps {
  post?: (path: string, body: IngestWireSample[]) => Promise<{ data: IngestResult }>;
  sleep?: (ms: number) => Promise<void>;
  /**
   * Called before every request (including retries). Throwing stops the post
   * before anything else is sent. The session fence uses it so a sign-out or
   * account switch mid-import can never send one account's data under
   * another account's session.
   */
  beforeEachRequest?: () => void | Promise<void>;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Seconds from a Retry-After header, as bounded milliseconds. */
function retryWaitMs(err: unknown): number {
  if (!axios.isAxiosError(err)) return MAX_RETRY_WAIT_MS;
  const header = err.response?.headers?.['retry-after'];
  const seconds = Number(Array.isArray(header) ? header[0] : header);
  if (!Number.isFinite(seconds) || seconds <= 0) return MAX_RETRY_WAIT_MS;
  return Math.min(seconds * 1000, MAX_RETRY_WAIT_MS);
}

function isRateLimited(err: unknown): boolean {
  return axios.isAxiosError(err) && err.response?.status === 429;
}

/**
 * POST every batch sequentially. A 429 waits for Retry-After (bounded) and
 * retries the same batch, up to {@link MAX_ATTEMPTS_PER_BATCH} attempts; any
 * other failure rejects immediately so the caller keeps its sync cursor and
 * the next run re-reads the same window (ingest is idempotent on dedup_key).
 */
export async function postIngestBatches(
  samples: IngestableSample[],
  deps: PostIngestDeps = {},
): Promise<IngestResult & { requests: number; oversized: number }> {
  const post =
    deps.post ?? ((path: string, body: IngestWireSample[]) => api.post<IngestResult>(path, body));
  const sleep = deps.sleep ?? defaultSleep;

  const { batches, oversized } = chunkForIngestWithReport(samples.map(toIngestWire));
  let inserted = 0;
  let skipped = 0;
  let requests = 0;
  for (const batch of batches) {
    for (let attempt = 1; ; attempt += 1) {
      try {
        if (deps.beforeEachRequest) await deps.beforeEachRequest();
        requests += 1;
        const res = await post(WEARABLES_INGEST_PATH, batch);
        inserted += res.data?.inserted ?? 0;
        skipped += res.data?.skipped ?? 0;
        break;
      } catch (err) {
        if (!isRateLimited(err) || attempt >= MAX_ATTEMPTS_PER_BATCH) throw err;
        await sleep(retryWaitMs(err));
      }
    }
  }
  return { inserted, skipped, requests, oversized: oversized.length };
}
