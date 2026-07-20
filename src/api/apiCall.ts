/**
 * apiCall — shared wire boundary for the typed API clients. Both communityApi
 * and importReviewApi run every response through `call` so a shape that drifts
 * from the backend DTO THROWS here (as a `contract` error) instead of feeding
 * malformed data into React state. `label` only prefixes the human message;
 * the `kind`/`status` telemetry is identical across callers.
 */
import { z } from 'zod';
import axios from 'axios';

/**
 * Transport / contract error surfaced to the screen hooks. `.status` lets the
 * UI branch on 401/403/410/5xx without re-parsing the axios error; `kind` is a
 * coarse, bounded label (never a raw server message) for telemetry / logging.
 */
export class CommunityApiError extends Error {
  constructor(
    public readonly kind:
      | 'unauthorized'
      | 'forbidden'
      | 'gone'
      | 'conflict'
      | 'server'
      | 'network'
      | 'contract'
      | 'unknown',
    public readonly status: number,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'CommunityApiError';
    Object.setPrototypeOf(this, CommunityApiError.prototype);
  }
}

export function classify(status: number): CommunityApiError['kind'] {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 409) return 'conflict';
  if (status === 410) return 'gone';
  if (status >= 500) return 'server';
  if (status === 0) return 'network';
  return 'unknown';
}

/**
 * Run an axios call and normalise failures into a CommunityApiError. ZodErrors
 * (contract drift) are re-wrapped as `contract` so a screen can show a calm
 * state instead of crashing on a parse throw. `label` prefixes the message.
 */
export async function call<T>(
  schema: z.ZodType<T>,
  fn: () => Promise<{ data: unknown }>,
  label = 'community',
): Promise<T> {
  let res: { data: unknown };
  try {
    res = await fn();
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status ?? 0;
      throw new CommunityApiError(
        classify(status),
        status,
        `${label} request failed (${status || 'network'})`,
        err,
      );
    }
    throw new CommunityApiError('unknown', -1, `${label} request failed`, err);
  }
  try {
    return schema.parse(res.data);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new CommunityApiError(
        'contract',
        200,
        `${label} response shape drifted from the backend contract`,
        err,
      );
    }
    throw err;
  }
}
