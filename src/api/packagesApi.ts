// Coach packages — coach-authored offerings clients can purchase.
//
// Contract alignment (audit PR149 R2):
//   • Backend list returns `{ packages: rows }`; we unwrap to a flat array.
//   • Backend archive is `DELETE /v1/coach/packages/:id`; we use that verb.
//   • Backend payload is snake_case; we map mobile camelCase ↔ backend
//     snake_case so screens keep the typed CoachPackage shape.
//   • Backend `CreatePackageDto` accepts: name, description, amount_cents,
//     currency, billing_type ('one_time'|'recurring'), billing_interval
//     ('week'|'month'|'year'), billing_interval_count, is_active. We map
//     mobile UI values ('monthly','quarterly','yearly') to backend enums.
//   • Backend `UpdatePackageDto` accepts only: name, description,
//     amount_cents, currency, is_active. trial_days/features are TODO.
//   • Backend checkout is `POST /v1/checkout/sessions` with `{ package_id,
//     success_url, cancel_url }`. URLs must use growthproject://,
//     com.growthproject.app://, or https:// prefixes.
//
// Every mutation sends a client-generated UUID `Idempotency-Key` header so
// retries/double-taps don't create duplicate rows or duplicate Checkout
// sessions (R19). The key is generated via crypto.randomUUID() / expo-crypto
// so the value is cryptographically secure on a payments surface.

import api from '../services/api';
import { isValidPackageShareToken } from '../utils/packageShare';

export type PackageBillingInterval = 'one_time' | 'monthly' | 'quarterly' | 'yearly';

export type PackageStatus = 'draft' | 'active' | 'archived';

// Backend deep-link prefixes allowed for checkout redirects. Backend rejects
// anything else (see growth-project-backend checkout.controller.ts).
export const PACKAGE_CHECKOUT_SUCCESS_URL = 'growthproject://checkout/return';
export const PACKAGE_CHECKOUT_CANCEL_URL = 'growthproject://checkout/cancel';

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

// Cryptographically secure UUID v4. On Hermes (RN/Expo SDK 55+) and on web,
// `crypto.randomUUID()` is available and is backed by the platform CSPRNG.
// We fall back to `crypto.getRandomValues` and then to expo-crypto. Math.random
// is never used — this is a payments surface (R19).
export function newIdempotencyKey(): string {
  const g: { crypto?: { randomUUID?: () => string; getRandomValues?: (a: Uint8Array) => Uint8Array } } =
    globalThis as unknown as {
      crypto?: { randomUUID?: () => string; getRandomValues?: (a: Uint8Array) => Uint8Array };
    };
  if (g.crypto && typeof g.crypto.randomUUID === 'function') {
    return g.crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (g.crypto && typeof g.crypto.getRandomValues === 'function') {
    g.crypto.getRandomValues(bytes);
  } else {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const expoCrypto = require('expo-crypto') as {
      getRandomBytes?: (n: number) => Uint8Array;
    };
    if (!expoCrypto || typeof expoCrypto.getRandomBytes !== 'function') {
      throw new Error('No secure random source available for idempotency key');
    }
    const out = expoCrypto.getRandomBytes(16);
    for (let i = 0; i < 16; i++) bytes[i] = out[i];
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex: string[] = [];
  for (let i = 0; i < 16; i++) hex.push(bytes[i].toString(16).padStart(2, '0'));
  return (
    hex.slice(0, 4).join('') +
    '-' +
    hex.slice(4, 6).join('') +
    '-' +
    hex.slice(6, 8).join('') +
    '-' +
    hex.slice(8, 10).join('') +
    '-' +
    hex.slice(10, 16).join('')
  );
}

export function idemHeaders(key?: string): { headers: { 'Idempotency-Key': string } } {
  return { headers: { 'Idempotency-Key': key ?? newIdempotencyKey() } };
}

const BILLING_TYPE_FOR_INTERVAL: Record<PackageBillingInterval, 'one_time' | 'recurring'> = {
  one_time: 'one_time',
  monthly: 'recurring',
  quarterly: 'recurring',
  yearly: 'recurring',
};

// Mobile UI billing interval → backend enum ('week' | 'month' | 'year').
// Backend rejects 'monthly' / 'quarterly' / 'yearly' (whitelist validator).
function toBackendIntervalFields(
  interval: PackageBillingInterval,
  intervalCountInput?: number,
): { billing_interval?: 'week' | 'month' | 'year'; billing_interval_count?: number } {
  if (interval === 'one_time') {
    return {};
  }
  if (interval === 'monthly') {
    return { billing_interval: 'month', billing_interval_count: intervalCountInput ?? 1 };
  }
  if (interval === 'quarterly') {
    return { billing_interval: 'month', billing_interval_count: (intervalCountInput ?? 1) * 3 };
  }
  if (interval === 'yearly') {
    return { billing_interval: 'year', billing_interval_count: intervalCountInput ?? 1 };
  }
  return {};
}

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
  billing_interval?: 'week' | 'month' | 'year' | PackageBillingInterval | 'quarter';
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

function fromBackendInterval(
  raw: BackendPackageRow['billing_interval'],
  count: number,
  billingType: BackendPackageRow['billing_type'],
): PackageBillingInterval {
  if (billingType === 'one_time') return 'one_time';
  if (raw === 'week') return 'monthly';
  if (raw === 'month') {
    if (count >= 3 && count < 12) return 'quarterly';
    return 'monthly';
  }
  if (raw === 'year') return 'yearly';
  if (raw === 'monthly' || raw === 'quarterly' || raw === 'yearly' || raw === 'one_time') {
    return raw;
  }
  return 'monthly';
}

function fromBackend(row: BackendPackageRow): CoachPackage {
  const count = row.billing_interval_count ?? row.interval_count ?? 1;
  const interval = fromBackendInterval(row.billing_interval, count, row.billing_type);
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
    intervalCount: count,
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
  billing_interval?: 'week' | 'month' | 'year';
  billing_interval_count?: number;
  is_active?: boolean;
  // TODO(backend): trial_days and features are not yet on the backend
  // CreatePackageDto. Once added, expand the body. Mobile keeps the UI
  // fields in `PackageCreateInput` so we don't lose them.
}

function toBackendCreate(input: PackageCreateInput): BackendCreateBody {
  const intervalFields = toBackendIntervalFields(input.billingInterval, input.intervalCount);
  const body: BackendCreateBody = {
    name: input.title,
    description: input.description ?? null,
    amount_cents: input.priceCents,
    billing_type: BILLING_TYPE_FOR_INTERVAL[input.billingInterval],
  };
  if (input.currency !== undefined) body.currency = input.currency;
  if (intervalFields.billing_interval) body.billing_interval = intervalFields.billing_interval;
  if (intervalFields.billing_interval_count != null) {
    body.billing_interval_count = intervalFields.billing_interval_count;
  }
  // TODO(backend): trial_days, features rejected by whitelist DTO. Omit until added.
  return body;
}

interface BackendUpdateBody {
  name?: string;
  description?: string | null;
  amount_cents?: number;
  currency?: string;
  is_active?: boolean;
  // TODO(backend): UpdatePackageDto does not accept billing_type,
  // billing_interval, billing_interval_count, trial_days, or features.
}

function toBackendUpdate(input: PackageUpdateInput): BackendUpdateBody {
  const out: BackendUpdateBody = {};
  if (input.title !== undefined) out.name = input.title;
  if (input.description !== undefined) out.description = input.description;
  if (input.priceCents !== undefined) out.amount_cents = input.priceCents;
  if (input.currency !== undefined) out.currency = input.currency;
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

  // TODO(backend): `GET /v1/coach/packages/:id` not yet deployed.
  // CoachPackageEditScreen passes the list row through nav params instead.
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

  archive: async (id: string, idempotencyKey?: string) => {
    const res = await api.delete<BackendPackageRow | { ok?: true }>(
      `/v1/coach/packages/${encodeURIComponent(id)}`,
      idemHeaders(idempotencyKey),
    );
    const body = res.data as BackendPackageRow | { ok?: true } | undefined;
    const row: BackendPackageRow =
      body && typeof body === 'object' && 'id' in (body as BackendPackageRow)
        ? (body as BackendPackageRow)
        : { id, is_active: false, status: 'archived' };
    return { ...res, data: fromBackend(row) };
  },

  // TODO(backend): `GET /v1/coach/packages/:id/subscribers` not yet deployed.
  subscribers: (id: string) =>
    api.get<PackageSubscribersResponse>(
      `/v1/coach/packages/${encodeURIComponent(id)}/subscribers`,
    ),

  // TODO(backend): `GET /v1/coach/earnings` not yet deployed.
  earnings: () => api.get<CoachEarningsSummary>('/v1/coach/earnings'),
};

// ─── public / client-facing API ─────────────────────────────────────────────

export const publicPackagesApi = {
  // TODO(backend): `GET /v1/packages/:shareToken` planned but not deployed.
  getByShareToken: (shareToken: string) => {
    if (!isValidPackageShareToken(shareToken)) {
      return Promise.reject(new Error('INVALID_SHARE_TOKEN'));
    }
    return api.get<PublicPackageView>(
      `/v1/packages/${encodeURIComponent(shareToken)}`,
    );
  },

  // Backend `POST /v1/checkout/sessions` requires:
  //   { package_id: <uuid>, success_url, cancel_url }
  // URLs must start with growthproject:// | com.growthproject.app:// | https://
  createCheckoutSession: (
    packageId: string,
    body: { successUrl?: string; cancelUrl?: string } = {},
    idempotencyKey?: string,
  ) => {
    if (typeof packageId !== 'string' || packageId.length === 0) {
      return Promise.reject(new Error('INVALID_PACKAGE_ID'));
    }
    const successUrl = body.successUrl ?? PACKAGE_CHECKOUT_SUCCESS_URL;
    const cancelUrl = body.cancelUrl ?? PACKAGE_CHECKOUT_CANCEL_URL;
    return api.post<CheckoutSessionResponse>(
      '/v1/checkout/sessions',
      {
        package_id: packageId,
        success_url: successUrl,
        cancel_url: cancelUrl,
      },
      idemHeaders(idempotencyKey),
    );
  },
};
