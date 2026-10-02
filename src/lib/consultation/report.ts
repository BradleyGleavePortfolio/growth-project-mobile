/**
 * Unexpected failures on the consultation and Roman and AI screens go to
 * Sentry with their status, machine code and support reference only (owner
 * rule 2026-10-01 13:34). Never answers, notes or any other health data.
 * Reporting can never break the flow.
 */
import { captureError } from '../../services/sentry';

export interface UnexpectedFailure {
  status: number | null;
  code?: string | null;
  requestId?: string | null;
}

export function reportUnexpected(where: string, info: UnexpectedFailure): void {
  try {
    captureError(new Error(`${where} failed (${info.status ?? 'no status'})`), {
      where,
      status: info.status,
      code: info.code ?? null,
      request_id: info.requestId ?? null,
    });
  } catch {
    // Best effort.
  }
}
