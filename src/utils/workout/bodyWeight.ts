/**
 * FIX-928-BW (agent 197, owner #197-E10): a body-weight exercise shows "BW"
 * where the weight goes ("BW × 60 sec", "BW × 10") and is spoken "body weight".
 *
 * Body-weight comes from the exercise, never from a 0 weight: the catalog's
 * equipment value (GET /exercises/:id, "body weight"; the phone's own exercise
 * list writes "bodyweight"). A weighted exercise at 0 keeps "0 lb"; a
 * body-weight exercise with an added load (a 20 lb dip belt) keeps its number.
 */
export function isBodyWeightEquipment(equipment: unknown): boolean {
  return typeof equipment === 'string' && equipment.toLowerCase().replace(/\s+/g, '') === 'bodyweight';
}

/** True when this weight reads BW: a body-weight exercise with no added load. */
export const readsBW = (bodyWeight: boolean | undefined, weight: number | null | undefined): boolean =>
  !!bodyWeight && !((weight ?? 0) > 0);
