/**
 * wearablesConnectionsApi — typed client for the generic wearable connection
 * management API (PR-HK-1-mobile over backend PR-HK-1).
 *
 * Backend contract source of truth (binding):
 *   growth-project-backend/src/wearables/connections/connections.controller.ts
 *   growth-project-backend/src/wearables/connections/connections.service.ts
 *   growth-project-backend/src/wearables/connections/types.ts
 *
 * Endpoints (all JWT-authenticated, user-scoped — the owning user comes from
 * the verified token, never from the request body/path; no IDOR surface):
 *   - GET    /v1/wearables/connections
 *       → SafeWearableConnection[]  (token-free projection; NEVER any
 *         `encrypted_*` / `*_secret_ref` columns).
 *   - POST   /v1/wearables/connections/oauth/start  { provider }
 *       → { authorizationUrl, state }  for cloud-OAuth providers.
 *         On-device providers (Apple HealthKit / Health Connect / Samsung
 *         Health) are rejected here with a 400 — they have no server OAuth
 *         flow; their samples arrive via the ingest endpoint (PR-HK-2.a/b/c).
 *         The mobile app therefore branches on `providerAuthModel()` and never
 *         calls `startOauth` for an on-device provider.
 *   - DELETE /v1/wearables/connections/:provider
 *       → { success, provider }  (soft-disconnect).
 *
 * NOTE on the OAuth callback: the provider redirects to the SERVER callback
 * (`GET /v1/wearables/connections/oauth/callback?code&state`) — the in-app
 * auth session carries the user's JWT so that route stays authenticated. The
 * mobile app does NOT call the callback itself; it opens `authorizationUrl`
 * and, when the auth session returns, re-fetches the connection list to learn
 * the result. There is therefore no client method for the callback by design.
 *
 * Every response is validated with Zod at the boundary (#8 phantom-validation):
 * a wire shape that drifts from the backend DTO throws instead of silently
 * feeding a malformed object into React state.
 */

import { z } from 'zod';
import api from '../services/api';

// ─── Provider enum (mirror of backend `WearableProvider`) ────────────────────

/**
 * Canonical provider ids. MUST mirror the backend `WearableProvider` enum
 * (growth-project-backend prisma schema §2.1). The connect sheet + connections
 * list render only providers present here.
 */
export const WEARABLE_PROVIDERS = [
  'APPLE_HEALTHKIT',
  'HEALTH_CONNECT',
  'GARMIN',
  'FITBIT',
  'STRAVA',
  'POLAR',
  'SAMSUNG_HEALTH',
  'WAHOO',
  'WITHINGS',
  'PELOTON',
  'MYFITNESSPAL',
  'OURA',
  'WHOOP',
  'EIGHT_SLEEP',
  'BEDDIT',
] as const;

export type WearableProvider = (typeof WEARABLE_PROVIDERS)[number];

// ─── Connection status (mirror of backend `WearableConnectionStatus`) ────────

/**
 * Connection lifecycle states. Mirrors the documented values on
 * `WearableConnection.status` (backend connections/types.ts):
 *   - connected    — active; tokens valid (cloud) or device-permission granted.
 *   - expired      — token/consent expired; needs re-link (→ "Reconnect").
 *   - error        — provider outage / refresh failure (fail-explicit).
 *   - disconnected — soft-disconnected by the user; tokens cleared, audit kept.
 *
 * The backend column is a free-form string; this enum pins the canonical set.
 * `parseConnections` accepts ANY string for `status` (forward-compat) but the
 * UI maps unknown values to a neutral grey/disconnected treatment.
 */
export const WEARABLE_STATUSES = [
  'connected',
  'expired',
  'error',
  'disconnected',
] as const;

export type WearableConnectionStatus = (typeof WEARABLE_STATUSES)[number];

// ─── Auth-model registry (client-side; mirrors connector.authModel) ──────────

/**
 * Whether a provider connects via a server-side OAuth round-trip (`oauth2`) or
 * is read on-device through a native SDK (`on-device`). The backend resolves
 * this from its connector registry; the client mirrors the on-device set so
 * the connect flow can branch BEFORE calling `startOauth` (which would 400 for
 * an on-device provider). Single source of truth on the client for this fork.
 */
export type WearableAuthModel = 'oauth2' | 'on-device';

const ON_DEVICE_PROVIDERS: ReadonlySet<WearableProvider> = new Set<WearableProvider>([
  'APPLE_HEALTHKIT',
  'HEALTH_CONNECT',
  'SAMSUNG_HEALTH',
]);

/** True when the provider's data is read on-device (no server OAuth flow). */
export function isOnDeviceProvider(provider: WearableProvider): boolean {
  return ON_DEVICE_PROVIDERS.has(provider);
}

/** The connect auth-model for a provider. */
export function providerAuthModel(provider: WearableProvider): WearableAuthModel {
  return isOnDeviceProvider(provider) ? 'on-device' : 'oauth2';
}

// ─── Per-provider presentation config (single source of truth for the UI) ────

/**
 * Per-provider display metadata read by both the connections list and the
 * connect sheet — display name, a short brand glyph (placeholder Text icon; a
 * real asset can replace `icon` later without touching call-sites), the data
 * the provider shares (rendered as the connect sheet's plain-language
 * explainer), and its bucket(s) for grouping/sorting. Keeping this in ONE map
 * (guard #40) means the row and the sheet never disagree on a provider's name
 * or description.
 */
export interface ProviderConfig {
  readonly provider: WearableProvider;
  readonly displayName: string;
  /** Brand-asset placeholder. Swap for a vector brand asset later. */
  readonly icon: string;
  /** Plain-language statement of what we'll read (connect-sheet body). */
  readonly dataDescription: string;
  /** Which canonical buckets this source feeds (for grouping/sorting). */
  readonly buckets: ReadonlyArray<'HEALTH_FITNESS' | 'SLEEP_RECOVERY'>;
}

export const PROVIDER_CONFIG: Readonly<Record<WearableProvider, ProviderConfig>> = {
  APPLE_HEALTHKIT: {
    provider: 'APPLE_HEALTHKIT',
    displayName: 'Apple Health',
    icon: '',
    dataDescription:
      "We'll read your activity, heart rate, workouts and sleep from Apple Health on this device.",
    buckets: ['HEALTH_FITNESS', 'SLEEP_RECOVERY'],
  },
  HEALTH_CONNECT: {
    provider: 'HEALTH_CONNECT',
    displayName: 'Health Connect',
    icon: '',
    dataDescription:
      "We'll read your steps, heart rate, workouts and sleep from Health Connect on this device.",
    buckets: ['HEALTH_FITNESS', 'SLEEP_RECOVERY'],
  },
  SAMSUNG_HEALTH: {
    provider: 'SAMSUNG_HEALTH',
    displayName: 'Samsung Health',
    icon: '',
    dataDescription:
      "We'll read your steps, heart rate, body composition and sleep from Samsung Health on this device.",
    buckets: ['HEALTH_FITNESS', 'SLEEP_RECOVERY'],
  },
  GARMIN: {
    provider: 'GARMIN',
    displayName: 'Garmin',
    icon: '',
    dataDescription:
      "We'll read your activities, daily stats, sleep, HRV and Body Battery from Garmin Connect.",
    buckets: ['HEALTH_FITNESS', 'SLEEP_RECOVERY'],
  },
  FITBIT: {
    provider: 'FITBIT',
    displayName: 'Fitbit',
    icon: '',
    dataDescription:
      "We'll read your activity, heart rate, sleep, weight and SpO2 from Fitbit.",
    buckets: ['HEALTH_FITNESS', 'SLEEP_RECOVERY'],
  },
  STRAVA: {
    provider: 'STRAVA',
    displayName: 'Strava',
    icon: '',
    dataDescription: "We'll read your activities and workouts from Strava.",
    buckets: ['HEALTH_FITNESS'],
  },
  POLAR: {
    provider: 'POLAR',
    displayName: 'Polar',
    icon: '',
    dataDescription:
      "We'll read your exercises, sleep and nightly recharge from Polar Flow.",
    buckets: ['HEALTH_FITNESS', 'SLEEP_RECOVERY'],
  },
  WAHOO: {
    provider: 'WAHOO',
    displayName: 'Wahoo',
    icon: '',
    dataDescription: "We'll read your workouts and heart rate from Wahoo.",
    buckets: ['HEALTH_FITNESS'],
  },
  WITHINGS: {
    provider: 'WITHINGS',
    displayName: 'Withings',
    icon: '',
    dataDescription:
      "We'll read your weight, body composition, blood pressure and sleep from Withings.",
    buckets: ['HEALTH_FITNESS', 'SLEEP_RECOVERY'],
  },
  PELOTON: {
    provider: 'PELOTON',
    displayName: 'Peloton',
    icon: '',
    dataDescription: "We'll read your workouts and heart rate from Peloton.",
    buckets: ['HEALTH_FITNESS'],
  },
  MYFITNESSPAL: {
    provider: 'MYFITNESSPAL',
    displayName: 'MyFitnessPal',
    icon: '',
    dataDescription: "We'll read your nutrition diary from MyFitnessPal.",
    buckets: ['HEALTH_FITNESS'],
  },
  OURA: {
    provider: 'OURA',
    displayName: 'Oura',
    icon: '',
    dataDescription:
      "We'll read your sleep, readiness, HRV and SpO2 from your Oura ring.",
    buckets: ['SLEEP_RECOVERY', 'HEALTH_FITNESS'],
  },
  WHOOP: {
    provider: 'WHOOP',
    displayName: 'WHOOP',
    icon: '',
    dataDescription:
      "We'll read your recovery, strain, sleep and HRV from WHOOP.",
    buckets: ['SLEEP_RECOVERY', 'HEALTH_FITNESS'],
  },
  EIGHT_SLEEP: {
    provider: 'EIGHT_SLEEP',
    displayName: 'Eight Sleep',
    icon: '',
    dataDescription:
      "We'll read your sleep, HRV and respiratory rate from Eight Sleep.",
    buckets: ['SLEEP_RECOVERY'],
  },
  BEDDIT: {
    provider: 'BEDDIT',
    displayName: 'Beddit',
    icon: '',
    dataDescription: "We'll read your sleep from Beddit (via Apple Health).",
    buckets: ['SLEEP_RECOVERY'],
  },
};

/** Resolve presentation config for a provider (always defined). */
export function configFor(provider: WearableProvider): ProviderConfig {
  return PROVIDER_CONFIG[provider];
}

// ─── Zod schemas (runtime validation at the wire boundary) ───────────────────

const providerSchema = z.enum(WEARABLE_PROVIDERS);

/**
 * The token-free connection projection (mirror of backend
 * `SafeWearableConnection`). Date columns arrive as ISO strings over the wire;
 * we keep them as strings here (the UI humanizes `last_synced_at` with a
 * relative formatter) rather than eagerly `new Date()`-ing — a malformed date
 * string then surfaces in the UI layer, not as a parse throw.
 *
 * `status` is a free-form string on the backend, so we accept any string here
 * (forward-compatible with new lifecycle values) and normalize in the UI.
 */
export const safeWearableConnectionSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  provider: providerSchema,
  external_account_id: z.string().nullable(),
  access_token_expires_at: z.string().nullable(),
  scopes: z.array(z.string()),
  webhook_subscription_id: z.string().nullable(),
  channel_expires_at: z.string().nullable(),
  status: z.string(),
  last_error: z.string().nullable(),
  last_synced_at: z.string().nullable(),
  backfilled_until: z.string().nullable(),
  disconnected_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type WearableConnection = z.infer<typeof safeWearableConnectionSchema>;

const connectionListSchema = z.array(safeWearableConnectionSchema);

/** Result of starting an OAuth connect flow (mirror of `StartOauthResult`). */
export const startOauthResultSchema = z.object({
  authorizationUrl: z.string().url(),
  state: z.string().min(1),
});

export type StartOauthResult = z.infer<typeof startOauthResultSchema>;

/** Result of a soft-disconnect (mirror of `DisconnectResult`). */
export const disconnectResultSchema = z.object({
  success: z.literal(true),
  provider: providerSchema,
});

export type DisconnectResult = z.infer<typeof disconnectResultSchema>;

// ─── Client ──────────────────────────────────────────────────────────────────

const BASE = '/v1/wearables/connections';

export const wearablesConnectionsApi = {
  /**
   * List the caller's wearable connections (token-free). The array is sorted
   * server-side by `created_at asc`; the UI groups/sorts for display.
   * @throws ZodError if the wire shape drifts from the backend DTO.
   */
  async list(): Promise<WearableConnection[]> {
    const res = await api.get<unknown>(BASE);
    return connectionListSchema.parse(res.data);
  },

  /**
   * Begin a cloud-OAuth connect flow for a provider. Returns the provider
   * authorization URL + an opaque single-use CSRF state for the client to open
   * in an in-app browser / auth session.
   *
   * Must NOT be called for on-device providers (the backend 400s them) — the
   * caller branches on {@link isOnDeviceProvider} first. We still guard here so
   * a programming error fails loud on the client instead of round-tripping.
   * @throws Error for on-device providers; ZodError on a drifted response.
   */
  async startOauth(provider: WearableProvider): Promise<StartOauthResult> {
    if (isOnDeviceProvider(provider)) {
      throw new Error(
        `${provider} is an on-device source and has no OAuth connect flow.`,
      );
    }
    const res = await api.post<unknown>(`${BASE}/oauth/start`, { provider });
    return startOauthResultSchema.parse(res.data);
  },

  /**
   * Soft-disconnect the caller's connection for a provider. Idempotent from the
   * UI's perspective: a 404 (no connection) is surfaced as a thrown error so
   * the caller never mistakes a no-op for success.
   * @throws ZodError on a drifted response.
   */
  async disconnect(provider: WearableProvider): Promise<DisconnectResult> {
    const res = await api.delete<unknown>(`${BASE}/${provider}`);
    return disconnectResultSchema.parse(res.data);
  },
};
