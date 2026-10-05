/**
 * S14 — shared ingest contract fixture (mobile side).
 *
 * Builds the request bodies the app really sends to
 * `POST /v1/wearables/samples/ingest`: real Apple Health and Health Connect
 * normalizers -> the shared wire serializer -> the shared batcher. The result
 * must equal the committed `contracts/wearables-ingest-v1.fixture.json`, whose
 * sha256 is pinned here AND in growth-project-backend
 * (`test/wearables/ingest-contract.spec.ts`), where the same bytes are parsed
 * with the backend's `.strict()` Zod schema. A change on either side that
 * breaks the contract fails one of the two suites.
 *
 * Regenerate (only for a deliberate contract change, then copy the file to
 * the backend's `test/_fixtures/wearables-ingest-v1.mobile.json` and update
 * both pins):
 *   UPDATE_INGEST_CONTRACT=1 npx jest src/services/health/__tests__/ingestContract.test.ts
 */

import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import { normalizeHealthKitResult } from '../healthkit/healthKitNormalizer';
import { normalizeAll } from '../healthConnect/healthConnectNormalizer';
import { chunkForIngest, toIngestWire, type IngestWireSample } from '../ingestBatching';

const FIXTURE_PATH = path.join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'contracts',
  'wearables-ingest-v1.fixture.json',
);

/** Pinned in both repos. Update both together, never one. */
const FIXTURE_SHA256 = '3c8701f9f9f592a188115bb6eea63b0417d38eba306d238465ac02de51579cfb';

const HK_CONNECTION = '11111111-1111-4111-8111-111111111111';
const HC_CONNECTION = '22222222-2222-4222-8222-222222222222';

/**
 * Apple Health read pass, shaped like `react-native-health` output. Times use
 * the library's real format (local offset without a colon, for example
 * `-0700`), which the backend must accept.
 */
function healthKitSamples() {
  return normalizeHealthKitResult(
    {
      steps: [
        {
          value: 812,
          startDate: '2026-09-29T07:00:00.000-0700',
          endDate: '2026-09-29T08:00:00.000-0700',
        },
        {
          value: 2405,
          startDate: '2026-09-29T08:00:00.000-0700',
          endDate: '2026-09-29T09:00:00.000-0700',
        },
      ],
      activeEnergy: [
        {
          value: 61.5,
          startDate: '2026-09-29T07:00:00.000-0700',
          endDate: '2026-09-29T08:00:00.000-0700',
        },
      ],
      restingHeartRate: [
        {
          value: 54,
          startDate: '2026-09-29T00:00:00.000-0700',
          endDate: '2026-09-29T23:59:59.000-0700',
        },
      ],
      heartRate: [
        {
          value: 72,
          startDate: '2026-09-29T08:15:00.000-0700',
          endDate: '2026-09-29T08:15:00.000-0700',
        },
      ],
      hrv: [
        {
          value: 0.048,
          startDate: '2026-09-29T06:10:00.000-0700',
          endDate: '2026-09-29T06:10:00.000-0700',
        },
      ],
      // B-317-4: the client asks HealthKit for kilograms; the wire value is kg.
      weight: [
        {
          value: 81.6,
          startDate: '2026-09-29T06:40:00.000-0700',
          endDate: '2026-09-29T06:40:00.000-0700',
        },
      ],
      sleep: [
        {
          value: 'INBED',
          startDate: '2026-09-28T22:30:00.000-0700',
          endDate: '2026-09-29T06:30:00.000-0700',
        },
        {
          value: 'CORE',
          startDate: '2026-09-28T22:45:00.000-0700',
          endDate: '2026-09-29T01:15:00.000-0700',
        },
        {
          value: 'DEEP',
          startDate: '2026-09-29T01:15:00.000-0700',
          endDate: '2026-09-29T02:45:00.000-0700',
        },
        {
          value: 'REM',
          startDate: '2026-09-29T02:45:00.000-0700',
          endDate: '2026-09-29T04:15:00.000-0700',
        },
        {
          value: 'AWAKE',
          startDate: '2026-09-29T04:15:00.000-0700',
          endDate: '2026-09-29T04:30:00.000-0700',
        },
        {
          value: 'CORE',
          startDate: '2026-09-29T04:30:00.000-0700',
          endDate: '2026-09-29T06:15:00.000-0700',
        },
      ],
    },
    { connectionId: HK_CONNECTION, sourceTz: 'America/Los_Angeles' },
  );
}

/** Health Connect read pass, shaped like `react-native-health-connect` records. */
function healthConnectSamples() {
  return normalizeAll(
    { connectionId: HC_CONNECTION },
    {
      Steps: [
        {
          startTime: '2026-09-29T14:00:00.000Z',
          endTime: '2026-09-29T15:00:00.000Z',
          count: 1320,
          metadata: { id: 'hc-steps-1' },
        },
      ],
      HeartRate: [
        {
          startTime: '2026-09-29T15:00:00.000Z',
          endTime: '2026-09-29T15:05:00.000Z',
          samples: [
            { time: '2026-09-29T15:00:00.000Z', beatsPerMinute: 88 },
            { time: '2026-09-29T15:05:00.000Z', beatsPerMinute: 91 },
          ],
          metadata: { id: 'hc-hr-1' },
        },
      ],
      RestingHeartRate: [
        {
          time: '2026-09-29T13:00:00.000Z',
          beatsPerMinute: 56,
          metadata: { id: 'hc-rhr-1' },
        },
      ],
      SleepSession: [
        {
          startTime: '2026-09-29T05:30:00.000Z',
          endTime: '2026-09-29T13:30:00.000Z',
          stages: [
            {
              startTime: '2026-09-29T05:30:00.000Z',
              endTime: '2026-09-29T08:00:00.000Z',
              stage: 4,
            },
            {
              startTime: '2026-09-29T08:00:00.000Z',
              endTime: '2026-09-29T09:30:00.000Z',
              stage: 5,
            },
            {
              startTime: '2026-09-29T09:30:00.000Z',
              endTime: '2026-09-29T11:00:00.000Z',
              stage: 6,
            },
            {
              startTime: '2026-09-29T11:00:00.000Z',
              endTime: '2026-09-29T11:20:00.000Z',
              stage: 1,
            },
          ],
          metadata: { id: 'hc-sleep-1' },
        },
      ],
      Weight: [
        {
          time: '2026-09-29T14:30:00.000Z',
          weight: { inKilograms: 81.4 },
          metadata: { id: 'hc-w-1' },
        },
      ],
    },
  );
}

function buildFixture(): { version: string; requests: IngestWireSample[][] } {
  const hk = chunkForIngest(healthKitSamples().map(toIngestWire));
  const hc = chunkForIngest(healthConnectSamples().map(toIngestWire));
  return { version: 'wearables-ingest-v1', requests: [...hk, ...hc] };
}

function serialize(fixture: unknown): string {
  return `${JSON.stringify(fixture, null, 2)}\n`;
}

const ALLOWED_KEYS = new Set([
  'connectionId',
  'provider',
  'metric',
  'bucket',
  'value',
  'unit',
  'startAt',
  'endAt',
  'sourceTz',
  'sourceRecordId',
  'rawRef',
]);

describe('S14 ingest contract fixture', () => {
  const built = serialize(buildFixture());

  if (process.env.UPDATE_INGEST_CONTRACT === '1') {
    fs.mkdirSync(path.dirname(FIXTURE_PATH), { recursive: true });
    fs.writeFileSync(FIXTURE_PATH, built);
  }

  it('matches the committed fixture byte for byte', () => {
    expect(fs.readFileSync(FIXTURE_PATH, 'utf8')).toBe(built);
  });

  it('matches the sha256 pinned in both repos', () => {
    const digest = createHash('sha256').update(fs.readFileSync(FIXTURE_PATH)).digest('hex');
    expect(digest).toBe(FIXTURE_SHA256);
  });

  it('never carries userId and only uses keys the backend schema allows', () => {
    const fixture = JSON.parse(built) as {
      requests: Record<string, unknown>[][];
    };
    expect(fixture.requests.length).toBeGreaterThanOrEqual(2);
    for (const body of fixture.requests) {
      expect(body.length).toBeGreaterThan(0);
      for (const sample of body) {
        expect(sample).not.toHaveProperty('userId');
        for (const key of Object.keys(sample)) expect(ALLOWED_KEYS.has(key)).toBe(true);
      }
    }
  });

  it('covers both on-device providers and the metrics the Health and Sleep views read', () => {
    const fixture = JSON.parse(built) as {
      requests: { provider: string; metric: string }[][];
    };
    const all = fixture.requests.flat();
    const providers = new Set(all.map((s) => s.provider));
    expect(providers).toEqual(new Set(['APPLE_HEALTHKIT', 'HEALTH_CONNECT']));
    const metrics = new Set(all.map((s) => s.metric));
    for (const m of [
      'STEPS',
      'ACTIVE_ENERGY_KCAL',
      'RESTING_HEART_RATE_BPM',
      'HRV_MS',
      'SLEEP_DEEP_MIN',
      'SLEEP_REM_MIN',
      'SLEEP_LIGHT_MIN',
      'SLEEP_AWAKE_MIN',
    ]) {
      expect(metrics.has(m)).toBe(true);
    }
  });

  it('B-317-4: both providers carry body weight in kilograms', () => {
    const fixture = JSON.parse(built) as {
      requests: { provider: string; metric: string; value: number; unit: string }[][];
    };
    const weights = fixture.requests.flat().filter((s) => s.metric === 'BODY_WEIGHT_KG');
    expect(new Set(weights.map((w) => w.provider))).toEqual(
      new Set(['APPLE_HEALTHKIT', 'HEALTH_CONNECT']),
    );
    for (const w of weights) {
      expect(w.unit).toBe('kg');
      // A pounds value (about 2.2x) would land outside this band.
      expect(w.value).toBeGreaterThan(30);
      expect(w.value).toBeLessThan(150);
    }
  });
});
