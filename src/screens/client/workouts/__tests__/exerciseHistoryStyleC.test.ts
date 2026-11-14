/**
 * WORKOUT-DETAIL-M: the exercise page's history rules (C1 Style C v2 C2_detail; questions 2 to 5 of the job).
 * Best ever is the server's best as sent (H2), Since week 1 runs from the server's first to the newest session,
 * gold marks only the best (index-v2.md:102), the strip shares one scale, and a date is that calendar day in the
 * phone's own zone. The one request sends the page's name and nothing else (case 9).
 */
jest.mock('../../../../services/api', () => {
  const get = jest.fn();
  return { __esModule: true, default: { get }, get };
});

import api from '../../../../services/api';
import { exerciseHistoryApi, type ExerciseHistory, type HistorySession } from '../../../../api/exerciseHistoryApi';
import {
  changeText, dayLabel, rowSetText, setText, sinceWeek1, spokenSet, starRow, stripSpots,
} from '../exerciseHistoryStyleC';

const get = api.get as jest.Mock;

function session(date: string, weight: number, reps: number, sets = 3): HistorySession {
  return {
    workout_id: `w-${date}`, date, sets, reps_per_set: Array(sets).fill(reps), weight_per_set_lbs: Array(sets).fill(weight),
    rpe: null, top_set: reps >= 1 ? { weight_lbs: weight, reps } : null, est_1rm_lbs: null, volume_lbs: weight * reps * sets,
    coach_comments: [],
  };
}
const point = (s: HistorySession) => ({ date: s.date, top_set: s.top_set });
/** Newest first, as the server sends them; best and first as the server computes them over all history. */
function answer(sessions: HistorySession[], best: HistorySession | null, first?: { date: string; top_set: HistorySession['top_set'] } | null): ExerciseHistory {
  return { best: best ? point(best) : null, first: first === undefined ? (sessions.length ? point(sessions[sessions.length - 1]) : null) : first, sessions };
}

// C2_detail's four rows plus the week 1 its line starts from (case 1).
const oct13 = session('2026-10-13', 155, 6);
const oct6 = session('2026-10-06', 150, 6);
const sep29 = session('2026-09-29', 150, 5);
const sep22 = session('2026-09-22', 145, 6);
const sep15 = session('2026-09-15', 135, 8);
const CASE1 = answer([oct13, oct6, sep29, sep22, sep15], oct13);

/**
 * The phone's zone, emulated: jest's sandboxed process.env cannot move the runner's zone, so every date format call
 * gets the zone the test names (the ls917DayBoundaries pattern). A date read as UTC midnight then prints the day before
 * in Los Angeles.
 */
function inZone(zone: string) {
  const toLocale = Date.prototype.toLocaleDateString;
  const Native = Intl.DateTimeFormat;
  const a = jest.spyOn(Date.prototype, 'toLocaleDateString').mockImplementation(function (this: Date, l, o) {
    return toLocale.call(this, l, { ...o, timeZone: o?.timeZone ?? zone });
  });
  const b = jest.spyOn(Intl, 'DateTimeFormat').mockImplementation((l, o) =>
    new Native(l, { ...o, timeZone: o?.timeZone ?? zone }));
  return () => { a.mockRestore(); b.mockRestore(); };
}

describe('dates (case 10): "2026-10-13" reads Oct 13 as that calendar day in the phone zone', () => {
  let restore = () => undefined as void;
  afterEach(() => restore());
  it.each(['America/Los_Angeles', 'Pacific/Auckland', 'UTC'])('in %s', (tz) => {
    restore = inZone(tz);
    expect(dayLabel('2026-10-13')).toBe('Oct 13');
    expect(dayLabel('2026-10-13', true)).toBe('October 13');
    expect(dayLabel('2026-01-01')).toBe('Jan 1');
    expect(dayLabel('2026-09-29')).toBe('Sep 29');
  });
});

describe('the set forms (question 3, case 7)', () => {
  it('reads a weighted top set as drawn and a body-weight one as BW', () => {
    expect(setText({ weight_lbs: 155, reps: 6 })).toBe('155 × 6');
    expect(rowSetText({ weight_lbs: 155, reps: 6 })).toBe('155 × 6 lb');
    expect(setText({ weight_lbs: 0, reps: 12 })).toBe('BW × 12');
    expect(rowSetText({ weight_lbs: 0, reps: 12 })).toBe('BW × 12');
    expect(spokenSet({ weight_lbs: 155, reps: 6 })).toBe('155 pounds by 6');
    expect(spokenSet({ weight_lbs: 0, reps: 12 })).toBe('body weight by 12');
  });
  it('writes the change as drawn: +20 lb, a fall with a minus sign, none as +0 lb', () => {
    expect(changeText(20)).toBe('+20 lb');
    expect(changeText(-10)).toBe('−10 lb');
    expect(changeText(0)).toBe('+0 lb');
    expect(changeText(2.5)).toBe('+2.5 lb');
  });
});

describe('the star (question 3, H2, H3)', () => {
  it('sits on the one row whose date and top set equal best', () => {
    expect(starRow(CASE1)).toBe(0);
    const heavy = session('2026-10-06', 160, 5);
    const lighterSameWeight = session('2026-09-29', 160, 3);
    expect(starRow(answer([oct13, heavy, lighterSameWeight, sep22, sep15], heavy))).toBe(1);
  });
  it('with two equal rows on the best day, takes the older one, as the server tie rule keeps', () => {
    const a = { ...session('2026-10-13', 155, 6), workout_id: 'later' };
    const b = { ...session('2026-10-13', 155, 6), workout_id: 'earlier' };
    expect(starRow(answer([a, b, sep15], b))).toBe(1);
  });
  it('is on no row when the server has no best', () => {
    expect(starRow(answer([], null, null))).toBe(-1);
  });
});

describe('Since week 1 (question 2)', () => {
  it('is the newest top set minus week 1, through every session oldest to newest, gold end when the newest is the best', () => {
    expect(sinceWeek1(CASE1)).toEqual({ change: 20, weights: [135, 145, 150, 150, 155], from: 135, to: 155, endIsBest: true });
  });
  it('reads from the newest session, never from best, and ends moss when the best is older (case 2)', () => {
    const heavy = session('2026-10-06', 160, 5);
    const h = answer([oct13, heavy, session('2026-09-29', 160, 3), sep22, sep15], heavy);
    expect(sinceWeek1(h)).toEqual({ change: 20, weights: [135, 145, 160, 160, 155], from: 135, to: 155, endIsBest: false });
  });
  it('starts from first when first is older than every returned session (past 100, H5)', () => {
    const h = answer([oct13, oct6], oct13, { date: '2025-01-05', top_set: { weight_lbs: 100, reps: 5 } });
    expect(sinceWeek1(h)).toEqual({ change: 55, weights: [100, 150, 155], from: 100, to: 155, endIsBest: true });
  });
  it('a fall reads negative', () => {
    const h = answer([session('2026-10-13', 125, 6), sep15], sep15);
    expect(sinceWeek1(h)?.change).toBe(-10);
  });
  it('is absent with one session, with sessions on one date only, and when week 1 has no top set or weight 0', () => {
    expect(sinceWeek1(answer([oct13], oct13))).toBeNull();
    const sameDay = session('2026-10-13', 145, 6);
    expect(sinceWeek1(answer([oct13, sameDay], oct13))).toBeNull();
    expect(sinceWeek1(answer([oct13, sep15], oct13, { date: sep15.date, top_set: null }))).toBeNull();
    expect(sinceWeek1(answer([oct13, session('2026-09-15', 0, 10)], oct13))).toBeNull();
    expect(sinceWeek1(answer([], null, null))).toBeNull();
  });
  it('skips a body-weight or repless session as a point and never swaps another row in as week 1', () => {
    const h = answer([oct13, session('2026-10-06', 0, 10), session('2026-09-29', 150, 0), sep15], oct13);
    expect(sinceWeek1(h)).toEqual({ change: 20, weights: [135, 155], from: 135, to: 155, endIsBest: true });
  });
});

describe('the strip (question 4)', () => {
  it('one shared scale: the lowest at a quarter, the highest at three quarters, as C2_detail places them', () => {
    expect(stripSpots([oct13, oct6, sep29, sep22])).toEqual([0.75, 0.5, 0.5, 0.25]);
  });
  it('centres every dot when all are equal, and draws no dot for a row with no top set', () => {
    expect(stripSpots([session('2026-10-13', 0, 12), session('2026-10-06', 0, 10)])).toEqual([0.5, 0.5]);
    expect(stripSpots([oct13, session('2026-10-06', 150, 0)])).toEqual([0.5, null]);
  });
});

describe('the request (case 9)', () => {
  beforeEach(() => get.mockReset());
  it('asks GET /workouts/exercise-history with the trimmed name only, URL-encoded', async () => {
    get.mockResolvedValueOnce({ data: CASE1 });
    await expect(exerciseHistoryApi.get('  Curl & press ')).resolves.toEqual(CASE1);
    expect(get.mock.calls).toEqual([['/workouts/exercise-history?name=Curl%20%26%20press']]);
  });
  it('rejects an answer without sessions, and sends nothing for an empty name', async () => {
    get.mockResolvedValueOnce({ data: { best: null } });
    await expect(exerciseHistoryApi.get('Bench press')).rejects.toBeTruthy();
    get.mockClear();
    await expect(exerciseHistoryApi.get('   ')).rejects.toBeTruthy();
    expect(get).not.toHaveBeenCalled();
  });
});
