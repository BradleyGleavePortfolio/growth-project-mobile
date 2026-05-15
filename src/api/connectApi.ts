// Stripe Connect (coach payouts) — typed mobile client for the backend's
// Phase 1 endpoints. Reflects the real-or-flagged contract: every call
// either returns real Stripe-backed data or surfaces an actionable error
// (CONNECT_NOT_CONFIGURED, CONNECT_ACCOUNT_NOT_FOUND, CONNECT_ONBOARDING_INCOMPLETE).
// There is no fake-success path; callers render the error state honestly.

import api from '../services/api';

export interface ConnectAccountView {
  coach_user_id: string;
  stripe_account_id: string;
  country: string;
  default_currency: string;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
  requirements_due?: Record<string, unknown> | null;
  disabled_reason?: string | null;
  deauthorized_at?: string | null;
  is_fully_onboarded: boolean;
}

export type ConnectStatusResponse =
  | { connected: false }
  | ({ connected: true } & ConnectAccountView);

export interface OnboardingLink {
  url: string;
  expires_at: number;
}

export interface DashboardLink {
  url: string;
}

export const connectApi = {
  getStatus: () =>
    api.get<ConnectStatusResponse>('/v1/connect/accounts/me'),

  createAccount: (opts: { country?: string; email?: string } = {}) =>
    api.post<ConnectAccountView>('/v1/connect/accounts/create', opts),

  createOnboardingLink: () =>
    api.post<OnboardingLink>('/v1/connect/accounts/onboarding-link', {}),

  createDashboardLink: () =>
    api.post<DashboardLink>('/v1/connect/accounts/dashboard-link', {}),
};
