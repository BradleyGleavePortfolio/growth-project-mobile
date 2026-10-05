/**
 * coachConsultationApi — the coach's read of a client's consultation answers
 * (owner decision 2026-09-30: the coach sees every client's consultation
 * answers, easily).
 *
 * Contract: backend `src/onboarding/onboarding.controller.ts`
 * (CoachConsultationController, backend #607, on main and in production):
 *   GET /api/coach/clients/:clientId/consultation
 * Auth: JWT. `@Roles` lists every role on purpose, so the route never answers
 * 403; `OnboardingService.canCoachRead` decides from live tenancy rows (the
 * client's coach, that coach's head coach, or a sub-coach with an open
 * assignment) and every refusal (foreign coach, no intake yet, unknown client)
 * is the same `404 { message: "Consultation not found" }`, which does not
 * reveal whether the client exists.
 *
 * This module turns every outcome into one of a small set of kinds, so the
 * screen can show specific copy and a working next action for each (owner
 * rule 2026-10-01 13:34: no generic errors). Answers never leave this module
 * except to the screen: nothing here logs or reports them.
 */
import axios from 'axios';
import { z } from 'zod';
import api from '../services/api';
import { supportReferenceOf } from '../utils/correlation';

const AnswerSchema = z.object({
  screen: z.string(),
  question: z.string(),
  answer_label: z.string(),
});

const ChapterSchema = z.object({
  key: z.string(),
  title: z.string(),
  answers: z.array(AnswerSchema),
});

const ScreeningItemSchema = z.object({
  key: z.string(),
  question: z.string(),
  answer: z.enum(['yes', 'no']).nullable(),
  note: z.string().nullable(),
});

export const ConsultationViewSchema = z.object({
  version: z.string(),
  revision: z.number(),
  revision_cause: z.string(),
  submitted_at: z.string().nullable(),
  saved_at: z.string(),
  chapters: z.array(ChapterSchema),
  screening: z.object({
    any_yes: z.boolean(),
    items: z.array(ScreeningItemSchema),
  }),
  consent: z.object({
    version: z.string().nullable(),
    agreed_at: z.string().nullable(),
  }),
});

export type ConsultationView = z.infer<typeof ConsultationViewSchema>;

/** What a failed read means for the coach. */
export type ConsultationFailureKind =
  /** No response at all: offline, DNS, timeout. */
  | 'offline'
  /** 401 after the session refresh gave up: the coach must log in again. */
  | 'session'
  /** 429: the throttle; waiting a moment fixes it. */
  | 'busy'
  /** Anything else (5xx, unexpected status, a body that breaks the contract). */
  | 'unexpected';

export type ConsultationResult =
  | { kind: 'ok'; view: ConsultationView }
  /** 404 from the handler: nothing on file for this client, or no access. */
  | { kind: 'none' };

/** Thrown for every outcome the coach cannot read answers from. */
export class ConsultationLoadError extends Error {
  constructor(
    public readonly kind: ConsultationFailureKind,
    public readonly status: number | null,
    /** Full server correlation id (or the outbound X-Request-Id), never invented. */
    public readonly requestId: string | null,
    /** Bounded label for telemetry; never a server message or an answer. */
    public readonly code: string,
  ) {
    super(`consultation read failed: ${kind}`);
    this.name = 'ConsultationLoadError';
    Object.setPrototypeOf(this, ConsultationLoadError.prototype);
  }
}

/**
 * Nest's router 404 for a path no controller handles ("Cannot GET /api/...").
 * Production has the route (backend #607), so a router 404 means the app is
 * pointed at a backend without it: that is unexpected, not "no answers".
 */
export function isRouteMissing(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const message = (data as { message?: unknown }).message;
  return typeof message === 'string' && message.startsWith('Cannot GET');
}

export function consultationQueryKey(clientId: string) {
  return ['coach', 'consultation', clientId] as const;
}

/**
 * Read one client's consultation. The handler's uniform 404 resolves to
 * `{ kind: 'none' }`; every other failure rejects with a ConsultationLoadError.
 */
export async function loadClientConsultation(clientId: string): Promise<ConsultationResult> {
  let data: unknown;
  let okReference: string | null = null;
  try {
    const res = await api.get(`/coach/clients/${encodeURIComponent(clientId)}/consultation`);
    data = res.data;
    okReference = responseReference(res);
  } catch (err) {
    const failure = classifyFailure(err);
    if (failure === 'none') return { kind: 'none' };
    throw failure;
  }
  const parsed = ConsultationViewSchema.safeParse(data);
  if (!parsed.success) {
    // C-335-3: keep the correlation id on a 2xx that breaks the contract, so
    // the screen's reference, the support subject and Sentry all match.
    throw new ConsultationLoadError('unexpected', 200, okReference, 'contract');
  }
  return { kind: 'ok', view: parsed.data };
}

/**
 * The correlation id for a successful response: the server's `x-request-id`
 * header, else the `X-Request-Id` this app sent. Never read from the body,
 * which is the client's answers. Null when neither exists.
 */
export function responseReference(res: unknown): string | null {
  if (!res || typeof res !== 'object') return null;
  const { headers, config } = res as { headers?: unknown; config?: unknown };
  return supportReferenceOf({ response: { headers }, config });
}

export function classifyFailure(err: unknown): ConsultationLoadError | 'none' {
  const ref = supportReferenceOf(err);
  if (!axios.isAxiosError(err)) {
    return new ConsultationLoadError('unexpected', null, ref, 'non_http');
  }
  const status = err.response?.status ?? null;
  if (status === null) return new ConsultationLoadError('offline', null, ref, 'network');
  if (status === 404) {
    return isRouteMissing(err.response?.data)
      ? new ConsultationLoadError('unexpected', 404, ref, 'route_missing')
      : 'none';
  }
  if (status === 401) return new ConsultationLoadError('session', 401, ref, 'unauthorized');
  if (status === 429) return new ConsultationLoadError('busy', 429, ref, 'throttled');
  return new ConsultationLoadError('unexpected', status, ref, `http_${status}`);
}

/** How many readiness questions the client has answered, and how many were yes. */
export function screeningSummary(view: ConsultationView): {
  yes: number;
  answered: number;
  total: number;
} {
  const items = view.screening.items;
  return {
    yes: items.filter((i) => i.answer === 'yes').length,
    answered: items.filter((i) => i.answer !== null).length,
    total: items.length,
  };
}

/** Short local date for status lines ("Oct 1, 2026"); empty for a bad value. */
export function formatConsultationDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
