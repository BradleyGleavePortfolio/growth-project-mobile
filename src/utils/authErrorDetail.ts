/**
 * A sanitised, structured view of a failed auth request (#306 r6, Sol
 * B-306-5).
 *
 * The provider helpers (Apple, Google) return it next to their string
 * `error`, so a screen can still map known statuses and backend codes, and
 * report an unknown failure under the backend's own reference, after the
 * helper has turned the request error into a result. It holds only the
 * status, a backend machine code, the backend message (used to classify,
 * never reported) and the request id. Never the request config, body,
 * headers or tokens.
 */
import { extractRequestId, REQUEST_ID_HEADER } from './correlation';

export interface AuthErrorDetail {
  readonly kind: 'auth_error_detail';
  status: number | null;
  /** Backend machine code, kept only when it reads as an identifier (Opus C-306-5). */
  code: string | null;
  /** Backend message text (string or joined array). Used to classify; never reported. */
  message: string;
  /** Server `request_id` (body or `x-request-id`), else the `X-Request-Id` this app sent. */
  requestId: string | null;
}

/** A machine code: no spaces, no free text that could carry user input. */
const SAFE_CODE = /^[A-Za-z0-9_.:-]{1,64}$/;

export function isAuthErrorDetail(v: unknown): v is AuthErrorDetail {
  return !!v && typeof v === 'object' && (v as { kind?: unknown }).kind === 'auth_error_detail';
}

function headerValue(headers: unknown, name: string): string | null {
  if (!headers || typeof headers !== 'object') return null;
  for (const [k, v] of Object.entries(headers as Record<string, unknown>)) {
    if (k.toLowerCase() === name.toLowerCase() && typeof v === 'string' && v) return v;
  }
  return null;
}

function messageText(err: unknown): string {
  if (typeof err === 'string') return err;
  const d = (err as { response?: { data?: unknown } } | null)?.response?.data;
  if (d && typeof d === 'object') {
    const m = (d as { message?: unknown }).message;
    if (typeof m === 'string' && m) return m;
    if (Array.isArray(m)) {
      const parts = m.filter((x): x is string => typeof x === 'string' && x.length > 0);
      if (parts.length > 0) return parts.join(' ');
    }
  } else if (typeof d === 'string' && d) {
    return d;
  }
  if (err instanceof Error) return err.message;
  const m = (err as { message?: unknown } | null)?.message;
  return typeof m === 'string' ? m : '';
}

function safeCode(err: unknown): string | null {
  const r = (err as { response?: { data?: unknown } } | null)?.response;
  const d = r?.data;
  if (d && typeof d === 'object') {
    for (const c of [(d as { code?: unknown }).code, (d as { error?: unknown }).error]) {
      if (typeof c === 'string' && SAFE_CODE.test(c)) return c;
    }
    return null;
  }
  // #306 r7: no response (a native Apple / Google error, or an axios error
  // with no answer): its own code, such as ERR_REQUEST_FAILED or ERR_NETWORK.
  if (!r) {
    const c = (err as { code?: unknown } | null)?.code;
    if (typeof c === 'string' && SAFE_CODE.test(c)) return c;
  }
  return null;
}

/** Build (or pass through) the sanitised detail for any thrown or returned failure. */
export function toAuthErrorDetail(err: unknown): AuthErrorDetail {
  if (isAuthErrorDetail(err)) return err;
  const s = (err as { response?: { status?: unknown } } | null)?.response?.status;
  const sent = headerValue((err as { config?: { headers?: unknown } } | null)?.config?.headers, REQUEST_ID_HEADER);
  return {
    kind: 'auth_error_detail',
    status: typeof s === 'number' ? s : null,
    code: safeCode(err),
    message: messageText(err),
    requestId: extractRequestId(err) ?? sent,
  };
}
