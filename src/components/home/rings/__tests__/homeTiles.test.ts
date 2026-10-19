import { checkInTile, habitsTile, plannedToday, proteinTile, stepsTile, waterTile, weightTile } from '../homeTiles';
import type { WeightLog } from '../../../../types';

const log = (date: string, weight: number): WeightLog =>
  ({ id: date, userId: 'u1', coachId: '', date, weight, unit: 'lbs', notes: '', createdAt: date });

describe('proteinTile', () => {
  it('shows grams against the target with carbs and fat; simple mode drops carbs and fat', () => {
    expect(proteinTile({ ready: true, protein: 73.4, carbs: 100, fat: 38, target: 150, simple: false }))
      .toEqual({ value: '73 g', small: 'of 150', sub: 'Carbs 100 g\nFat 38 g', progress: 73 / 150 });
    expect(proteinTile({ ready: true, protein: 73, target: 150, simple: true }).sub).toBe('');
  });
  it('dashes while the day is pending and draws no bar without a target', () => {
    expect(proteinTile({ ready: false, protein: 73, target: 150, simple: false }))
      .toEqual({ value: '—', small: 'of 150', sub: '', progress: null });
    expect(proteinTile({ ready: true, protein: 20, simple: true })).toEqual({ value: '20 g', small: '', sub: '', progress: null });
  });
});

describe('waterTile', () => {
  it('reads ounces against the goal, or approximate ml in metric', () => {
    expect(waterTile({ ready: true, oz: 48, goalOz: 100, metric: false })).toMatchObject({ value: '48', small: 'of 100 oz' });
    expect(waterTile({ ready: true, oz: 48, goalOz: 100, metric: true })).toMatchObject({ value: '≈ 1,420', small: 'of 2,957 ml' });
    expect(waterTile({ ready: false, oz: 48, goalOz: 100, metric: false }).value).toBe('—');
  });
});

describe('weightTile', () => {
  it('shows the latest weigh-in and says Down only when the 30 days went down', () => {
    const down = weightTile([log('2026-10-12', 168.4), log('2026-09-14', 169.6)], false);
    expect(down).toMatchObject({ value: '168.4', small: 'lb', sub: 'Down 1.2 lb in 30 days', points: [169.6, 168.4] });
    expect(weightTile([log('2026-09-14', 168), log('2026-10-12', 169)], false).sub).toBe('');
    expect(weightTile([log('2026-10-12', 168.4)], true)).toMatchObject({ value: '76.4', small: 'kg', sub: '', points: [] });
  });
  it('dashes with no weigh-ins or a failed read', () => {
    expect(weightTile([], false).value).toBe('—');
    expect(weightTile(null, false).value).toBe('—');
  });
});

describe('habitsTile', () => {
  const habits = [{ id: 'a', name: 'Water' }, { id: 'b', name: 'Steps' }, { id: 'c', name: 'Stretch' }];
  const wed = '2026-10-14'; // a Wednesday; its week starts Monday 2026-10-12
  it('counts done habits today and names done and open ones', () => {
    expect(habitsTile(habits, [{ habit_id: 'a', completed: true }, { habit_id: 'b', completed: true }], wed))
      .toMatchObject({ value: '2', small: 'of 3', sub: 'Water and Steps done. Stretch open.' });
    expect(habitsTile(habits, [], wed).sub).toBe('Water, Steps and Stretch open.');
    expect(habitsTile(habits, [{ habit_id: 'c', completed: false }], wed).value).toBe('0');
  });
  it('dashes with no habits, none planned today, or a read that has not answered', () => {
    expect(habitsTile([], [], wed).value).toBe('—');
    expect(habitsTile(habits, undefined, wed).value).toBe('—');
    expect(habitsTile([{ id: 'a', name: 'Run', schedule_kind: 'days', schedule_days: [1, 5] }], [], wed).value).toBe('—');
  });
  it("follows the ring: only today's planned habits, as the coach or client set them (HB1 plan)", () => {
    const rows = [
      { id: 'a', name: 'Walk', schedule_kind: 'daily' },
      { id: 'b', name: 'Run', schedule_kind: 'days', schedule_days: [1, 3, 5] }, // Mon, Wed, Fri
      { id: 'c', name: 'Yoga', schedule_kind: 'days', schedule_days: [2, 4] }, // not on Wednesday
      { id: 'd', name: 'Swim', schedule_kind: 'daily', starts_on: '2026-10-15T00:00:00.000Z' }, // starts tomorrow
      { id: 'e', name: 'Lift', schedule_kind: 'times_per_week', times_per_week: 2,
        logs: [{ date: '2026-10-12T00:00:00.000Z', completed: true }, { date: '2026-10-09T00:00:00.000Z', completed: true }] },
      { id: 'f', name: 'Read', schedule_kind: 'times_per_week', times_per_week: 1,
        logs: [{ date: '2026-10-13T00:00:00.000Z', completed: true }] }, // met this week
    ];
    expect(habitsTile(rows, [{ habit_id: 'a', completed: true }], wed))
      .toMatchObject({ value: '1', small: 'of 3', sub: 'Walk done. Run and Lift open.' });
    // A habit ticked today stays in today's ring, planned or not.
    expect(habitsTile(rows, [{ habit_id: 'c', completed: true }, { habit_id: 'f', completed: true }], wed))
      .toMatchObject({ value: '2', small: 'of 5', sub: 'Yoga and Read done. Walk, Run and Lift open.' });
  });
  it('plannedToday: a Sunday is day 0, and the week count resets on Monday', () => {
    expect(plannedToday({ id: 'a', name: 'Rest', schedule_kind: 'days', schedule_days: [0] }, '2026-10-18')).toBe(true);
    const lift = { id: 'e', name: 'Lift', schedule_kind: 'times_per_week', times_per_week: 1,
      logs: [{ date: '2026-10-18T00:00:00.000Z', completed: true }] };
    expect(plannedToday(lift, '2026-10-18')).toBe(true); // the tick is today's own
    expect(plannedToday(lift, '2026-10-19')).toBe(true); // Monday: new week
    expect(plannedToday({ ...lift, logs: [{ date: '2026-10-17T00:00:00.000Z', completed: true }] }, '2026-10-18')).toBe(false);
  });
});

describe('checkInTile', () => {
  it("names today's mood, then energy and sleep", () => {
    expect(checkInTile({ mood: 4, energy: 3, sleep_hours: 7.5 })).toMatchObject({ value: 'Good', sub: 'Energy normal, slept 7.5\u00a0h' }); // the h never wraps alone
    expect(checkInTile({ mood: 5, sleep_hours: '6.25' }).sub).toBe('Slept 6.3\u00a0h');
  });
  it('dashes with no check-in today', () => {
    expect(checkInTile(null).value).toBe('—');
    expect(checkInTile({ energy: 3 }).value).toBe('—');
  });
});

describe('stepsTile', () => {
  it("shows today's steps against the Starter goal with the source", () => {
    expect(stepsTile({ today: 6412, connected: true, goal: 5000, source: 'Apple Health' }))
      .toEqual({ value: '6,412', small: '', sub: 'Of 5,000, Apple Health', progress: 1 });
  });
  it('says Connect with no Health source, and dashes when connected with nothing today', () => {
    expect(stepsTile({ today: null, connected: false, goal: 5000, source: null }).value).toBe('Connect');
    expect(stepsTile({ today: null, connected: true, goal: 5000, source: null }).value).toBe('—');
  });
});
