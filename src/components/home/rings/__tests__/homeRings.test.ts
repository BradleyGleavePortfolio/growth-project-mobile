import { foodDial, formatCount, formatHm, hasHealthSource, sleepDial, trainDial, weekBounds } from '../homeRings';

describe('UI-1 Home dials: each its own number, never invented', () => {
  it('formats counts and sleep the way the mockup does', () => {
    expect(formatCount(1850)).toBe('1,850');
    expect(formatCount(820)).toBe('820');
    expect(formatHm(440)).toBe('7 h 20 m');
    expect(formatHm(420)).toBe('7 h');
    expect(formatHm(45)).toBe('45 m');
  });

  it('Food: kcal left of the daily target, with eaten of target under it', () => {
    expect(foodDial({ ready: true, eaten: 1030, target: 1850 })).toEqual({
      value: '820', unit: 'kcal left', sub: '1,030 of 1,850', progress: 1030 / 1850,
    });
    // Over the target: nothing left and a full ring, never a negative number.
    expect(foodDial({ ready: true, eaten: 2000, target: 1850 })).toMatchObject({ value: '0', unit: 'kcal left', progress: 1 });
    // No target: the eaten number only, empty ring, no made-up goal.
    expect(foodDial({ ready: true, eaten: 640, target: undefined })).toEqual({ value: '640', unit: 'kcal', sub: '', progress: 0 });
    // Not loaded (or failed): a dash, never zero totals.
    expect(foodDial({ ready: false, eaten: 1030, target: 1850 })).toMatchObject({ value: '—', progress: 0 });
  });

  const now = new Date(2026, 9, 9, 14, 10); // Friday 9 October 2026, local
  it('weeks run Monday to Monday in local time', () => {
    expect(weekBounds(now)).toEqual({ start: '2026-10-05', end: '2026-10-12' });
    expect(weekBounds(new Date(2026, 9, 11, 23, 0))).toEqual({ start: '2026-10-05', end: '2026-10-12' });
  });

  it("Train (coached): this week's coach assignments, done of planned", () => {
    const assignments = [
      { scheduled_for: '2026-10-05', completed_at: '2026-10-05T18:00:00Z' },
      { scheduled_for: '2026-10-07', completed_at: '2026-10-07T18:00:00Z' },
      { scheduled_for: '2026-10-09', completed_at: null },
      { scheduled_for: '2026-10-13', completed_at: null }, // next week
      { scheduled_for: '2026-10-01', completed_at: null }, // last week
    ];
    expect(trainDial({ now, assignments, history: [], daysPerWeek: 5, loading: false })).toEqual({
      value: '2 of 3', unit: 'workouts', sub: 'This week', progress: 2 / 3,
    });
  });

  it("Train (coachless): the client's own workouts against their days-per-week answer", () => {
    const history = [
      { date: '2026-10-06' }, { date: '2026-10-06T00:00:00.000Z' }, // one day (UTC-midnight form), counted once
      { date: '2026-10-04' }, // last week
      { date: '2026-10-08', completed: false },
    ];
    expect(trainDial({ now, assignments: [], history, daysPerWeek: 3, loading: false }))
      .toMatchObject({ value: '1 of 3', progress: 1 / 3 });
    expect(trainDial({ now, assignments: [], history, daysPerWeek: undefined, loading: false }))
      .toMatchObject({ value: '1', progress: 0 });
    expect(trainDial({ now, assignments: null, history: null, daysPerWeek: 3, loading: false })).toMatchObject({ value: '—' });
    expect(trainDial({ now, assignments: [], history: [], daysPerWeek: 3, loading: true })).toMatchObject({ value: '—' });
  });

  it('Train: a failed read is never a count (no zero, no claim of no coach plan)', () => {
    const history = [{ date: '2026-10-06' }];
    // Assignments failed: no proof there is no coach plan, even with the client's own workouts.
    expect(trainDial({ now, assignments: null, history, daysPerWeek: 3, loading: false })).toMatchObject({ value: '—', progress: 0 });
    // History failed and no coach assignments this week: not "0 of 3".
    expect(trainDial({ now, assignments: [], history: null, daysPerWeek: 3, loading: false })).toMatchObject({ value: '—', progress: 0 });
    // The coach plan count rests on the assignment read alone.
    expect(trainDial({ now, assignments: [{ scheduled_for: '2026-10-07', completed_at: null }], history: null, daysPerWeek: 3, loading: false }))
      .toMatchObject({ value: '0 of 1' });
  });

  const ok = { reads: { health: 'ok', checkIn: 'ok' }, noSource: false } as const;
  it('Sleep: recovered and asleep from Health, then the check-in, then Connect only with no source (never "coming soon")', () => {
    expect(sleepDial({ recovery: 78, asleepMin: 440, checkInHours: 6, ...ok })).toEqual({
      value: '78%', unit: 'recovered', sub: '7 h 20 m asleep', progress: 0.78, source: 'health',
    });
    expect(sleepDial({ recovery: null, asleepMin: 440, checkInHours: null, ...ok })).toMatchObject({ value: '7.3', unit: 'h asleep', source: 'health' });
    expect(sleepDial({ recovery: null, asleepMin: null, checkInHours: 7.5, ...ok })).toMatchObject({ value: '7.5', unit: 'h asleep', source: 'checkin' });
    // #HEALTH-PAGES: a connected client with nothing for last night keeps the dash.
    expect(sleepDial({ recovery: null, asleepMin: null, checkInHours: null, ...ok })).toMatchObject({ value: '—', source: 'unknown' });
    const none = sleepDial({ recovery: null, asleepMin: null, checkInHours: null, ...ok, noSource: true });
    expect(none).toEqual({ value: 'Connect', unit: '', sub: '', progress: 0, source: 'none' });
    expect(JSON.stringify(none)).not.toMatch(/soon/i);
  });

  it('Sleep: "—", never Connect, while a read is pending or failed; a verified check-in still shows', () => {
    const dash = { value: '—', unit: '', sub: '', progress: 0, source: 'unknown' };
    const empty = { recovery: null, asleepMin: null, checkInHours: null, noSource: true };
    expect(sleepDial({ ...empty, reads: { health: 'pending', checkIn: 'ok' } })).toEqual(dash);
    expect(sleepDial({ ...empty, reads: { health: 'failed', checkIn: 'ok' } })).toEqual(dash);
    expect(sleepDial({ ...empty, reads: { health: 'ok', checkIn: 'pending' } })).toEqual(dash);
    expect(sleepDial({ ...empty, reads: { health: 'ok', checkIn: 'failed' } })).toEqual(dash);
    // Health pending: no check-in number first, so the dial does not jump from one source to another.
    expect(sleepDial({ ...empty, checkInHours: 7.5, reads: { health: 'pending', checkIn: 'ok' } })).toEqual(dash);
    expect(sleepDial({ ...empty, checkInHours: 7.5, reads: { health: 'failed', checkIn: 'ok' } }))
      .toMatchObject({ value: '7.5', unit: 'h asleep', source: 'checkin' });
    // Data already read stays, even if the latest refresh failed.
    expect(sleepDial({ ...empty, recovery: 78, reads: { health: 'failed', checkIn: 'failed' } })).toMatchObject({ value: '78%', source: 'health' });
  });

  it('hasHealthSource: a listed connection or any sample is a source; an empty answer or no answer is not', () => {
    const answer = (providers: number, samples: number) => ({
      version: 1 as const, user_id: 'u1', bucket: 'SLEEP_RECOVERY' as const, window: { from: '', to: '' },
      freshness: { providers: Array.from({ length: providers }, () => ({ provider: 'OURA' as const, last_synced_at: null, status: 'never_synced' as const })) },
      series: [{ metric: 'HRV_MS' as const, unit: 'ms', provider_used: null, sample_count: samples, samples: [] }],
    });
    expect([hasHealthSource(answer(1, 0)), hasHealthSource(answer(0, 3)), hasHealthSource(answer(0, 0)), hasHealthSource(undefined)])
      .toEqual([true, true, false, false]);
  });
});
