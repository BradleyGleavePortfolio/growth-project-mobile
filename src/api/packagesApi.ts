// Coach packages — coach-authored offerings clients can purchase. Phase 1
// of the marketplace surface. The mobile contract here mirrors the planned
// backend routes; until the backend `packages` module ships, every call
// returns `404 PACKAGES_NOT_CONFIGURED` (or a network error) and the
// screens render an actionable empty state rather than fake data.
//
// Routes used:
//   GET    /v1/coach/packages                  → list packages owned by coach
//   POST   /v1/coach/packages                  → create
//   PATCH  /v1/coach/packages/:id              → update (price, title, archive)
//   POST   /v1/coach/packages/:id/archive      → archive
//   GET    /v1/coach/packages/:id/subscribers  → subscribers + payment status
//   GET    /v1/coach/earnings                  → coach earnings summary
//
// Public client-facing routes:
//   GET    /v1/packages/:shareToken            → resolve share token to a
//                                                marketing-ready package view
//   POST   /v1/packages/:shareToken/checkout   → create a Stripe Checkout
//                                                Session, returns { url } and
//                                                optionally { client_secret }
//                                                for PaymentSheet if backend
//                                                supports it.
//
// Every endpoint may return 404 with body { error: 'PACKAGES_NOT_CONFIGURED',
// message: '…' } until the backend module is deployed; clients use the
// shared errorCode() helper to detect this and render the config-required
// state.

import api from '../services/api';

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
  intervalCount: number; // e.g. monthly with intervalCount=3 = quarterly
  trialDays: number | null;
  features: string[]; // bullet points rendered on the marketing surface
  status: PackageStatus;
  shareToken: string | null; // null until backend mints one
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
  currency?: string; // defaults to 'usd' server-side
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
  // Per-package breakdown, sorted by recency
  perPackage: Array<{
    packageId: string;
    title: string;
    monthToDateGrossCents: number;
    activeSubscribers: number;
  }>;
}

// Public-facing payload returned by GET /v1/packages/:shareToken — used by
// the client checkout screen. Includes the coach's display info so the
// client can confirm who they're buying from before paying.
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

// Stripe Checkout Session response. `url` is the hosted Checkout page; if
// the backend supports PaymentSheet in-app, `paymentIntentClientSecret` and
// `customerId`/`ephemeralKey` will be populated.
export interface CheckoutSessionResponse {
  url?: string;
  sessionId?: string;
  // PaymentSheet path (Stripe React Native). All four required for in-app sheet:
  paymentIntentClientSecret?: string;
  setupIntentClientSecret?: string;
  ephemeralKey?: string;
  customerId?: string;
  publishableKey?: string;
}

export const coachPackagesApi = {
  list: () => api.get<CoachPackage[]>('/v1/coach/packages'),
  get: (id: string) => api.get<CoachPackage>(`/v1/coach/packages/${id}`),
  create: (input: PackageCreateInput) =>
    api.post<CoachPackage>('/v1/coach/packages', input),
  update: (id: string, input: PackageUpdateInput) =>
    api.patch<CoachPackage>(`/v1/coach/packages/${id}`, input),
  archive: (id: string) =>
    api.post<CoachPackage>(`/v1/coach/packages/${id}/archive`, {}),
  subscribers: (id: string) =>
    api.get<PackageSubscribersResponse>(`/v1/coach/packages/${id}/subscribers`),
  earnings: () => api.get<CoachEarningsSummary>('/v1/coach/earnings'),
};

export const publicPackagesApi = {
  getByShareToken: (shareToken: string) =>
    api.get<PublicPackageView>(`/v1/packages/${shareToken}`),
  createCheckoutSession: (shareToken: string, body: { returnUrl?: string } = {}) =>
    api.post<CheckoutSessionResponse>(`/v1/packages/${shareToken}/checkout`, body),
};
