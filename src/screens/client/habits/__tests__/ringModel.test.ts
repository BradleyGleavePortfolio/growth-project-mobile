import { mondayOf, runLine, segmentsOf, weekCount, weekStrip, type RingHabit } from '../ring/ringModel';

const TODAY = '2026-10-14'; // a Wednesday
const h = (extra: Partial<RingHabit>): RingHabit => ({ id: 'h', user_id: 'u', name: 'Walk', created_at: '', logs: [], ...extra });
const tick = (date: string) => ({ id: date, habit_id: 'h', user_id: 'u', date: `${date}T00:00:00.000Z`, completed: true });

it('the run line: a run from 2 up, else the best run kept, else nothing', () => {
  expect(runLine(h({ schedule_kind: 'daily', run_days: 12 }), true)).toBe('12 days in a row');
  expect(runLine(h({ schedule_kind: 'days', run_days: 6 }), false)).toBe('6 in a row on its days');
  expect(runLine(h({ best_run_days: 9 }), false)).toBe('Open · best run 9 days');
  expect(runLine(h({ best_run_days: 9 }), true)).toBe('Done · best run 9 days');
  expect(runLine(h({ run_days: null, best_run_days: null }), true)).toBeNull();
});

it('the week count is the server\'s, moved by ticks on their way and never past planned', () => {
  const a = h({ id: 'a', week: { planned: 7, done: 3 }, logs: [tick(TODAY)] });
  const b = h({ id: 'b', week: { planned: 3, done: 3 } });
  expect(weekCount([a, b], TODAY, (x) => x.id === 'a')).toEqual({ planned: 10, done: 6 });
  expect(weekCount([a, b], TODAY, () => false)).toEqual({ planned: 10, done: 5 });
  expect(weekCount([a, b], TODAY, () => true)).toEqual({ planned: 10, done: 6 });
  expect(weekCount([h({})], TODAY, () => false)).toBeNull();
});

it('the strip runs Monday to Sunday: past gaps dashed, days to come planned, the days the screen holds from it', () => {
  expect(mondayOf('2026-10-18')).toBe('2026-10-12');
  expect(segmentsOf({ planned: 3, done: 1 }, true)).toEqual(['done', 'missed', 'missed']);
  const days = weekStrip({ today: TODAY, days: [{ date: '2026-10-13', planned: 2, done: 1 }] }, TODAY, (d) => (d === TODAY ? { planned: 3, done: 3 } : null));
  expect(days.map((d) => d.date)).toEqual(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']);
  expect(days[1].segments).toEqual(['done', 'missed']);
  expect(days[2].segments).toEqual(['done', 'done', 'done']);
  expect(days[0].segments).toEqual([]);
});
