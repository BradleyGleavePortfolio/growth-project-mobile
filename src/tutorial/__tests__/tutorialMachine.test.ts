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
  communityAvailable: true,
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
  { route: ['CommunityTab', 'CommunityTab'] },
  { type: 'ACK' },
  { route: ['Home', 'Messages'] },
  { type: 'ACK' },
  { route: ['MoreTab', 'Connections'] },
  { type: 'SIGNAL', signal: 'wearable_connected' },
  { route: ['MoreTab', 'Health'] },
  { type: 'ACK' },
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
      'community',
      'coach_messages',
      'wearables',
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
    expect(progressOf(state)).toEqual({ position: 8, total: 8 });
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

describe('tutorialReducer — wearables', () => {
  const toWearable: Array<TutorialAction | { route: string[] }> = HAPPY.slice(0, 11);

  it('reaches the connect gate and accepts a real connection', () => {
    let { state } = run(toWearable);
    expect(id(state)).toBe('wearables');
    expect(currentGate(state)).toMatchObject({ kind: 'signal', signal: 'wearable_connected' });
    state = tutorialReducer(state, { type: 'SIGNAL', signal: 'wearable_connected' }, baseEnv());
    expect(currentGate(state)).toMatchObject({ kind: 'route', routes: ['Health'] });
  });

  it('accepts an explicit deferral, records it, and still shows where health data lives', () => {
    let { state } = run(toWearable);
    state = tutorialReducer(state, { type: 'DEFER' }, baseEnv());
    expect(state.outcomes.wearables).toBe('deferred');
    expect(currentGate(state)).toMatchObject({ kind: 'route', routes: ['Health'] });
    ({ state } = run([{ route: ['MoreTab', 'Health'] }, { type: 'ACK' }], {}, state));
    expect(id(state)).toBe('first_meal');
    expect(state.outcomes.wearables).toBe('deferred');
  });

  it('refuses DEFER anywhere it is not offered', () => {
    const { state } = run([...HAPPY.slice(0, 15), { type: 'DEFER' }]);
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
    expect(id(state)).toBe('community');
  });

  it('marks community unavailable when the tab is not in the build', () => {
    const { state } = run(HAPPY.slice(0, 6), { communityAvailable: false });
    expect(state.outcomes.community).toBe('unavailable');
    expect(id(state)).toBe('coach_messages');
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
    const c = run(HAPPY.slice(0, 6), { communityAvailable: false }).state;
    const d = run(HAPPY.slice(0, 5), { communityAvailable: false }).state;
    expect(newlyFinishedSteps(d, c)).toEqual(['macros']);
  });

  it('progressOf counts eight steps', () => {
    expect(progressOf(run([{ type: 'START' }]).state)).toEqual({ position: 1, total: 8 });
  });

  it('parseTutorialState round-trips and rejects garbage', () => {
    const s = run(HAPPY.slice(0, 5)).state;
    expect(parseTutorialState(JSON.parse(JSON.stringify(s)))).toEqual(s);
    expect(parseTutorialState(null)).toBeNull();
    expect(parseTutorialState({ version: 2 })).toBeNull();
    expect(parseTutorialState({ ...s, stepIndex: 99 })).toBeNull();
    expect(parseTutorialState({ ...s, status: 'weird' })).toBeNull();
    expect(parseTutorialState({ ...s, gateIndex: 42 })?.gateIndex).toBe(0);
  });
});
