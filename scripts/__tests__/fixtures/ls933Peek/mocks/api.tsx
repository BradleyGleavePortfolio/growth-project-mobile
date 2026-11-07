// PEEK-K1-M2 harness: coachApi server replies for one client (summary, latest check-in, the week). Only the server
// reply is stubbed. Device clock: Wednesday Nov 4 2026, 10:00 Pacific. Week Monday Nov 2: Mon done, Tue missed,
// Thu and Sat planned (C_peek: "1 of 4 done", "Missed Tue").
import { ST } from './state';
const ok = (data: unknown) => Promise.resolve({ data });
const never = () => new Promise(() => undefined);
const fail = () => Promise.reject(new Error('harness: server error'));
const EMPTY = ST === 'nothing' || ST === 'notshared';
const SUMMARY = EMPTY
  ? { profile: { macro_target_calories: 1900 }, today: { entries: [], total_calories: 0 }, weight_logs: [], recent_workouts: [] }
  : {
      profile: { macro_target_calories: 1900, protein_target_g: 140 },
      today: { entries: [{ id: 'm1' }, { id: 'm2' }], total_calories: 920, total_protein_g: 61 },
      weight_logs: [{ id: 'wt1', date: '2026-11-03', weight_lbs: 181.6 }],
      recent_workouts: [],
    };
// n = 0: the latest check-in is a free-text note (the Found, not fixed cut at narrow sizes).
const CHECK_INS = EMPTY ? [] : [{ id: 'ci1', date: '2026-11-03', energy: 4, notes: ST === 'nonote' ? '' : 'Slept well, legs a bit sore after Monday' }];
const WEEK = EMPTY
  ? { week_start: '2026-11-02', today: '2026-11-04', assignments: [] }
  : {
      week_start: '2026-11-02', today: '2026-11-04',
      assignments: [
        { day: '2026-11-02', completed_at: '2026-11-02T17:00:00Z' }, { day: '2026-11-03' }, { day: '2026-11-05' }, { day: '2026-11-07' },
      ],
    };
const reply = (v: unknown) => (ST === 'loading' ? never() : ST === 'error' ? fail() : ok(v));
export const coachApi = new Proxy(
  { getClientSummary: () => reply(SUMMARY), getClientCheckIns: () => reply(CHECK_INS), getClientWeek: () => reply(WEEK) } as Record<string, unknown>,
  { get: (t, k: string) => t[k] ?? (() => ok(null)) },
);
export const macrosApi = { currentForClient: () => ok(null) };
export default { get: () => ok(null), post: () => ok(null) };
