import {
  checkInTile, fastingTile, habitsTile, loggingTile, nextSessionTile, proteinTile, shiftDay, stepsTile, waterTile, weightTile,
} from '../homeTiles';
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
  it('counts done habits today and names done and open ones', () => {
    expect(habitsTile(habits, [{ habit_id: 'a', completed: true }, { habit_id: 'b', completed: true }]))
      .toMatchObject({ value: '2', small: 'of 3', sub: 'Water and Steps done. Stretch open.' });
    expect(habitsTile(habits, []).sub).toBe('Water, Steps and Stretch open.');
    expect(habitsTile(habits, [{ habit_id: 'c', completed: false }]).value).toBe('0');
  });
  it('dashes with no habits or a read that has not answered', () => {
    expect(habitsTile([], []).value).toBe('—');
    expect(habitsTile(habits, undefined).value).toBe('—');
  });
});

describe('checkInTile', () => {
  it("names today's mood, then energy and sleep", () => {
    expect(checkInTile({ mood: 4, energy: 3, sleep_hours: 7.5 })).toMatchObject({ value: 'Good', sub: 'Energy normal, slept 7.5 h' });
    expect(checkInTile({ mood: 5, sleep_hours: '6.25' }).sub).toBe('Slept 6.3 h');
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

const MIN = 60000;
const iso = (ms: number) => new Date(ms).toISOString();

describe('fastingTile', () => {
  const now = Date.parse('2026-10-13T12:00:00.000Z');
  it('shows the latest ended fast with "Last fast.", in either key style', () => {
    expect(fastingTile([
      { start_time: iso(now - 40 * 60 * MIN), end_time: iso(now - 30 * 60 * MIN) },
      { startTime: iso(now - (17 * 60 + 5) * MIN), endTime: iso(now - 60 * MIN) },
    ], now)).toEqual({ value: '16 h 5 m', small: '', sub: 'Last fast.', progress: null, active: false });
  });
  it('a running fast shows its time so far, with no foot line', () => {
    expect(fastingTile([
      { start_time: iso(now - 90 * MIN), end_time: null },
      { start_time: iso(now - 30 * 60 * MIN), end_time: iso(now - 14 * 60 * MIN) },
    ], now)).toEqual({ value: '1 h 30 m', small: '', sub: '', progress: null, active: true });
  });
  it('"—" with no fasts, an unread history or unreadable rows', () => {
    expect(fastingTile([], now).value).toBe('—');
    expect(fastingTile(undefined, now).value).toBe('—');
    expect(fastingTile([{ start_time: 'not a date', end_time: null }], now).value).toBe('—');
  });
});

describe('nextSessionTile', () => {
  const now = new Date(2026, 9, 13, 8, 0).getTime();
  const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).toISOString();
  it('the earliest scheduled session still ahead: weekday, 12-hour time and its title', () => {
    const view = nextSessionTile([
      { id: 's3', status: 'scheduled', start_at: at(16, 13, 30), title: 'Later' },
      { id: 's1', status: 'scheduled', start_at: at(14, 9), title: ' Check-in call with Jordan ' },
      { id: 's0', status: 'canceled', start_at: at(13, 10), title: 'Canceled' },
      { id: 'sp', status: 'scheduled', start_at: at(12, 9), title: 'Past' },
    ], now);
    expect(view).toEqual({ value: 'Wed', small: '9:00 am', sub: 'Check-in call with Jordan', progress: null, sessionId: 's1' });
  });
  it('12-hour time: midnight and afternoon', () => {
    expect(nextSessionTile([{ id: 'a', status: 'scheduled', start_at: at(15, 0, 5), title: '' }], now).small).toBe('12:05 am');
    expect(nextSessionTile([{ id: 'b', status: 'scheduled', start_at: at(15, 13, 30), title: '' }], now).small).toBe('1:30 pm');
  });
  it('"—" and no session while the read is pending or failed, or with nothing scheduled ahead', () => {
    expect(nextSessionTile(undefined, now)).toEqual({ value: '—', small: '', sub: '', progress: null, sessionId: null });
    expect(nextSessionTile([{ id: 'r', status: 'requested', start_at: at(15, 9), title: 'Asked' }], now).sessionId).toBeNull();
  });
});

describe('loggingTile and shiftDay', () => {
  it('shiftDay moves calendar days across month and year ends', () => {
    expect(shiftDay('2026-11-01', -1)).toBe('2026-10-31');
    expect(shiftDay('2027-01-01', -13)).toBe('2026-12-19');
  });
  it('counts the days in a row ending today, or yesterday while today is still empty', () => {
    expect(loggingTile(['2026-10-13', '2026-10-12', '2026-10-11', '2026-10-09'], '2026-10-13'))
      .toEqual({ value: '3', small: 'days in a row', sub: 'Food logged each day', progress: null });
    expect(loggingTile(['2026-10-12', '2026-10-11'], '2026-10-13').value).toBe('2');
    expect(loggingTile(['2026-10-13'], '2026-10-13')).toEqual({ value: '1', small: 'day in a row', sub: 'Food logged each day', progress: null });
  });
  it('no run is 0 with no foot line; an unread log is "—"', () => {
    expect(loggingTile(['2026-10-10'], '2026-10-13')).toEqual({ value: '0', small: 'days in a row', sub: '', progress: null });
    expect(loggingTile(null, '2026-10-13').value).toBe('—');
  });
});
