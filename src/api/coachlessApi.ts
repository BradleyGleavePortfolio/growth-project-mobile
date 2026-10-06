/**
 * coachlessApi — coachless Home, coach-code redemption and the scripted Roman
 * card (backend src/coachless, A1-COACHLESS).
 *
 *   GET  /coachless/home                 banner, featured coach, Roman card
 *   POST /coachless/coach-code/check     { code } -> { valid, coach } | { valid:false, code }
 *   POST /coachless/coach-code/redeem    { code } + Idempotency-Key (UUID, reused on retry)
 *   POST /coachless/roman-card/seen      { recorded, visible }
 *   POST /coachless/roman-card/not-now   { recorded, visible }
 *
 * Kill switch FEATURE_COACHLESS_HOME (server flag `coachless_home`): every
 * route answers 404 `coachless_disabled` while off, which getCoachlessHome
 * reports as `{ enabled: false }`. Refusals arrive as the global error
 * envelope `{ statusCode, code, message, request_id }`; coachlessFailureOf
 * reads only `code`, the status and `request_id` (never the server message).
 * Responses are parsed with zod so a drifted shape throws here.
 */
import { z } from 'zod';
import api from '../services/api';

export const COACHLESS_REQUEST_TIMEOUT_MS = 15_000;

const FeaturedPackageSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  amount_cents: z.number(),
  currency: z.string(),
  billing_type: z.string(),
  interval: z.string().nullable(),
  interval_count: z.number(),
});
export type FeaturedPackage = z.infer<typeof FeaturedPackageSchema>;

const CoachCardSchema = z.object({
  id: z.string(),
  name: z.string(),
  photo_url: z.string().nullable(),
  business_name: z.string().nullable(),
  bio: z.string().nullable(),
});
export type CoachCard = z.infer<typeof CoachCardSchema>;

export const CoachlessHomeSchema = z.object({
  eligible: z.boolean(),
  coach_attached: z.boolean(),
  banner: z
    .object({ title: z.string(), offer_text: z.string().nullable(), code: z.string().nullable() })
    .nullable(),
  roman_card: z.object({ text: z.string(), code: z.string() }).nullable(),
  roman_card_hidden_reason: z.string().nullable(),
  featured_coach: z
    .object({
      name: z.string(),
      photo_url: z.string().nullable(),
      business_name: z.string().nullable(),
      package: FeaturedPackageSchema.nullable(),
    })
    .nullable(),
});
export type CoachlessHome = z.infer<typeof CoachlessHomeSchema>;

const CheckSchema = z.union([
  z.object({ valid: z.literal(true), coach: CoachCardSchema }),
  z.object({ valid: z.literal(false), code: z.string() }),
]);
export type CoachCodeCheck = { valid: true; coach: CoachCard } | { valid: false; code: string };

const GrantSchema = z.object({ status: z.string() }).nullable();

export const RedeemSchema = z.object({
  status: z.literal('attached'),
  already_attached: z.boolean(),
  coach: CoachCardSchema,
  next: z.object({
    featured_package: FeaturedPackageSchema.nullable(),
    packages_available: z.number(),
  }),
  grant: GrantSchema.optional().default(null),
  replayed: z.boolean().optional().default(false),
});
export type RedeemResult = z.infer<typeof RedeemSchema>;

const RomanCardAckSchema = z.object({ recorded: z.boolean(), visible: z.boolean() });

/** Every refusal code the coachless routes send (backend coachless.errors.ts). */
export const COACHLESS_CODES = [
  'code_invalid',
  'code_expired',
  'code_revoked',
  'code_exhausted',
  'code_email_mismatch',
  'coach_not_accepting',
  'already_attached',
  'role_cannot_redeem',
  'account_not_found',
  'idempotency_key_required',
  'idempotency_key_reused',
  'redemption_in_progress',
  'redemption_failed',
  'coachless_disabled',
] as const;
export type CoachlessCode = (typeof COACHLESS_CODES)[number];

/** A refusal code, or what the transport says when the server sent none. */
export type CoachlessFailureCode = CoachlessCode | 'network' | 'rate_limited' | 'bad_format' | 'unexpected';

export interface CoachlessFailure {
  code: CoachlessFailureCode;
  /** HTTP status; 0 when the request never got an answer. */
  status: number;
  /** The server's request reference, for support. */
  requestId: string | null;
}

function isCoachlessCode(v: unknown): v is CoachlessCode {
  return typeof v === 'string' && (COACHLESS_CODES as readonly string[]).includes(v);
}

function field(obj: unknown, key: string): unknown {
  return typeof obj === 'object' && obj !== null ? Reflect.get(obj, key) : undefined;
}

/** Map any thrown request error to a coachless failure (never the raw server text). */
export function coachlessFailureOf(err: unknown): CoachlessFailure {
  const res = field(err, 'response');
  const statusRaw = field(res, 'status');
  const status = typeof statusRaw === 'number' ? statusRaw : 0;
  const data = field(res, 'data');
  const code = field(data, 'code');
  const rid = field(data, 'request_id');
  const requestId = typeof rid === 'string' && rid ? rid : null;
  if (isCoachlessCode(code)) return { code, status, requestId };
  if (status === 0) return { code: 'network', status, requestId };
  if (status === 429) return { code: 'rate_limited', status, requestId };
  if (status === 400) return { code: 'bad_format', status, requestId };
  if (status === 404) return { code: 'coachless_disabled', status, requestId };
  return { code: 'unexpected', status, requestId };
}

/** A `{ valid: false, code }` check answer as a failure (an unknown code reads as code_invalid). */
export function failureFromCheck(code: string): CoachlessFailure {
  return { code: isCoachlessCode(code) ? code : 'code_invalid', status: 200, requestId: null };
}

/** `{ enabled: false }` while the kill switch is off (404), else the Home payload. */
export async function getCoachlessHome(): Promise<{ enabled: false } | { enabled: true; home: CoachlessHome }> {
  try {
    const res = await api.get('/coachless/home', { timeout: COACHLESS_REQUEST_TIMEOUT_MS });
    return { enabled: true, home: CoachlessHomeSchema.parse(res.data) };
  } catch (err) {
    if (field(field(err, 'response'), 'status') === 404) return { enabled: false };
    throw err;
  }
}

export async function checkCoachCode(code: string): Promise<CoachCodeCheck> {
  const res = await api.post(
    '/coachless/coach-code/check',
    { code: code.trim() },
    { timeout: COACHLESS_REQUEST_TIMEOUT_MS },
  );
  return CheckSchema.parse(res.data);
}

/** One attempt = one Idempotency-Key; the caller reuses it on a retry of the same code. */
export async function redeemCoachCode(code: string, idempotencyKey: string): Promise<RedeemResult> {
  const res = await api.post(
    '/coachless/coach-code/redeem',
    { code: code.trim() },
    { timeout: COACHLESS_REQUEST_TIMEOUT_MS, headers: { 'Idempotency-Key': idempotencyKey } },
  );
  return RedeemSchema.parse(res.data);
}

export async function markRomanCardSeen(): Promise<{ recorded: boolean; visible: boolean }> {
  const res = await api.post('/coachless/roman-card/seen', {}, { timeout: COACHLESS_REQUEST_TIMEOUT_MS });
  return RomanCardAckSchema.parse(res.data);
}

export async function markRomanCardNotNow(): Promise<{ recorded: boolean; visible: boolean }> {
  const res = await api.post('/coachless/roman-card/not-now', {}, { timeout: COACHLESS_REQUEST_TIMEOUT_MS });
  return RomanCardAckSchema.parse(res.data);
}

/** Same shape check as the server (letters, digits, dashes; 3 to 40 after trim). */
export function isWellFormedCoachCode(raw: string): boolean {
  const t = raw.trim();
  return t.length >= 3 && t.length <= 40 && /^[A-Za-z0-9-]+$/.test(t);
}
