/**
 * featuredCoachApi — the owner's Featured coach editor (backend
 * src/coachless, FeaturedCoachAdminController; owner role only).
 *
 *   GET /admin/featured-coach            { config | null, resolved }
 *   GET /admin/featured-coach/coaches    { coaches: [{ ..., packages }] } (coach accounts + active packages)
 *   PUT /admin/featured-coach            FeaturedCoachConfigDto -> { config, resolved, code_created }
 *
 * Refusals are the global error envelope; featuredCoachFailureOf reads only
 * `code`, the status and `request_id` (never the server message).
 */
import { z } from 'zod';
import api from '../services/api';

export const FEATURED_COACH_TIMEOUT_MS = 15_000;

/** Server limits (coachless.dto.ts FeaturedCoachConfigDto). */
export const FEATURED_LIMITS = {
  banner_title: 120,
  offer_text: 200,
  roman_pitch_text: 400,
  code_max: 32,
} as const;

export type CapKey = 'roman_min_hours_between' | 'roman_max_per_week' | 'roman_snooze_days' | 'roman_max_not_now';

/** Cap ranges and server defaults (featured-coach.service.ts DEFAULT_CAPS). */
export const CAP_RANGES: Record<CapKey, { min: number; max: number; fallback: number }> = {
  roman_min_hours_between: { min: 1, max: 720, fallback: 24 },
  roman_max_per_week: { min: 1, max: 14, fallback: 3 },
  roman_snooze_days: { min: 1, max: 365, fallback: 14 },
  roman_max_not_now: { min: 1, max: 10, fallback: 2 },
};

const PackageSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional().default(null),
  amount_cents: z.number(),
  currency: z.string(),
  billing_type: z.string(),
  interval: z.string().nullable(),
  interval_count: z.number(),
});
export type FeaturedCoachPackage = z.infer<typeof PackageSchema>;

const ConfigSchema = z.object({
  coach_user_id: z.string().nullable(),
  code: z.string().nullable(),
  package_id: z.string().nullable(),
  banner_title: z.string(),
  offer_text: z.string().nullable(),
  roman_pitch_text: z.string().nullable(),
  accepting_clients: z.boolean(),
  roman_enabled: z.boolean(),
  roman_min_hours_between: z.number(),
  roman_max_per_week: z.number(),
  roman_snooze_days: z.number(),
  roman_max_not_now: z.number(),
});
export type FeaturedCoachConfig = z.infer<typeof ConfigSchema>;

const ResolvedSchema = z.object({
  configured: z.boolean(),
  banner_title: z.string(),
  accepting_clients: z.boolean(),
  coach: z.object({ id: z.string(), name: z.string(), photo_url: z.string().nullable(), business_name: z.string().nullable() }).nullable(),
  package: PackageSchema.nullable(),
});
export type ResolvedFeaturedCoach = z.infer<typeof ResolvedSchema>;

const OwnerViewSchema = z.object({ config: ConfigSchema.nullable(), resolved: ResolvedSchema });
export type FeaturedCoachOwnerView = z.infer<typeof OwnerViewSchema>;

const SaveSchema = OwnerViewSchema.extend({ config: ConfigSchema, code_created: z.boolean() });
export type FeaturedCoachSaveResult = z.infer<typeof SaveSchema>;

const CandidateSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  business_name: z.string().nullable(),
  packages: z.array(PackageSchema),
});
export type FeaturedCoachCandidate = z.infer<typeof CandidateSchema>;

const CandidatesSchema = z.object({ coaches: z.array(CandidateSchema) });

/** PUT body: every field is replaced (null clears). */
export type FeaturedCoachInput = Omit<FeaturedCoachConfig, 'banner_title'> & {
  banner_title: string | null;
  create_code_if_missing: boolean;
};

/** Every refusal code PUT /admin/featured-coach sends (coachless.errors.ts). */
const FEATURED_CODES = ['featured_code_other_coach', 'featured_coach_invalid', 'featured_package_invalid', 'featured_code_unknown'] as const;
type FeaturedCode = (typeof FEATURED_CODES)[number];

export type FeaturedFailureCode = FeaturedCode | 'not_owner' | 'network' | 'rate_limited' | 'bad_format' | 'server' | 'unexpected';

export interface FeaturedFailure {
  code: FeaturedFailureCode;
  status: number;
  requestId: string | null;
}

function field(obj: unknown, key: string): unknown {
  return typeof obj === 'object' && obj !== null ? Reflect.get(obj, key) : undefined;
}

function isFeaturedCode(v: unknown): v is FeaturedCode {
  return typeof v === 'string' && (FEATURED_CODES as readonly string[]).includes(v);
}

/** Map any thrown request error to a failure (never the raw server text). */
export function featuredCoachFailureOf(err: unknown): FeaturedFailure {
  const res = field(err, 'response');
  const statusRaw = field(res, 'status');
  const status = typeof statusRaw === 'number' ? statusRaw : 0;
  const data = field(res, 'data');
  const code = field(data, 'code');
  const rid = field(data, 'request_id');
  const requestId = typeof rid === 'string' && rid ? rid : null;
  if (isFeaturedCode(code)) return { code, status, requestId };
  if (status === 0) return { code: 'network', status, requestId };
  if (status === 401 || status === 403) return { code: 'not_owner', status, requestId };
  if (status === 429) return { code: 'rate_limited', status, requestId };
  if (status === 400) return { code: 'bad_format', status, requestId };
  if (status >= 500) return { code: 'server', status, requestId };
  return { code: 'unexpected', status, requestId };
}

export async function getFeaturedCoach(): Promise<FeaturedCoachOwnerView> {
  const res = await api.get('/admin/featured-coach', { timeout: FEATURED_COACH_TIMEOUT_MS });
  return OwnerViewSchema.parse(res.data);
}

/** Coach accounts the owner can feature, each with its active packages. */
export async function listFeaturedCoachCandidates(): Promise<FeaturedCoachCandidate[]> {
  const res = await api.get('/admin/featured-coach/coaches', { timeout: FEATURED_COACH_TIMEOUT_MS });
  return CandidatesSchema.parse(res.data).coaches;
}

export async function saveFeaturedCoach(input: FeaturedCoachInput): Promise<FeaturedCoachSaveResult> {
  const res = await api.put('/admin/featured-coach', input, { timeout: FEATURED_COACH_TIMEOUT_MS });
  return SaveSchema.parse(res.data);
}
