/**
 * aiConsentApi: the AI processing consent ledger (backend "R2a", split out of
 * #601 under the D2 ruling, ops/CONSENT_D2_CONTRACT.md).
 *
 *   GET    /me/ai-consent        status, current version, server copy
 *   POST   /me/ai-consent/roman  { version, copy_sha256?, platform?, app_version?, locale? }
 *                                grant (idempotent); 409 CONSENT_VERSION_MISMATCH
 *   DELETE /me/ai-consent/roman  withdraw (idempotent)
 *
 * This records box 2 of the P0 agreement only (Roman and the coach's AI
 * drafts, processed by Anthropic). Box 1 (waiver, collection and use for
 * coaching) is recorded by the onboarding intake, never here.
 *
 * Every call resolves to an outcome and never throws, so callers can treat
 * "not deployed yet" (404 / 503) as a calm, explicit state.
 */
import api from '../services/api';

/** The `roman` block of GET /me/ai-consent (and of the grant/withdraw responses). */
export interface RomanConsentRecord {
  granted: boolean;
  version: string | null;
  granted_at: string | null;
  revoked_at: string | null;
  current_version: string;
  needs_reconsent?: boolean;
}

/** Server copy for the current version: the AI paragraph and box label, and its sha256. */
export interface AiConsentServerCopy {
  version: string;
  text?: string;
  sha256?: string;
  processor?: string;
  data_categories?: string[];
}

export interface AiConsentStatusResponse {
  roman: RomanConsentRecord;
  copy?: AiConsentServerCopy | null;
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
  | { kind: 'unavailable' }
  /** 409 CONSENT_VERSION_MISMATCH: the server needs different copy (app update). */
  | { kind: 'version_mismatch'; current_version: string | null }
  | { kind: 'error'; status: number | null };

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

/** Accept only a body that has a readable `roman` block; anything else is "no status". */
export function parseStatus(body: unknown): AiConsentStatusResponse | null {
  if (!isRecord(body) || !isRecord(body.roman)) return null;
  const r = body.roman;
  if (typeof r.granted !== 'boolean' || typeof r.current_version !== 'string') return null;
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  const copy = isRecord(body.copy) && typeof body.copy.version === 'string'
    ? {
        version: body.copy.version,
        text: typeof body.copy.text === 'string' ? body.copy.text : undefined,
        sha256: typeof body.copy.sha256 === 'string' ? body.copy.sha256 : undefined,
        processor: typeof body.copy.processor === 'string' ? body.copy.processor : undefined,
      }
    : null;
  return {
    roman: {
      granted: r.granted,
      version: str(r.version),
      granted_at: str(r.granted_at),
      revoked_at: str(r.revoked_at),
      current_version: r.current_version,
      needs_reconsent: r.needs_reconsent === true,
    },
    copy,
  };
}

function failure(err: unknown): AiConsentOutcome {
  const status = statusOf(err);
  if (status === 404 || status === 503) return { kind: 'unavailable' };
  const data = dataOf(err);
  const code = [data?.code, data?.error, data?.message].find((x) => typeof x === 'string');
  if (status === 409 && code === 'CONSENT_VERSION_MISMATCH') {
    return {
      kind: 'version_mismatch',
      current_version: typeof data?.current_version === 'string' ? data.current_version : null,
    };
  }
  return { kind: 'error', status };
}

/**
 * Whether the record is a live grant of `version`: granted, not revoked
 * after it was granted, of exactly that version, and not flagged for
 * re-consent.
 */
export function isLiveGrant(r: RomanConsentRecord | null | undefined, version: string): boolean {
  if (!r || r.granted !== true || !r.granted_at) return false;
  if (r.revoked_at && Date.parse(r.revoked_at) >= Date.parse(r.granted_at)) return false;
  if (r.needs_reconsent) return false;
  return r.version === version && r.current_version === version;
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
