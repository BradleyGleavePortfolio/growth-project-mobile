import {
  currentGate,
  currentStep,
  initialTutorialState,
  newlyFinishedSteps,
  parseTutorialState,
  progressOf,
  tutorialReducer,
  type MachineEnv,
  type TutorialAction,
} from '../tutorialMachine';
import { TUTORIAL_STEPS } from '../tutorialSteps';
import type { TutorialState } from '../types';

const baseEnv = (over: Partial<MachineEnv> = {}): MachineEnv => ({
  hasProgram: true,
  hasMacros: true,
  romanAvailable: true,
  coachLinked: true,
  currentPath: ['Home', 'HomeMain'],
  now: '2026-10-01T00:00:00.000Z',
  ...over,
});

function run(
  actions: Array<TutorialAction | { route: string[] }>,
  envOver: Partial<MachineEnv> = {},
  start: TutorialState = initialTutorialState(),
): { state: TutorialState; env: MachineEnv } {
  let env = baseEnv(envOver);
  let state = start;
  for (const a of actions) {
    if ('route' in a) {
      env = { ...env, currentPath: a.route };
      state = tutorialReducer(state, { type: 'ROUTE' }, env);
    } else {
      state = tutorialReducer(state, a, env);
    }
  }
  return { state, env };
}

const id = (s: TutorialState) => currentStep(s)?.id;

/** The full happy path (prototype 46-60), every gate met by its real action. */
const HAPPY: Array<TutorialAction | { route: string[] }> = [
  { type: 'START' },
  { type: 'ACK' }, // 1 welcome
  { route: ['WorkoutTab', 'WorkoutMain'] }, // 2 Train tab
  { route: ['MoreTab', 'WorkoutAssignmentDetail'] }, // 2 first day from the plan card
  { type: 'ACK' }, // 3 first exercise
  { route: ['Log'] }, // 4 Food tab
  { type: 'SIGNAL', signal: 'meal_logged' }, // 4 saved
  { route: ['Home', 'HomeMain'] }, // 5 Home
  { type: 'SIGNAL', signal: 'macro_card_opened' }, // 5 targets card
  { route: ['Home', 'Messages'] }, // 6 coach thread
  { type: 'SIGNAL', signal: 'message_sent' }, // 6 sent
  { type: 'ACK' }, // 7 completion
];

describe('tutorial steps', () => {
  it('are the seven prototype beats, with the Roman beat as the coachless form of six', () => {
    expect(TUTORIAL_STEPS.map((s) => [s.id, s.ordinal])).toEqual([
      ['welcome', 1],
      ['plan', 2],
      ['first_exercise', 3],
      ['first_meal', 4],
      ['macros', 5],
      ['first_message', 6],
      ['roman', 6],
      ['complete', 7],
    ]);
  });

  it('gate the teach-back on real signals, not buttons', () => {
    const meal = TUTORIAL_STEPS.find((s) => s.id === 'first_meal')!;
    const msg = TUTORIAL_STEPS.find((s) => s.id === 'first_message')!;
    expect(meal.gates.some((g) => g.kind === 'signal' && g.signal === 'meal_logged')).toBe(true);
    expect(msg.gates.some((g) => g.kind === 'signal' && g.signal === 'message_sent')).toBe(true);
    expect([...meal.gates, ...msg.gates].some((g) => g.kind === 'ack')).toBe(false);
    // The message beat is freely skippable on both gates (prototype Tutorial 4); the meal is not.
    expect(meal.gates.some((g) => g.allowDefer)).toBe(false);
    expect(msg.gates.every((g) => g.allowDefer)).toBe(true);
  });
});

describe('tutorialReducer — gating', () => {
  it('starts on the welcome step and only an explicit Begin moves it', () => {
    let { state } = run([{ type: 'START' }]);
    expect(state.status).toBe('active');
    expect(id(state)).toBe('welcome');
    state = tutorialReducer(state, { type: 'SIGNAL', signal: 'meal_logged' }, baseEnv());
    expect(id(state)).toBe('welcome');
    state = tutorialReducer(state, { type: 'ACK' }, baseEnv());
    expect(id(state)).toBe('plan');
  });

  it('ignores ACK on a route or signal gate', () => {
    const { state } = run([{ type: 'START' }, { type: 'ACK' }, { type: 'ACK' }, { type: 'ACK' }]);
    expect(id(state)).toBe('plan');
    expect(state.gateIndex).toBe(0);
  });

  it('the plan beat needs Train, then the real first day opened from the card', () => {
    let { state } = run([{ type: 'START' }, { type: 'ACK' }, { route: ['Log'] }]);
    expect([id(state), state.gateIndex]).toEqual(['plan', 0]);
    ({ state } = run([{ route: ['WorkoutTab', 'WorkoutMain'] }], {}, state));
    expect([id(state), state.gateIndex]).toEqual(['plan', 1]);
    ({ state } = run([{ type: 'SIGNAL', signal: 'plan_card_opened' }], {}, state));
    expect([id(state), state.gateIndex]).toEqual(['plan', 1]);
    ({ state } = run([{ route: ['MoreTab', 'WorkoutAssignmentDetail'] }], {}, state));
    expect(id(state)).toBe('first_exercise');
    expect(state.outcomes.plan).toBe('done');
  });

  it('ignores unrelated signals on a gate', () => {
    const { state } = run([
      { type: 'START' },
      { type: 'ACK' },
      { route: ['WorkoutTab', 'WorkoutMain'] },
      { type: 'SIGNAL', signal: 'macro_card_opened' },
      { type: 'SIGNAL', signal: 'message_sent' },
    ]);
    expect(id(state)).toBe('plan');
    expect(state.gateIndex).toBe(1);
  });

  it('auto-satisfies a route gate when the client already stands on it', () => {
    // The meal is saved while the client is back on Home: "tap Home" is skipped.
    const { state } = run([
      ...HAPPY.slice(0, 6),
      { route: ['Home', 'HomeMain'] },
      { type: 'SIGNAL', signal: 'meal_logged' },
    ]);
    expect([id(state), state.gateIndex]).toEqual(['macros', 1]);
  });

  it('completes the happy path with every beat done and the Roman beat not shown', () => {
    const { state } = run(HAPPY);
    expect(state.status).toBe('completed');
    expect(state.completedAt).toBe('2026-10-01T00:00:00.000Z');
    for (const s of TUTORIAL_STEPS) expect(state.outcomes[s.id]).toBe(s.id === 'roman' ? 'unavailable' : 'done');
    expect(progressOf(state)).toEqual({ position: 7, total: 7 });
  });

  it('cannot complete without logging a meal', () => {
    const withoutMeal = HAPPY.filter((a) => !('type' in a && a.type === 'SIGNAL' && a.signal === 'meal_logged'));
    const { state } = run(withoutMeal);
    expect(state.status).toBe('active');
    expect(id(state)).toBe('first_meal');
  });

  it('Later on the message beat records a deferral and moves to the completion', () => {
    for (const n of [9, 10]) {
      const { state } = run([...HAPPY.slice(0, n), { type: 'DEFER' }]);
      expect(state.outcomes.first_message).toBe('deferred');
      expect(id(state)).toBe('complete');
    }
  });

  it('refuses DEFER anywhere it is not offered', () => {
    const { state } = run([...HAPPY.slice(0, 6), { type: 'DEFER' }]);
    expect(id(state)).toBe('first_meal');
    expect(state.outcomes.first_meal).toBeUndefined();
  });
});

describe('tutorialReducer — missing data and availability', () => {
  it('without a program, beats 2 and 3 are pending and the tour moves to Food (66, T-3)', () => {
    const { state } = run([{ type: 'START' }, { type: 'ACK' }], { hasProgram: false });
    expect(state.outcomes.plan).toBe('pending');
    expect(state.outcomes.first_exercise).toBe('pending');
    expect(id(state)).toBe('first_meal');
    expect(progressOf(state).position).toBe(4);
  });

  it('marks macros pending without numbers', () => {
    const { state } = run(HAPPY.slice(0, 7), { hasMacros: false });
    expect(state.outcomes.macros).toBe('pending');
    expect(id(state)).toBe('first_message');
  });

  it('a client without a coach meets the Roman beat instead of the coach beat', () => {
    const { state } = run(HAPPY.slice(0, 9), { coachLinked: false });
    expect(state.outcomes.first_message).toBe('unavailable');
    expect(id(state)).toBe('roman');
    expect(progressOf(state)).toEqual({ position: 6, total: 7 });
    const done = tutorialReducer(state, { type: 'ACK' }, baseEnv({ coachLinked: false }));
    expect(id(done)).toBe('complete');
  });

  it('skips the Roman beat when Roman chat is not in the build', () => {
    const { state } = run(HAPPY.slice(0, 9), { coachLinked: false, romanAvailable: false });
    expect(state.outcomes.roman).toBe('unavailable');
    expect(id(state)).toBe('complete');
  });
});

describe('tutorialReducer — skip and resume', () => {
  it('PAUSE keeps the exact position; RESUME continues there', () => {
    let { state } = run(HAPPY.slice(0, 4));
    const before = { stepIndex: state.stepIndex, gateIndex: state.gateIndex };
    state = tutorialReducer(state, { type: 'PAUSE' }, baseEnv());
    expect(state.status).toBe('paused');
    // Paused: nothing advances.
    const ignored = tutorialReducer(state, { type: 'ROUTE' }, baseEnv({ currentPath: ['MoreTab', 'WorkoutAssignmentDetail'] }));
    expect(ignored).toBe(state);
    state = tutorialReducer(state, { type: 'RESUME' }, baseEnv({ currentPath: ['Log'] }));
    expect(state.status).toBe('active');
    expect({ stepIndex: state.stepIndex, gateIndex: state.gateIndex }).toEqual(before);
  });

  it('START on a paused tour resumes rather than restarting', () => {
    let { state } = run([...HAPPY.slice(0, 4), { type: 'PAUSE' }]);
    state = tutorialReducer(state, { type: 'START' }, baseEnv({ currentPath: ['Log'] }));
    expect(state.status).toBe('active');
    expect(id(state)).toBe('first_exercise');
  });

  it('START does not rerun a completed tour unless restart is asked', () => {
    let { state } = run(HAPPY);
    expect(tutorialReducer(state, { type: 'START' }, baseEnv())).toBe(state);
    state = tutorialReducer(state, { type: 'START', restart: true }, baseEnv());
    expect(state.status).toBe('active');
    expect(id(state)).toBe('welcome');
    expect(state.outcomes).toEqual({});
  });
});

describe('helpers', () => {
  it('newlyFinishedSteps reports each step once, never unavailable ones', () => {
    const a = run(HAPPY.slice(0, 3)).state;
    const b = run([{ route: ['MoreTab', 'WorkoutAssignmentDetail'] }], {}, a).state;
    expect(newlyFinishedSteps(a, b)).toEqual(['plan']);
    const c = run(HAPPY.slice(0, 11)).state;
    const d = run(HAPPY.slice(0, 10)).state;
    expect(newlyFinishedSteps(d, c)).toEqual(['first_message']);
  });

  it('progressOf speaks "Step n of 7"', () => {
    expect(progressOf(run([{ type: 'START' }]).state)).toEqual({ position: 1, total: 7 });
  });

  it('parseTutorialState round-trips and rejects garbage', () => {
    const s = run(HAPPY.slice(0, 5)).state;
    expect(parseTutorialState(JSON.parse(JSON.stringify(s)))).toEqual(s);
    expect(parseTutorialState(null)).toBeNull();
    expect(parseTutorialState({ version: 4 })).toBeNull();
    expect(parseTutorialState({ ...s, stepIndex: 99 })).toBeNull();
    expect(parseTutorialState({ ...s, status: 'weird' })).toBeNull();
    expect(parseTutorialState({ ...s, gateIndex: 42 })?.gateIndex).toBe(0);
  });

  it.each([1, 2])('an older step list (v%i) keeps what the client chose, at the welcome', (version) => {
    const old = { version, status: 'completed', stepIndex: 5, gateIndex: 2, outcomes: { wearables: 'done' }, completedAt: 'x' };
    expect(parseTutorialState(old)).toMatchObject({ version: 3, status: 'completed', completedAt: 'x', outcomes: {} });
    // Skipped stays skipped (never restarts by itself, B-310-4).
    expect(parseTutorialState({ ...old, status: 'paused', stepIndex: 5 })).toMatchObject({ status: 'paused', stepIndex: 0, gateIndex: 0, completedAt: null });
    expect(parseTutorialState({ ...old, status: 'active', stepIndex: 5 })).toMatchObject({ status: 'active', stepIndex: 0 });
    expect(parseTutorialState({ ...old, status: 'not_started' })).toBeNull();
  });
});
