/**
 * S-COACH — typed client for the coach setup wizard and the Home checklist.
 *
 * Every call hits a live backend route:
 *   GET  /coach/connect/status            truthful Connect state (additive fields
 *                                          from backend S-COACH; derived locally
 *                                          when an older backend omits them)
 *   POST /coach/connect/status/refresh    re-read from Stripe after onboarding
 *                                          (404 on an older backend -> GET status)
 *   POST /coach/connect/onboarding-link   Stripe-hosted Express onboarding URL
 *   GET  /coaches/me/invite-link          the coach's permanent join link
 *   PUT  /v1/invite-codes/:code/package-binding   free package on join
 *   POST /v1/coach/packages/:id/publish   make the first package live
 *   GET/POST /coach/onboarding[...]       wizard progress (6 sequential steps)
 */
import api from "../services/api";
import { errorStatus } from "../types/common";

export type ConnectState =
  | "not_started"
  | "details_needed"
  | "pending_verification"
  | "restricted"
  | "active"
  | "deauthorized";

export interface ConnectView {
  state: ConnectState;
  accountId: string | null;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  actionRequired: boolean;
  currentlyDue: string[];
  pastDue: string[];
  eventuallyDue: string[];
  pendingVerification: string[];
  /** ISO timestamp of Stripe's current deadline, or null. */
  deadline: string | null;
  disabledReason: string | null;
  /** True when the server re-read Stripe for this answer. */
  refreshed: boolean;
}

interface RawRequirements {
  currently_due?: unknown;
  past_due?: unknown;
  eventually_due?: unknown;
  pending_verification?: unknown;
  current_deadline?: unknown;
}

interface RawConnectStatus {
  configured?: boolean;
  charges_enabled?: boolean;
  payouts_enabled?: boolean;
  account_id?: string | null;
  requirements_due?: unknown;
  state?: string;
  details_submitted?: boolean;
  disabled_reason?: string | null;
  action_required?: boolean;
  requirements?: RawRequirements;
  refreshed?: boolean;
}

const STATES: readonly ConnectState[] = [
  "not_started",
  "details_needed",
  "pending_verification",
  "restricted",
  "active",
  "deauthorized",
];

function strings(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string")
    : [];
}

/** Normalise the status payload. Exported for tests. */
export function toConnectView(
  raw: RawConnectStatus | null | undefined,
): ConnectView {
  const r = raw ?? {};
  const req = r.requirements ?? {};
  const legacyDue = strings(r.requirements_due);
  const currentlyDue = r.requirements ? strings(req.currently_due) : legacyDue;
  const pastDue = strings(req.past_due);
  const charges = r.charges_enabled === true;
  const payouts = r.payouts_enabled === true;
  const accountId =
    typeof r.account_id === "string" && r.account_id ? r.account_id : null;
  let state: ConnectState;
  if (
    typeof r.state === "string" &&
    (STATES as readonly string[]).includes(r.state)
  ) {
    state = r.state as ConnectState;
  } else if (!accountId) {
    state = "not_started";
  } else if (charges && payouts) {
    state = "active";
  } else if (currentlyDue.length > 0 || pastDue.length > 0) {
    state = r.details_submitted ? "restricted" : "details_needed";
  } else {
    state = "pending_verification";
  }
  const deadline =
    typeof req.current_deadline === "string" ? req.current_deadline : null;
  return {
    state,
    accountId,
    chargesEnabled: charges,
    payoutsEnabled: payouts,
    detailsSubmitted: r.details_submitted === true,
    actionRequired:
      typeof r.action_required === "boolean"
        ? r.action_required
        : state === "details_needed" ||
          state === "restricted" ||
          state === "not_started",
    currentlyDue,
    pastDue,
    eventuallyDue: strings(req.eventually_due),
    pendingVerification: strings(req.pending_verification),
    deadline,
    disabledReason:
      typeof r.disabled_reason === "string" ? r.disabled_reason : null,
    refreshed: r.refreshed === true,
  };
}

export interface OnboardingLink {
  url: string;
  expiresAt: string | null;
}

export interface InviteLink {
  code: string;
  url: string;
}

export interface CoachOnboardingProgress {
  currentStep: number;
  isComplete: boolean;
  stepData: Record<string, unknown>;
}

function toProgress(data: unknown): CoachOnboardingProgress {
  const d = (data ?? {}) as {
    current_step?: number;
    is_complete?: boolean;
    step_data?: Record<string, unknown> | null;
  };
  return {
    currentStep: typeof d.current_step === "number" ? d.current_step : 1,
    isComplete: d.is_complete === true,
    stepData: d.step_data && typeof d.step_data === "object" ? d.step_data : {},
  };
}

export const coachSetupApi = {
  async connectStatus(): Promise<ConnectView> {
    const res = await api.get<RawConnectStatus>("/coach/connect/status");
    return toConnectView(res.data);
  },

  /** Re-read Stripe. Falls back to the mirrored status on an older backend. */
  async refreshConnectStatus(): Promise<ConnectView> {
    try {
      const res = await api.post<RawConnectStatus>(
        "/coach/connect/status/refresh",
      );
      return toConnectView(res.data);
    } catch (err) {
      const status = errorStatus(err);
      if (status === 404 || status === 405)
        return coachSetupApi.connectStatus();
      throw err;
    }
  },

  async createOnboardingLink(): Promise<OnboardingLink> {
    const res = await api.post<{ url?: string; expires_at?: string | null }>(
      "/coach/connect/onboarding-link",
    );
    const url = res.data?.url;
    if (typeof url !== "string" || !url) {
      throw Object.assign(new Error("onboarding link missing url"), {
        response: { status: 502, data: { error: "ONBOARDING_LINK_EMPTY" } },
      });
    }
    return { url, expiresAt: res.data?.expires_at ?? null };
  },

  async inviteLink(): Promise<InviteLink> {
    const res = await api.get<{ code?: string; url?: string }>(
      "/coaches/me/invite-link",
    );
    const code = res.data?.code ?? "";
    const url = res.data?.url ?? "";
    if (!code || !url) {
      throw Object.assign(new Error("invite link missing"), {
        response: { status: 502, data: { error: "INVITE_LINK_EMPTY" } },
      });
    }
    return { code, url };
  },

  /** Clients who join with `code` get `packageId` at $0 (free packages only). */
  async bindFreePackage(code: string, packageId: string): Promise<void> {
    await api.put(
      `/v1/invite-codes/${encodeURIComponent(code)}/package-binding`,
      {
        package_id: packageId,
        grant_mode: "free",
      },
    );
  },

  async publishPackage(packageId: string): Promise<void> {
    await api.post(
      `/v1/coach/packages/${encodeURIComponent(packageId)}/publish`,
    );
  },

  async progress(): Promise<CoachOnboardingProgress> {
    const res = await api.get("/coach/onboarding");
    return toProgress(res.data);
  },

  async start(): Promise<CoachOnboardingProgress> {
    const res = await api.post("/coach/onboarding/start");
    return toProgress(res.data);
  },

  async saveStep(
    step: number,
    data?: Record<string, unknown>,
  ): Promise<CoachOnboardingProgress> {
    const res = await api.post(
      `/coach/onboarding/steps/${step}`,
      data ? { data } : {},
    );
    return toProgress(res.data);
  },

  async complete(): Promise<CoachOnboardingProgress> {
    const res = await api.post("/coach/onboarding/complete");
    return toProgress(res.data);
  },
};

/**
 * Advance the backend wizard to `target`. The backend accepts the same step
 * or the next one only, so walk forward one step at a time from wherever the
 * server says the coach is. Never moves backwards.
 */
export async function advanceWizardTo(
  target: number,
  data?: Record<string, unknown>,
): Promise<CoachOnboardingProgress> {
  let progress = await coachSetupApi.progress().catch(async (err) => {
    if (errorStatus(err) === 404) return coachSetupApi.start();
    throw err;
  });
  if (progress.isComplete) return progress;
  let sent = false;
  while (progress.currentStep < target) {
    const next = progress.currentStep + 1;
    const withData = next === target ? data : undefined;
    progress = await coachSetupApi.saveStep(next, withData);
    if (withData) sent = true;
  }
  if (progress.currentStep === target && data && !sent) {
    progress = await coachSetupApi.saveStep(target, data);
  }
  return progress;
}
