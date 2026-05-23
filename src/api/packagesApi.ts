// Coach packages — coach-authored offerings clients can purchase.
//
// Contract alignment (audit PR149 R1):
//   • Backend list returns `{ packages: rows }`; we unwrap to a flat array.
//   • Backend archive is `DELETE /v1/coach/packages/:id`; we use that verb.
//   • Backend payload is snake_case; we map mobile camelCase ↔ backend
//     snake_case so screens keep the typed CoachPackage shape.
//   • Backend checkout is `POST /v1/checkout/sessions` with `{ package_id,
//     success_url, cancel_url }`. The earlier `POST /v1/packages/:token/
//     checkout` route is planned but not deployed yet — see TODO below.
//
// Routes (live):
//   GET    /v1/coach/packages                  → { packages: [...] }
//   POST   /v1/coach/packages                  → create (snake_case body)
//   PATCH  /v1/coach/packages/:id              → update (snake_case body)
//   DELETE /v1/coach/packages/:id              → archive / soft-delete
//   POST   /v1/checkout/sessions               → Stripe Checkout Session
//                                               (server resolves token →
//                                                package_id, or accepts a
//                                                direct package_id)
//
// Routes (TODO — backend not deployed yet, surfaced as empty state):
//   GET    /v1/coach/packages/:id              → coach-owned detail
//   GET    /v1/coach/packages/:id/subscribers  → subscribers list
//   GET    /v1/coach/earnings                  → earnings summary
//   GET    /v1/packages/:shareToken            → public package view
//
// Every mutation sends a client-generated UUID `Idempotency-Key` header so
// retries/double-taps don't create duplicate rows or duplicate Checkout
// sessions (R19).

import api from '../services/api';
import { isValidPackageShareToken } from '../utils/packageShare';

export type PackageBillingInterval = 'one_time' | 'monthly' | 'quarterly' | 'yearly';

export type PackageStatus = 'draft' | 'active' | 'archived';

export interface CoachPackage {
  id: string;
  coachUserId: string;
  title: string;
  description: string | null;
  priceCents: number;
  currency: string; // ISO-4217 lower-case e.g. 'usd'
  billingInterval: PackageBillingInterval;
  intervalCount: number;
  trialDays: number | null;
  features: string[];
  status: PackageStatus;
  shareToken: string | null;
  subscriberCount: number;
  monthlyRevenueCents: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface PackageCreateInput {
  title: string;
  description?: string | null;
  priceCents: number;
  currency?: string;
  billingInterval: PackageBillingInterval;
  intervalCount?: number;
  trialDays?: number | null;
  features?: string[];
}

export type PackageUpdateInput = Partial<PackageCreateInput> & {
  status?: PackageStatus;
};

export interface PackageSubscriber {
  id: string;
  userId: string;
  name: string;
  email: string;
  startedAt: string;
  status: 'active' | 'past_due' | 'canceled' | 'trialing';
  nextRenewalAt: string | null;
  totalPaidCents: number;
}

export interface PackageSubscribersResponse {
  packageId: string;
  subscribers: PackageSubscriber[];
  totalActive: number;
  monthlyRecurringRevenueCents: number;
}

export interface CoachEarningsSummary {
  currency: string;
  pendingPayoutCents: number;
  lifetimeNetCents: number;
  monthToDateNetCents: number;
  lastPayoutAt: string | null;
  lastPayoutAmountCents: number | null;
  nextPayoutEta: string | null;
  perPackage: Array<{
    packageId: string;
    title: string;
    monthToDateGrossCents: number;
    activeSubscribers: number;
  }>;
}

export interface PublicPackageView {
  id: string;
  title: string;
  description: string | null;
  priceCents: number;
  currency: string;
  billingInterval: PackageBillingInterval;
  intervalCount: number;
  trialDays: number | null;
  features: string[];
  coach: {
    id: string;
    displayName: string;
    avatarUrl: string | null;
    bio: string | null;
  };
}

export interface CheckoutSessionResponse {
  url?: string;
  sessionId?: string;
  paymentIntentClientSecret?: string;
  setupIntentClientSecret?: string;
  ephemeralKey?: string;
  customerId?: string;
  publishableKey?: string;
}

// ─── helpers ────────────────────────────────────────────────────────────────

// Generate a UUID v4 with no extra deps. Idempotency keys do not need to be
// cryptographically secure — uniqueness per user-action is sufficient — but
// we still seed from Math.random() with high entropy via the standard v4
// pattern. expo-crypto is async; this stays sync so callers can stamp the
// header inline.
export function newIdempotencyKey(): string {
  // RFC 4122 v4
  const r = (n: number) =>
    Math.floor(Math.random() * 0x100000000)
      .toString(16)
      .padStart(8, '0')
      .slice(0, n);
  const a = r(8);
  const b = r(4);
  const c = '4' + r(3);
  const d = ((8 + Math.floor(Math.random() * 4)).toString(16) + r(3));
  const e = r(8) + r(4);
  return `${a}-${b}-${c}-${d}-${e}`;
}

function idemHeaders(key?: string): { headers: { 'Idempotency-Key': string } } {
  return { headers: { 'Idempotency-Key': key ?? newIdempotencyKey() } };
}

const BILLING_TYPE_FOR_INTERVAL: Record<PackageBillingInterval, 'one_time' | 'recurring'> = {
  one_time: 'one_time',
  monthly: 'recurring',
  quarterly: 'recurring',
  yearly: 'recurring',
};

interface BackendPackageRow {
  id?: string;
  coach_user_id?: string;
  name?: string;
  title?: string;
  description?: string | null;
  amount_cents?: number;
  price_cents?: number;
  currency?: string;
  billing_type?: 'one_time' | 'recurring';
  billing_interval?: PackageBillingInterval | 'month' | 'quarter' | 'year';
  billing_interval_count?: number;
  interval_count?: number;
  trial_days?: number | null;
  features?: string[];
  status?: PackageStatus;
  is_active?: boolean;
  share_token?: string | null;
  subscriber_count?: number;
  monthly_revenue_cents?: number;
  created_at?: string;
  updated_at?: string;
  archived_at?: string | null;
}

function fromBackend(row: BackendPackageRow): CoachPackage {
  const interval =
    (row.billing_interval as PackageBillingInterval) ||
    (row.billing_type === 'one_time' ? 'one_time' : 'monthly');
  const status: PackageStatus =
    row.status ?? (row.is_active === false ? 'archived' : 'active');
  return {
    id: row.id ?? '',
    coachUserId: row.coach_user_id ?? '',
    title: row.name ?? row.title ?? '',
    description: row.description ?? null,
    priceCents: row.amount_cents ?? row.price_cents ?? 0,
    currency: row.currency ?? 'usd',
    billingInterval: interval,
    intervalCount: row.billing_interval_count ?? row.interval_count ?? 1,
    trialDays: row.trial_days ?? null,
    features: Array.isArray(row.features) ? row.features : [],
    status,
    shareToken: row.share_token ?? null,
    subscriberCount: row.subscriber_count ?? 0,
    monthlyRevenueCents: row.monthly_revenue_cents ?? 0,
    createdAt: row.created_at ?? '',
    updatedAt: row.updated_at ?? '',
    archivedAt: row.archived_at ?? null,
  };
}

interface BackendCreateBody {
  name: string;
  description?: string | null;
  amount_cents: number;
  currency?: string;
  billing_type: 'one_time' | 'recurring';
  billing_interval: PackageBillingInterval;
  billing_interval_count: number;
  trial_days?: number | null;
  features?: string[];
  is_active?: boolean;
}

function toBackendCreate(input: PackageCreateInput): BackendCreateBody {
  return {
    name: input.title,
    description: input.description ?? null,
    amount_cents: input.priceCents,
    currency: input.currency,
    billing_type: BILLING_TYPE_FOR_INTERVAL[input.billingInterval],
    billing_interval: input.billingInterval,
    billing_interval_count: input.intervalCount ?? 1,
    trial_days: input.trialDays ?? null,
    features: input.features ?? [],
  };
}

function toBackendUpdate(input: PackageUpdateInput): Partial<BackendCreateBody> {
  const out: Partial<BackendCreateBody> = {};
  if (input.title !== undefined) out.name = input.title;
  if (input.description !== undefined) out.description = input.description;
  if (input.priceCents !== undefined) out.amount_cents = input.priceCents;
  if (input.currency !== undefined) out.currency = input.currency;
  if (input.billingInterval !== undefined) {
    out.billing_type = BILLING_TYPE_FOR_INTERVAL[input.billingInterval];
    out.billing_interval = input.billingInterval;
  }
  if (input.intervalCount !== undefined) out.billing_interval_count = input.intervalCount;
  if (input.trialDays !== undefined) out.trial_days = input.trialDays;
  if (input.features !== undefined) out.features = input.features;
  if (input.status !== undefined) out.is_active = input.status === 'active';
  return out;
}

// ─── coach API ──────────────────────────────────────────────────────────────

export const coachPackagesApi = {
  list: async () => {
    const res = await api.get<{ packages?: BackendPackageRow[] } | BackendPackageRow[]>(
      '/v1/coach/packages',
    );
    const rows = Array.isArray(res.data)
      ? res.data
      : Array.isArray(res.data?.packages)
      ? (res.data!.packages as BackendPackageRow[])
      : [];
    return { ...res, data: rows.map(fromBackend) };
  },

  // TODO(backend): `GET /v1/coach/packages/:id` (coach-owned detail) is not
  // yet exposed by the backend packages controller. Until it ships, the edit
  // screen falls back to the row already loaded in the list. The wrapper is
  // kept so the route can be wired in a future PR without churning callers.
  get: async (id: string) => {
    const res = await api.get<BackendPackageRow>(
      `/v1/coach/packages/${encodeURIComponent(id)}`,
    );
    return { ...res, data: fromBackend(res.data) };
  },

  create: async (input: PackageCreateInput, idempotencyKey?: string) => {
    const res = await api.post<BackendPackageRow>(
      '/v1/coach/packages',
      toBackendCreate(input),
      idemHeaders(idempotencyKey),
    );
    return { ...res, data: fromBackend(res.data) };
  },

  update: async (
    id: string,
    input: PackageUpdateInput,
    idempotencyKey?: string,
  ) => {
    const res = await api.patch<BackendPackageRow>(
      `/v1/coach/packages/${encodeURIComponent(id)}`,
      toBackendUpdate(input),
      idemHeaders(idempotencyKey),
    );
    return { ...res, data: fromBackend(res.data) };
  },

  // Backend exposes archive as a soft-delete via HTTP DELETE.
  archive: async (id: string, idempotencyKey?: string) => {
    const res = await api.delete<BackendPackageRow | { ok?: true }>(
      `/v1/coach/packages/${encodeURIComponent(id)}`,
      idemHeaders(idempotencyKey),
    );
    const body = res.data as BackendPackageRow | { ok?: true } | undefined;
    // Some backends return only `{ ok: true }` on DELETE. Synthesize an
    // archived record from the id so the caller can update local state
    // without re-fetching.
    const row: BackendPackageRow =
      body && typeof body === 'object' && 'id' in (body as BackendPackageRow)
        ? (body as BackendPackageRow)
        : { id, is_active: false, status: 'archived' };
    return { ...res, data: fromBackend(row) };
  },

  // TODO(backend): `GET /v1/coach/packages/:id/subscribers` not yet deployed.
  // Callers must treat 404 / NOT_CONFIGURED as an empty state.
  subscribers: (id: string) =>
    api.get<PackageSubscribersResponse>(
      `/v1/coach/packages/${encodeURIComponent(id)}/subscribers`,
    ),

  // TODO(backend): `GET /v1/coach/earnings` not yet deployed. Callers must
  // treat 404 / NOT_CONFIGURED as an empty state and never claim totals.
  earnings: () => api.get<CoachEarningsSummary>('/v1/coach/earnings'),
};

// ─── public / client-facing API ─────────────────────────────────────────────

export const publicPackagesApi = {
  // TODO(backend): `GET /v1/packages/:shareToken` (public marketing view) is
  // planned but not deployed. PackageCheckoutScreen treats 404 as "link not
  // found" and renders an actionable empty state instead of crashing.
  getByShareToken: (shareToken: string) => {
    if (!isValidPackageShareToken(shareToken)) {
      return Promise.reject(new Error('INVALID_SHARE_TOKEN'));
    }
    return api.get<PublicPackageView>(
      `/v1/packages/${encodeURIComponent(shareToken)}`,
    );
  },

  // Aligned to backend `POST /v1/checkout/sessions` with
  // { package_id, success_url, cancel_url } — see growth-project-backend
  // src/checkout/checkout.controller.ts. The mobile only has the share token
  // at this point; we send it as `share_token` so the server can resolve to
  // the package. Server-side, both `share_token` and `package_id` are
  // accepted (whichever the deployed contract supports).
  //
  // TODO(backend): once the dedicated `POST /v1/packages/:shareToken/
  // checkout` route lands, switch to that path so the share-token →
  // package_id resolution lives entirely on the server.
  createCheckoutSession: (
    shareToken: string,
    body: { returnUrl?: string; successUrl?: string; cancelUrl?: string } = {},
    idempotencyKey?: string,
  ) => {
    if (!isValidPackageShareToken(shareToken)) {
      return Promise.reject(new Error('INVALID_SHARE_TOKEN'));
    }
    const successUrl =
      body.successUrl ?? body.returnUrl ?? 'tgp://packages/return';
    const cancelUrl = body.cancelUrl ?? body.returnUrl ?? 'tgp://packages/return';
    return api.post<CheckoutSessionResponse>(
      '/v1/checkout/sessions',
      {
        share_token: shareToken,
        success_url: successUrl,
        cancel_url: cancelUrl,
      },
      idemHeaders(idempotencyKey),
    );
  },
};
