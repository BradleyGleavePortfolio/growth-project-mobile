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

/**
 * Longest wait honoured from a Retry-After header, in milliseconds. The
 * backend's 429 filter sends one conservative Retry-After (3600 s) for every
 * throttler, but the ingest route is governed only by its per-user 60-second
 * bucket (backend `wearables-throttle.ts`, WEARABLES_SKIP_THROTTLERS), and the
 * in-app copy for a 429 says to wait a minute. A longer Retry-After is
 * therefore honoured for one full bucket window.
 */
export const MAX_RETRY_WAIT_MS = 60_000;

/**
 * C-370-2: the backend allows 60 ingest requests per user per 60 seconds
 * (`WEARABLES_INGEST_PER_MIN`). The device sends at most this many in any
 * 60-second window, so a large import waits for the window instead of being
 * refused; the margin covers a second phone on the same account.
 */
export const INGEST_REQUESTS_PER_WINDOW = 50;

/** The window {@link INGEST_REQUESTS_PER_WINDOW} applies to, in milliseconds. */
export const INGEST_WINDOW_MS = 60_000;

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
   * C-370-2: the request pacer to share. A sync run passes one pacer to
   * every post it makes (the app passes {@link sharedIngestPacer}); without
   * one, this call gets its own pacer.
   */
  pacer?: IngestPacer;
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

/**
 * C-370-2: paces ingest requests and holds them back after a 429. Every
 * request waits for {@link IngestPacer.acquire}; a 429 calls
 * {@link IngestPacer.backOff}, after which no request sharing this pacer is
 * sent until the Retry-After wait has passed.
 */
export interface IngestPacer {
  /** Resolves when one more request may be sent, and counts it. */
  acquire(): Promise<void>;
  /** Holds every later request back for `waitMs` (bounded by {@link MAX_RETRY_WAIT_MS}). */
  hold(waitMs: number): void;
  /** {@link IngestPacer.hold}, then resolves when the wait is over. */
  backOff(waitMs: number): Promise<void>;
}

/** Seams for {@link createIngestPacer}. */
export interface IngestPacerOptions {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  limit?: number;
  windowMs?: number;
}

/**
 * A pacer that sends at most `limit` requests in any `windowMs` window
 * (defaults {@link INGEST_REQUESTS_PER_WINDOW} per {@link INGEST_WINDOW_MS}).
 * Callers are served one at a time, in order. Time is the later of the clock
 * and the end of the last wait, so an injected `sleep` that returns at once
 * still paces by the wait it was asked for.
 */
export function createIngestPacer(options: IngestPacerOptions = {}): IngestPacer {
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? defaultSleep;
  const limit = Math.max(1, Math.floor(options.limit ?? INGEST_REQUESTS_PER_WINDOW));
  const windowMs = options.windowMs ?? INGEST_WINDOW_MS;
  let sent: number[] = [];
  let heldUntil = -Infinity;
  let waitedUntil = -Infinity;
  let queue: Promise<void> = Promise.resolve();

  const clock = (): number => Math.max(now(), waitedUntil);
  const waitUntil = async (target: number, from: number = clock()): Promise<number> => {
    const t = from;
    if (target <= t) return t;
    await sleep(target - t);
    waitedUntil = Math.max(waitedUntil, target);
    return clock();
  };
  const holdFrom = (t: number, waitMs: number): void => {
    const wait = Math.max(0, Math.min(waitMs, MAX_RETRY_WAIT_MS));
    heldUntil = Math.max(heldUntil, t + wait);
  };
  const serial = (step: () => Promise<void>): Promise<void> => {
    const run = queue.then(step);
    queue = run.catch(() => undefined);
    return run;
  };

  return {
    acquire: () =>
      serial(async () => {
        // Each pass waits out any hold, then the window; a hold placed while
        // waiting for the window is waited out on the next pass.
        let t = clock();
        for (;;) {
          t = await waitUntil(heldUntil, t);
          const from = t;
          sent = sent.filter((at) => from - at < windowMs);
          if (sent.length < limit) break;
          t = await waitUntil(sent[sent.length - limit] + windowMs, t);
        }
        sent.push(t);
      }),
    hold: (waitMs: number) => {
      holdFrom(clock(), waitMs);
    },
    backOff: (waitMs: number) =>
      serial(async () => {
        const t = clock();
        holdFrom(t, waitMs);
        await waitUntil(heldUntil, t);
      }),
  };
}

/**
 * The app's one pacer: every on-device import and refresh in this process
 * shares it (`onDeviceSync.ts`), so separate runs together stay under the
 * backend limit and all of them respect a Retry-After.
 */
export const sharedIngestPacer: IngestPacer = createIngestPacer();

/**
 * Milliseconds a 429 asks to wait: Retry-After as seconds or as an HTTP date,
 * bounded by {@link MAX_RETRY_WAIT_MS}. A missing or unreadable header waits
 * the full bound.
 */
export function retryWaitMs(err: unknown, nowMs: number = Date.now()): number {
  if (!axios.isAxiosError(err)) return MAX_RETRY_WAIT_MS;
  const header = err.response?.headers?.['retry-after'];
  const value = String(Array.isArray(header) ? header[0] : header ?? '').trim();
  if (/^\d+(\.\d+)?$/.test(value)) {
    const seconds = Number(value);
    return seconds > 0 ? Math.min(seconds * 1000, MAX_RETRY_WAIT_MS) : MAX_RETRY_WAIT_MS;
  }
  const at = value ? Date.parse(value) : NaN;
  if (!Number.isFinite(at)) return MAX_RETRY_WAIT_MS;
  return Math.min(Math.max(at - nowMs, 0), MAX_RETRY_WAIT_MS);
}

function isRateLimited(err: unknown): boolean {
  return axios.isAxiosError(err) && err.response?.status === 429;
}

/**
 * POST every batch sequentially through the pacer (C-370-2), so no more than
 * {@link INGEST_REQUESTS_PER_WINDOW} requests leave in any window. A 429 holds
 * every request on the pacer back for its Retry-After (bounded) and retries
 * the same batch, up to {@link MAX_ATTEMPTS_PER_BATCH} attempts; the last
 * 429 still holds the pacer, so the next run waits it out before sending.
 * Any other failure rejects immediately. The caller saves progress only after a call
 * resolves, so a stopped run resumes after the last saved page or piece and
 * re-reads only the one in hand (ingest is idempotent on dedup_key).
 */
export async function postIngestBatches(
  samples: IngestableSample[],
  deps: PostIngestDeps = {},
): Promise<IngestResult & { requests: number; oversized: number }> {
  const post =
    deps.post ?? ((path: string, body: IngestWireSample[]) => api.post<IngestResult>(path, body));
  const pacer = deps.pacer ?? createIngestPacer({ sleep: deps.sleep });

  const { batches, oversized } = chunkForIngestWithReport(samples.map(toIngestWire));
  let inserted = 0;
  let skipped = 0;
  let requests = 0;
  for (const batch of batches) {
    for (let attempt = 1; ; attempt += 1) {
      try {
        await pacer.acquire();
        if (deps.beforeEachRequest) await deps.beforeEachRequest();
        requests += 1;
        const res = await post(WEARABLES_INGEST_PATH, batch);
        inserted += res.data?.inserted ?? 0;
        skipped += res.data?.skipped ?? 0;
        break;
      } catch (err) {
        if (!isRateLimited(err)) throw err;
        const wait = retryWaitMs(err);
        if (attempt >= MAX_ATTEMPTS_PER_BATCH) {
          pacer.hold(wait);
          throw err;
        }
        await pacer.backOff(wait);
      }
    }
  }
  return { inserted, skipped, requests, oversized: oversized.length };
}
