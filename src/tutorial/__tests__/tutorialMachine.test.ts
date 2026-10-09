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

/** The full happy path, every gate met by its real action. */
const HAPPY: Array<TutorialAction | { route: string[] }> = [
  { type: 'START' },
  { type: 'ACK' }, // welcome
  { route: ['WorkoutTab', 'WorkoutMain'] },
  { type: 'SIGNAL', signal: 'plan_card_opened' },
  { route: ['Home', 'HomeMain'] },
  { type: 'SIGNAL', signal: 'macro_card_opened' },
  { route: ['Log'] },
  { type: 'SIGNAL', signal: 'meal_logged' },
  { route: ['Home', 'Messages'] },
  { type: 'SIGNAL', signal: 'message_sent' },
  { type: 'ACK' }, // completion
];

describe('tutorial steps', () => {
  it('follow the owner order and end with the quiet completion', () => {
    expect(TUTORIAL_STEPS.map((s) => s.id)).toEqual([
      'welcome',
      'plan',
      'macros',
      'first_meal',
      'first_message',
      'complete',
    ]);
  });

  it('gate the teach-back on real signals, not buttons', () => {
    const meal = TUTORIAL_STEPS.find((s) => s.id === 'first_meal')!;
    const msg = TUTORIAL_STEPS.find((s) => s.id === 'first_message')!;
    expect(meal.gates.some((g) => g.kind === 'signal' && g.signal === 'meal_logged')).toBe(true);
    expect(msg.gates.some((g) => g.kind === 'signal' && g.signal === 'message_sent')).toBe(true);
    expect([...meal.gates, ...msg.gates].some((g) => g.kind === 'ack')).toBe(false);
    expect([...meal.gates, ...msg.gates].some((g) => g.kind === 'signal' && g.allowDefer)).toBe(false);
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

  it('advances a route gate only on the matching focused route', () => {
    let { state } = run([{ type: 'START' }, { type: 'ACK' }, { route: ['Log'] }]);
    expect(id(state)).toBe('plan');
    expect(state.gateIndex).toBe(0);
    ({ state } = run([{ route: ['WorkoutTab', 'WorkoutMain'] }], {}, state));
    expect(state.gateIndex).toBe(1);
    expect(currentGate(state)?.kind).toBe('signal');
  });

  it('ignores unrelated signals on a signal gate', () => {
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
    // After the plan step the client is on Train; macros asks for Home.
    // Starting the macros step while already on Home skips the "tap Home" gate.
    const { state } = run(
      [
        { type: 'START' },
        { type: 'ACK' },
        { route: ['WorkoutTab', 'WorkoutMain'] },
        { route: ['Home', 'HomeMain'] },
      ],
      {},
    );
    // Still on plan gate 1 (needs the card), route changes do not skip a signal.
    expect(id(state)).toBe('plan');
    const next = tutorialReducer(state, { type: 'SIGNAL', signal: 'plan_card_opened' }, baseEnv());
    expect(id(next)).toBe('macros');
    expect(next.gateIndex).toBe(1);
  });

  it('completes the happy path with every step done', () => {
    const { state } = run(HAPPY);
    expect(state.status).toBe('completed');
    expect(state.completedAt).toBe('2026-10-01T00:00:00.000Z');
    for (const s of TUTORIAL_STEPS) expect(state.outcomes[s.id]).toBe('done');
    expect(progressOf(state)).toEqual({ position: 5, total: 5 });
  });

  it('cannot complete without logging a meal and sending a message', () => {
    const withoutMeal = HAPPY.filter(
      (a) => !('type' in a && a.type === 'SIGNAL' && a.signal === 'meal_logged'),
    );
    const { state } = run(withoutMeal);
    expect(state.status).toBe('active');
    expect(id(state)).toBe('first_meal');

    const withoutMsg = HAPPY.filter(
      (a) => !('type' in a && a.type === 'SIGNAL' && a.signal === 'message_sent'),
    );
    const r2 = run(withoutMsg);
    expect(r2.state.status).toBe('active');
    expect(id(r2.state)).toBe('first_message');
  });
});

describe('tutorialReducer — no defer', () => {
  it('refuses DEFER where it is not offered', () => {
    const { state } = run([...HAPPY.slice(0, 7), { type: 'DEFER' }]);
    expect(id(state)).toBe('first_meal');
    expect(state.outcomes.first_meal).toBeUndefined();
  });
});

describe('tutorialReducer — missing data and availability', () => {
  it('marks plan pending without a program and moves on (T-3)', () => {
    const { state } = run([{ type: 'START' }, { type: 'ACK' }], { hasProgram: false });
    expect(state.outcomes.plan).toBe('pending');
    expect(id(state)).toBe('macros');
  });

  it('marks macros pending without numbers', () => {
    const { state } = run(
      [{ type: 'START' }, { type: 'ACK' }, { route: ['WorkoutTab', 'WorkoutMain'] }, { type: 'SIGNAL', signal: 'plan_card_opened' }],
      { hasMacros: false },
    );
    expect(state.outcomes.macros).toBe('pending');
    expect(id(state)).toBe('first_meal');
  });

  it('marks the message step unavailable without a coach', () => {
    const { state } = run(HAPPY.slice(0, 8), { coachLinked: false });
    expect(state.outcomes.first_message).toBe('unavailable');
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
    const ignored = tutorialReducer(state, { type: 'SIGNAL', signal: 'macro_card_opened' }, baseEnv());
    expect(ignored).toBe(state);
    state = tutorialReducer(state, { type: 'RESUME' }, baseEnv({ currentPath: ['Log'] }));
    expect(state.status).toBe('active');
    expect({ stepIndex: state.stepIndex, gateIndex: state.gateIndex }).toEqual(before);
  });

  it('START on a paused tour resumes rather than restarting', () => {
    let { state } = run([...HAPPY.slice(0, 4), { type: 'PAUSE' }]);
    state = tutorialReducer(state, { type: 'START' }, baseEnv({ currentPath: ['Log'] }));
    expect(state.status).toBe('active');
    expect(id(state)).toBe('macros');
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
    const b = tutorialReducer(a, { type: 'SIGNAL', signal: 'plan_card_opened' }, baseEnv());
    expect(newlyFinishedSteps(a, b)).toEqual(['plan']);
    const c = run(HAPPY.slice(0, 8), { coachLinked: false }).state;
    const d = run(HAPPY.slice(0, 7), { coachLinked: false }).state;
    expect(newlyFinishedSteps(d, c)).toEqual(['first_meal']);
  });

  it('progressOf counts five steps', () => {
    expect(progressOf(run([{ type: 'START' }]).state)).toEqual({ position: 1, total: 5 });
  });

  it('parseTutorialState round-trips and rejects garbage', () => {
    const s = run(HAPPY.slice(0, 5)).state;
    expect(parseTutorialState(JSON.parse(JSON.stringify(s)))).toEqual(s);
    expect(parseTutorialState(null)).toBeNull();
    expect(parseTutorialState({ version: 3 })).toBeNull();
    expect(parseTutorialState({ ...s, stepIndex: 99 })).toBeNull();
    expect(parseTutorialState({ ...s, status: 'weird' })).toBeNull();
    expect(parseTutorialState({ ...s, gateIndex: 42 })?.gateIndex).toBe(0);
  });

  it('the retired eleven-step version keeps what the client chose, at the welcome', () => {
    const old = { version: 1, status: 'completed', stepIndex: 10, gateIndex: 2, outcomes: { wearables: 'done' }, completedAt: 'x' };
    expect(parseTutorialState(old)).toMatchObject({ version: 2, status: 'completed', completedAt: 'x', outcomes: {} });
    // Skipped stays skipped (never restarts by itself, B-310-4).
    expect(parseTutorialState({ ...old, status: 'paused', stepIndex: 5 })).toMatchObject({ status: 'paused', stepIndex: 0, gateIndex: 0, completedAt: null });
    expect(parseTutorialState({ ...old, status: 'active', stepIndex: 5 })).toMatchObject({ status: 'active', stepIndex: 0 });
    expect(parseTutorialState({ ...old, status: 'not_started' })).toBeNull();
  });
});
