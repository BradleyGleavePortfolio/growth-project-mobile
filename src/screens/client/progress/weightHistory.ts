import { WeightLog } from '../../../types';
import { bucketDateLocal } from '../../../utils/date';

/**
 * Typed parser for one weight-history row from the API. The server response is
 * untyped at the boundary and may send either `date` or `created_at`, and
 * either `weight_lbs` or `weight`. This validates the row shape and normalises
 * it into a `WeightLog`, returning `null` for any row missing the fields a
 * `WeightLog` requires (an id and a numeric weight) so callers can drop it
 * instead of force-casting the untyped result through a double assertion (R69).
 * The date is bucketed to the user's LOCAL calendar day so the streak compare
 * is tz-correct on either side of the date line (see audit P0-3).
 */
export function parseWeightLogRow(row: unknown, fallbackUserId: string): WeightLog | null {
  if (typeof row !== 'object' || row === null) return null;
  const r = row as Record<string, unknown>;

  if (typeof r.id !== 'string' || r.id.length === 0) return null;

  const rawWeight = typeof r.weight_lbs === 'number' ? r.weight_lbs : r.weight;
  if (typeof rawWeight !== 'number' || Number.isNaN(rawWeight)) return null;

  const rawDateSource = typeof r.date === 'string' ? r.date : r.created_at;
  const rawDate = typeof rawDateSource === 'string' ? rawDateSource : '';
  // WeightLog.date is a calendar-day column: the server sends it as
  // "YYYY-MM-DDT00:00:00.000Z". Its first ten characters ARE the logged day;
  // converting that UTC midnight to local time put every US entry on the day
  // before. Only a real timestamp (created_at fallback) is bucketed locally.
  const normDate = typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(rawDate)
    ? rawDate.slice(0, 10)
    : bucketDateLocal(new Date(rawDate));

  const createdAt = typeof r.created_at === 'string' ? r.created_at : rawDate;

  return {
    id: r.id,
    userId: typeof r.user_id === 'string' && r.user_id.length > 0 ? r.user_id : fallbackUserId,
    coachId: '',
    date: normDate,
    weight: rawWeight,
    unit: 'lbs',
    notes: typeof r.notes === 'string' ? r.notes : '',
    createdAt,
  };
}

/**
 * GET /weight/history answers `{ logs, height_cm }`. Read the rows from
 * `logs`, and still accept a bare array so an older server keeps working.
 */
export function weightHistoryRows(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (typeof body === 'object' && body !== null) {
    const logs = (body as Record<string, unknown>).logs;
    if (Array.isArray(logs)) return logs;
  }
  return [];
}
