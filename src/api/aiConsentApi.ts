/**
 * aiConsentApi: the AI processing consent ledger (backend R2a, #622, split
 * out of #601 under the D2 ruling, ops/CONSENT_D2_CONTRACT.md). Shapes follow
 * the "API contract (final)" section of #622.
 *
 *   GET    /me/ai-consent        status, current version, server copy
 *   POST   /me/ai-consent/roman  { version, copy_sha256?, platform?, app_version?, locale? }
 *                                grant (idempotent); 409 CONSENT_VERSION_MISMATCH
 *   DELETE /me/ai-consent/roman  withdraw (idempotent)
 *
 * All three answer with the same status body. 503 AI_CONSENT_UNAVAILABLE
 * while the ledger switch is off; 404 from a backend without it.
 *
 * This records box 2 of the P0 agreement only (Roman and the coach's AI
 * drafts, processed by Anthropic). Box 1 (waiver, collection and use for
 * coaching) is recorded by the onboarding intake, never here.
 *
 * Every call resolves to an outcome and never throws, so callers can treat
 * "not deployed yet" (404 / 503) as a calm, explicit state.
 * R11-C1 `scope` and `upgrade` (optional client-ai-v5 memory copy) read as null when absent or malformed;
 * `memory_on` reads false unless exactly true. R11-C2B `memory_copy` reads as null when absent or malformed.
 */
import { z } from 'zod';
import api from '../services/api';
import { supportReferenceOf } from '../utils/correlation';

export type AiConsentState = 'granted' | 'withdrawn' | 'needs_reconsent' | 'not_granted';

/** A text block of the server copy with its sha256 (lowercase hex). */
export interface AiConsentCopyPart {
  text: string;
  sha256: string;
}

/** Server copy for the current version: paragraph 4 and the box 2 label. */
export interface AiConsentServerCopy {
  version: string;
  processor?: string;
  paragraph?: AiConsentCopyPart;
  box_label?: AiConsentCopyPart;
  /** sha256 of `paragraph.text + "\n\n" + box_label.text`. */
  sha256?: string;
}

/** What a live grant covers (backend R11-C1): 'memory' adds Roman's notes and summaries. */
export type AiConsentScope = 'base' | 'memory';

/** A copy on offer that can be shown and granted: every part present. */
export interface AiConsentUpgradeCopy {
  version: string;
  paragraph: AiConsentCopyPart;
  box_label: AiConsentCopyPart;
  /** sha256 (lowercase hex) of `paragraph.text + "\n\n" + box_label.text`; sent as `copy_sha256`. */
  sha256: string;
}

/** GET /me/ai-consent (and the grant / withdraw responses). */
export interface AiConsentStatusResponse {
  purpose?: string;
  processor?: string;
  /** True only for state "granted". */
  granted: boolean;
  state: AiConsentState;
  /** Copy version of the latest decision, or null. */
  version: string | null;
  granted_at: string | null;
  withdrawn_at: string | null;
  current_version: string;
  needs_reconsent: boolean;
  copy: AiConsentServerCopy | null;
  /** Absent or null on servers before R11-C1. */
  scope?: AiConsentScope | null;
  /** The optional Roman memory copy offered to a live v4 holder; null when nothing is offered. */
  upgrade?: AiConsentUpgradeCopy | null;
  /** True only from a server that offers `upgrade` while Roman memory is on (older servers omit it). */
  memory_on?: boolean;
  /**
   * R11-C2B: the client-ai-v5 copy box 2 shows and grants while Roman memory is on (everyone without a
   * live v5 grant). Absent on the current production server and null while memory is off.
   */
  memory_copy?: AiConsentUpgradeCopy | null;
}

export interface GrantRomanConsentRequest {
  version: string;
  copy_sha256?: string;
  platform?: 'ios' | 'android' | 'web';
  app_version?: string;
  locale?: string;
}

export type AiConsentOutcome =
  | { kind: 'ok'; status: AiConsentStatusResponse | null }
  /** 404 / 503: the ledger is not deployed or switched off. Say so; record nothing. */
  | { kind: 'unavailable'; status?: 404 | 503 }
  /** 409 CONSENT_VERSION_MISMATCH: the server needs different copy (app update). */
  | { kind: 'version_mismatch' }
  /** Anything else. `requestId`: the support reference of the failed request, when known. */
  | { kind: 'error'; status: number | null; code?: string; requestId?: string | null };

interface AxiosLikeError {
  response?: { status?: number; data?: unknown };
}

function statusOf(err: unknown): number | null {
  const s = (err as AxiosLikeError)?.response?.status;
  return typeof s === 'number' ? s : null;
}

function dataOf(err: unknown): Record<string, unknown> | undefined {
  const d = (err as AxiosLikeError)?.response?.data;
  return d && typeof d === 'object' && !Array.isArray(d) ? (d as Record<string, unknown>) : undefined;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

const STATES: readonly AiConsentState[] = ['granted', 'withdrawn', 'needs_reconsent', 'not_granted'];

function copyPart(v: unknown): AiConsentCopyPart | undefined {
  return isRecord(v) && typeof v.text === 'string' && typeof v.sha256 === 'string'
    ? { text: v.text, sha256: v.sha256 }
    : undefined;
}

const SCOPES: readonly AiConsentScope[] = ['base', 'memory'];
const HEX64 = /^[a-fA-F0-9]{64}$/;
const nonBlank = z.string().refine((t) => t.trim().length > 0);
const upgradePartSchema = z.object({ text: nonBlank, sha256: z.string().regex(HEX64) });
const upgradeSchema = z.object({
  version: z.string().min(1).max(64),
  paragraph: upgradePartSchema,
  box_label: upgradePartSchema,
  sha256: z.string().regex(HEX64),
});

/** The `upgrade` copy when every part is present and well formed; anything else is null. */
export function parseUpgrade(v: unknown): AiConsentUpgradeCopy | null {
  const r = upgradeSchema.safeParse(v);
  if (!r.success) return null;
  const { version, paragraph, box_label, sha256 } = r.data;
  return {
    version,
    paragraph: { text: paragraph.text, sha256: paragraph.sha256.toLowerCase() },
    box_label: { text: box_label.text, sha256: box_label.sha256.toLowerCase() },
    sha256: sha256.toLowerCase(),
  };
}

/** Accept only a readable status body; anything else is "no status". */
export function parseStatus(body: unknown): AiConsentStatusResponse | null {
  if (!isRecord(body)) return null;
  const state = STATES.find((x) => x === body.state);
  if (!state || typeof body.granted !== 'boolean' || typeof body.current_version !== 'string') return null;
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  const c = body.copy;
  const copy: AiConsentServerCopy | null =
    isRecord(c) && typeof c.version === 'string'
      ? {
          version: c.version,
          processor: str(c.processor) ?? undefined,
          paragraph: copyPart(c.paragraph),
          box_label: copyPart(c.box_label),
          sha256: str(c.sha256) ?? undefined,
        }
      : null;
  return {
    purpose: str(body.purpose) ?? undefined,
    processor: str(body.processor) ?? undefined,
    // `granted` is true only for state "granted" (contract); never trust one without the other.
    granted: body.granted === true && state === 'granted',
    state,
    version: str(body.version),
    granted_at: str(body.granted_at),
    withdrawn_at: str(body.withdrawn_at),
    current_version: body.current_version,
    needs_reconsent: body.needs_reconsent === true || state === 'needs_reconsent',
    copy,
    scope: SCOPES.find((x) => x === body.scope) ?? null,
    upgrade: parseUpgrade(body.upgrade),
    memory_on: body.memory_on === true,
    memory_copy: parseUpgrade(body.memory_copy),
  };
}

function failure(err: unknown): AiConsentOutcome {
  const status = statusOf(err);
  if (status === 404 || status === 503) return { kind: 'unavailable', status };
  const data = dataOf(err);
  const code = [data?.code, data?.error].find((x): x is string => typeof x === 'string');
  if (status === 409 && code === 'CONSENT_VERSION_MISMATCH') return { kind: 'version_mismatch' };
  const requestId = status === null ? null : supportReferenceOf(err);
  return { kind: 'error', status, ...(code ? { code } : {}), ...(requestId ? { requestId } : {}) };
}

/** Whether the status is a live grant of `version` (state "granted" for the current copy). */
export function isLiveGrant(s: AiConsentStatusResponse | null | undefined, version: string): boolean {
  if (!s || s.state !== 'granted' || s.granted !== true || s.needs_reconsent) return false;
  return s.version === version && s.current_version === version;
}

export const aiConsentApi = {
  getStatus: async (): Promise<AiConsentOutcome> => {
    try {
      const res = await api.get<unknown>('/me/ai-consent');
      const status = parseStatus(res?.data);
      return status ? { kind: 'ok', status } : { kind: 'error', status: res?.status ?? null };
    } catch (err) {
      return failure(err);
    }
  },

  grantRoman: async (body: GrantRomanConsentRequest): Promise<AiConsentOutcome> => {
    try {
      const res = await api.post<unknown>('/me/ai-consent/roman', body);
      return { kind: 'ok', status: parseStatus(res?.data) };
    } catch (err) {
      return failure(err);
    }
  },

  withdrawRoman: async (): Promise<AiConsentOutcome> => {
    try {
      const res = await api.delete<unknown>('/me/ai-consent/roman');
      return { kind: 'ok', status: parseStatus(res?.data) };
    } catch (err) {
      return failure(err);
    }
  },
};

export default aiConsentApi;
