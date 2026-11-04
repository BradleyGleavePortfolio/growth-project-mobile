/**
 * PEEK-K1-M (K1 Style C, C_peek): every value the peek's four rows format, one line each.
 * Check-ins: K1-S-19 "{n} to review" from the roster, else main's latest check-in, else "Nothing logged yet".
 * Food: main's "{n} of {m} kcal" (C_peek draws kcal alone; its "so far today" is a proposal, not built).
 * Workouts: m#926's K1-S-39 "Missed {day}" or K1-S-38 "{n} of {m} done", else "Nothing planned this week".
 * Weigh-ins: main's "{day}: {weight} lb" (K1-S-45 is not built: a gain or no change has no drawn word).
 */
import { peekSlices } from '../clientPeek';
import { workoutWeek, type ClientWeek } from '../../../screens/coach/client-detail/thisWeek';
import type { RosterClient } from '../clientRoster';
import type { MacroTarget } from '../../../api/macrosApi';

const TODAY = new Date(2026, 10, 4, 9, 41); // Wednesday, November 4, 2026 (local)
const client = (toReview: number) => ({
  id: 'c1', firstName: 'Jordan', lastName: 'Reyes', status: 'active', createdAt: '2026-08-14T10:00:00.000Z',
  activity: { lastActiveOn: '2026-11-04', checkInsToReview: toReview },
}) as unknown as RosterClient;
const week = (assignments: ClientWeek['assignments']) => workoutWeek({ week_start: '2026-11-02', today: '2026-11-04', assignments });
const NONE = week([]);
const summary = (over: Record<string, unknown> = {}) => ({
  profile: null, today: { entries: [{ id: 'e1' }], total_calories: 920, total_protein_g: 64 }, weight_logs: [], ...over,
});
const target = { calories_kcal: 1900, protein_g: 140, carbs_g: 200, fats_g: 60 } as unknown as MacroTarget;
const checkIn = [{ id: 'k1', date: '2026-11-04T00:00:00.000Z', energy: 3, notes: 'Knee a bit tight\nmore' }];

describe('peekSlices: the values C_peek draws on one line each', () => {
  it.each([
    ['one waiting', 1, checkIn, { text: '1 to review', hasOne: true }],
    ['two waiting', 2, checkIn, { text: '2 to review', hasOne: true }],
    ['waiting, latest not read yet', 1, [], { text: '1 to review', hasOne: true }],
    ['none waiting: main\'s latest check-in', 0, checkIn, { text: 'Today: energy 3 of 5, Knee a bit tight', hasOne: true }],
    ['no check-in at all', 0, [], { text: 'Nothing logged yet', hasOne: false }],
  ])('Check-ins, %s', (_case, n, rows, want) => {
    expect(peekSlices(client(n as number), summary(), rows, NONE, null, TODAY).checkIn).toEqual(want);
  });

  it.each([
    ['with a target', target, '920 of 1,900\u00a0kcal'],
    ['without a target', null, '920\u00a0kcal'],
  ])('Food %s: kcal alone, no protein and no second line', (_case, t, want) => {
    expect(peekSlices(client(0), summary(), [], NONE, t as MacroTarget | null, TODAY).food.text).toBe(want);
  });

  it('Food with nothing logged today reads "Nothing logged yet"', () => {
    expect(peekSlices(client(0), summary({ today: { entries: [] } }), [], NONE, target, TODAY).food.text).toBe('Nothing logged yet');
  });

  it.each([
    ['a missed Tuesday', [{ day: '2026-11-02', completed_at: 'x' }, { day: '2026-11-03' }, { day: '2026-11-05' }, { day: '2026-11-07' }], 'Missed Tue', true],
    ['one of four done', [{ day: '2026-11-02', completed_at: 'x' }, { day: '2026-11-05' }, { day: '2026-11-06' }, { day: '2026-11-07' }], '1 of 4 done', true],
    ['nothing planned', [], 'Nothing planned this week', false],
  ])('Workouts, %s', (_case, a, text, ring) => {
    const w = peekSlices(client(0), summary(), [], week(a as ClientWeek['assignments']), null, TODAY).workouts;
    expect(w.text).toBe(text);
    expect(w.week != null).toBe(ring);
  });

  it.each([
    ['today', [{ weight_lbs: 182.44, date: '2026-11-04' }], 'Today: 182.4\u00a0lb'],
    ['none in 30 days', [], 'Nothing logged yet'],
  ])('Weigh-ins, %s', (_case, logs, want) => {
    expect(peekSlices(client(0), summary({ weight_logs: logs }), [], NONE, null, TODAY).weighIn.text).toBe(want);
  });
});
