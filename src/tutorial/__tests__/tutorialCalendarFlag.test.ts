/**
 * S-SCHED: with featureFlags.clientCalendar ON, the tour walks the Calendar
 * intro after messaging the coach and ends with the welcome call, which
 * can be booked (signal) or skipped (Later) and never blocks completion.
 */
jest.mock('../../config/featureFlags', () => {
  const actual = jest.requireActual('../../config/featureFlags');
  return { ...actual, featureFlags: { ...actual.featureFlags, clientCalendar: true } };
});

import { currentStep, initialTutorialState, progressOf, tutorialReducer, type MachineEnv, type TutorialAction } from '../tutorialMachine';
import type { TutorialState } from '../types';

const env = (over: Partial<MachineEnv> = {}): MachineEnv => ({
  hasProgram: true,
  hasMacros: true,
  communityAvailable: true,
  calendarAvailable: true,
  currentPath: ['Home', 'HomeMain'],
  now: '2026-10-01T00:00:00.000Z',
  ...over,
});

function run(actions: Array<TutorialAction | { route: string[] }>, over: Partial<MachineEnv> = {}): TutorialState {
  let e = env(over);
  let s = initialTutorialState();
  for (const a of actions) {
    if ('route' in a) {
      e = { ...e, currentPath: a.route };
      s = tutorialReducer(s, { type: 'ROUTE' }, e);
    } else {
      s = tutorialReducer(s, a, e);
    }
  }
  return s;
}

const TO_CALENDAR: Array<TutorialAction | { route: string[] }> = [
  { type: 'START' },
  { type: 'ACK' },
  { route: ['WorkoutTab', 'WorkoutMain'] },
  { type: 'SIGNAL', signal: 'plan_card_opened' },
  { route: ['Home', 'HomeMain'] },
  { type: 'SIGNAL', signal: 'macro_card_opened' },
  { route: ['CommunityTab', 'CommunityTab'] },
  { type: 'ACK' },
  { route: ['Home', 'Messages'] },
  { type: 'ACK' },
];
const TO_WELCOME: Array<TutorialAction | { route: string[] }> = [
  ...TO_CALENDAR,
  { route: ['CalendarTab', 'CalendarHome'] },
  { type: 'ACK' },
  { route: ['MoreTab', 'Connections'] },
  { type: 'SIGNAL', signal: 'wearable_connected' },
  { route: ['MoreTab', 'Health'] },
  { type: 'ACK' },
  { route: ['Log'] },
  { type: 'SIGNAL', signal: 'meal_logged' },
  { route: ['Home', 'Messages'] },
  { type: 'SIGNAL', signal: 'message_sent' },
];

describe('tutorial with the Calendar flag on', () => {
  it('the Calendar step follows messaging the coach and needs a real tap on Calendar', () => {
    const s = run(TO_CALENDAR);
    expect(currentStep(s)?.id).toBe('calendar');
    expect(currentStep(run([...TO_CALENDAR, { type: 'ACK' }]))?.id).toBe('calendar');
    expect(currentStep(run([...TO_CALENDAR, { route: ['CalendarTab', 'CalendarHome'] }, { type: 'ACK' }]))?.id).toBe('wearables');
    expect(progressOf(s).total).toBe(10);
  });

  it('ends with the welcome call: booking it finishes the tour', () => {
    const s = run(TO_WELCOME);
    expect(currentStep(s)?.id).toBe('welcome_call');
    const booked = run([...TO_WELCOME, { type: 'SIGNAL', signal: 'welcome_call_booked' }]);
    expect(currentStep(booked)?.id).toBe('complete');
    expect(booked.outcomes.welcome_call).toBe('done');
  });

  it('the welcome call is skippable and never blocks finishing', () => {
    const skipped = run([...TO_WELCOME, { type: 'DEFER' }]);
    expect(currentStep(skipped)?.id).toBe('complete');
    expect(skipped.outcomes.welcome_call).toBe('deferred');
    const done = run([...TO_WELCOME, { type: 'DEFER' }, { type: 'ACK' }]);
    expect(done.status).toBe('completed');
  });

  it('a wrong signal does not advance the welcome call', () => {
    expect(currentStep(run([...TO_WELCOME, { type: 'SIGNAL', signal: 'meal_logged' }]))?.id).toBe('welcome_call');
  });

  it('the machine still skips both steps if the env says Calendar is unavailable', () => {
    const s = run(TO_CALENDAR, { calendarAvailable: false });
    expect(currentStep(s)?.id).toBe('wearables');
    expect(s.outcomes.calendar).toBe('unavailable');
  });
});
