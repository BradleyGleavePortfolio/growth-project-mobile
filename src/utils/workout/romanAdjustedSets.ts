/**
 * B-ROMANADJ-125: when a coach approves Roman's set change in the Action
 * Queue, the server writes the new set counts into the assignment and lists
 * them on the client read as `roman_adjusted_sets` ({ order, sets }). The
 * client screen renders the live plan (so the coach's later edits stay
 * visible), so only these set counts are laid over it, matched by the
 * exercise `order`.
 *
 * Missing or empty field (a server without this change) or an order that
 * no longer exists in the plan leaves the exercise exactly as it was.
 */

export interface RomanAdjustedSet {
  order: number;
  sets: number;
}

export interface RomanSetsOverlay<E> {
  exercises: E[];
  /** Orders whose set count now comes from a coach-approved change. */
  adjustedOrders: ReadonlySet<number>;
}

function readAdjustedSets(raw: unknown): Map<number, number> {
  const byOrder = new Map<number, number>();
  if (!Array.isArray(raw)) return byOrder;
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { order, sets } = item as Partial<RomanAdjustedSet>;
    if (typeof order !== 'number' || !Number.isInteger(order)) continue;
    if (typeof sets !== 'number' || !Number.isInteger(sets) || sets < 1) continue;
    byOrder.set(order, sets);
  }
  return byOrder;
}

export function overlayRomanAdjustedSets<E extends { order: number; sets: number }>(
  exercises: readonly E[],
  raw: unknown,
): RomanSetsOverlay<E> {
  const byOrder = readAdjustedSets(raw);
  const adjustedOrders = new Set<number>();
  const out = exercises.map((ex) => {
    const sets = byOrder.get(ex.order);
    if (sets === undefined) return ex;
    adjustedOrders.add(ex.order);
    return sets === ex.sets ? ex : { ...ex, sets };
  });
  return { exercises: out, adjustedOrders };
}
