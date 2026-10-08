/**
 * FW-ONB-128 B2 (ONB-TOUR-131): Roman's tour says only what is true for the
 * client in front of it.
 *  - No coach linked: Roman names no coach, and the steps about a coach
 *    (community, messaging, calendar, first message, welcome call) are
 *    skipped as `unavailable`, with no done line.
 *  - The closing line repeats only what this tour really did.
 *  - Settings says "Take the tour" until a tour has been completed.
 *  - TutorialHost hands the store `user.coach_id`, the same signal Home uses
 *    for its Message your coach row.
 */
import React from 'react';
import { View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

jest.mock('../../config/featureFlags', () => {
  const actual = jest.requireActual('../../config/featureFlags');
  return {
    ...actual,
    featureFlags: {
      ...actual.featureFlags,
      clientTutorial: true,
      communityTab: true,
      clientCalendar: true,
      consultationOnboarding: false,
    },
  };
});
let mockUser: { id: string; firstName?: string; coach_id?: string } | null = null;
jest.mock('../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../../hooks/useMacros', () => ({ useCurrentMacrosForSelf: () => ({ data: undefined }) }));
jest.mock('../../hooks/useWearableConnections', () => ({
  useWearableConnections: () => ({ data: undefined }),
}));
jest.mock('../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(async () => ({ data: null })) },
}));
jest.mock('../../components/tutorial/TutorialOverlay', () => () => null);
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ getParent: () => ({ navigate: mockNavigate }) }),
}));
jest.mock('../../ui/haptics/haptics.service', () => ({
  HapticService: {
    success: () => Promise.resolve(),
    selection: () => Promise.resolve(),
    warning: () => Promise.resolve(),
  },
}));

import TutorialHost from '../../components/tutorial/TutorialHost';
import ClientTutorialSetting from '../../screens/client/settings/ClientTutorialSetting';
import {
  currentStep,
  initialTutorialState,
  tutorialReducer,
  type MachineEnv,
  type TutorialAction,
} from '../tutorialMachine';
import { TUTORIAL_STEPS, type CopyContext } from '../tutorialSteps';
import {
  __resetTutorialStoreForTests,
  buildCopyContext,
  dispatchTutorial,
  hydrateTutorial,
  setTutorialRoute,
  startClientTutorial,
  useTutorialStore,
} from '../tutorialStore';
import type { TutorialState, TutorialStepId } from '../types';

type Move = TutorialAction | { route: string[] };

const env = (over: Partial<MachineEnv> = {}): MachineEnv => ({
  hasProgram: false,
  hasMacros: true,
  communityAvailable: true,
  calendarAvailable: true,
  currentPath: ['Home', 'HomeMain'],
  now: '2026-10-08T16:00:00.000Z',
  ...over,
});

function run(moves: Move[], over: Partial<MachineEnv> = {}): TutorialState {
  let e = env(over);
  let s = initialTutorialState();
  for (const m of moves) {
    if ('route' in m) {
      e = { ...e, currentPath: m.route };
      s = tutorialReducer(s, { type: 'ROUTE' }, e);
    } else {
      s = tutorialReducer(s, m, e);
    }
  }
  return s;
}

/** A client with numbers but no plan, standing on Home, takes the tour. */
const TO_WEARABLES: Move[] = [
  { type: 'START' },
  { type: 'ACK' }, // welcome; plan is pending; Home is already focused
  { type: 'SIGNAL', signal: 'macro_card_opened' },
];
const TO_COMPLETE: Move[] = [
  ...TO_WEARABLES,
  { route: ['MoreTab', 'Connections'] },
  { type: 'DEFER' },
  { route: ['MoreTab', 'Health'] },
  { type: 'ACK' },
  { route: ['Log'] },
  { type: 'SIGNAL', signal: 'meal_logged' },
];

const COACH_STEPS: TutorialStepId[] = [
  'community',
  'coach_messages',
  'calendar',
  'first_message',
  'welcome_call',
];

const BASE: CopyContext = {
  firstName: 'Maya',
  coachName: 'Bradley',
  program: { id: 'p1', name: 'Foundations', days_per_week: 3, weeks: 4, why: [] },
  macros: { calories: 1789, protein_g: 150, carbs_g: 185, fat_g: 50 },
  spaces: [],
  platform: 'ios',
};
const COACHLESS: CopyContext = { ...BASE, coachName: 'your coach', program: null, coachLinked: false };
const lineOf = (id: TutorialStepId, c: CopyContext): string =>
  TUTORIAL_STEPS.find((s) => s.id === id)!.gates[0].line(c);

const CLOSE = 'One thing at a time. Consistency matters more than perfection.';

describe('no coach linked: the machine skips every step about a coach', () => {
  it('records the coach steps as unavailable and reaches the closing line', () => {
    const s = run(TO_COMPLETE, { coachLinked: false });
    expect(currentStep(s)?.id).toBe('complete');
    for (const id of COACH_STEPS) expect(s.outcomes[id]).toBe('unavailable');
    expect(s.outcomes).toMatchObject({ plan: 'pending', macros: 'done', wearables: 'deferred', first_meal: 'done' });
  });

  it('treats an env without coachLinked as no coach', () => {
    expect(currentStep(run(TO_WEARABLES))?.id).toBe('wearables');
  });

  it('with a coach linked the same client is shown the community step next', () => {
    expect(currentStep(run(TO_WEARABLES, { coachLinked: true }))?.id).toBe('community');
  });
});

describe('the welcome line', () => {
  it('names the coach only when one is linked', () => {
    expect(lineOf('welcome', { ...BASE, coachLinked: true })).toBe(
      'Welcome, Maya. I am Roman. I work with Bradley to help you get the most from your plan. This takes about three minutes. I will show you where everything lives, and then you will try two things yourself.',
    );
    expect(lineOf('welcome', COACHLESS)).toBe(
      'Welcome, Maya. I am Roman. This takes a few minutes. I will show you where everything lives, and then you will log your first meal yourself.',
    );
    expect(lineOf('welcome', { ...COACHLESS, firstName: null })).toMatch(/^Welcome\. I am Roman\. /);
    expect(lineOf('welcome', COACHLESS)).not.toMatch(/coach|work with|two things|plan/i);
  });

  it('speaks of a plan only when there is one', () => {
    const line = lineOf('welcome', { ...BASE, coachLinked: true, program: null });
    expect(line).toContain('I work with Bradley to help you get the most from your training.');
    expect(line).not.toContain('your plan');
  });
});

type CloseCase = [name: string, outcomes: CopyContext['outcomes'], firstName: string | null, expected: string];
const CLOSE_CASES: CloseCase[] = [
  [
    'plan, numbers and message',
    { plan: 'done', macros: 'done', first_message: 'done' },
    'Maya',
    `That is everything, Maya. Your plan is set, your numbers are set, and Bradley has your message. ${CLOSE}`,
  ],
  [
    'no coach to message',
    { plan: 'done', macros: 'done', first_message: 'unavailable' },
    'Maya',
    `That is everything, Maya. Your plan is set and your numbers are set. ${CLOSE}`,
  ],
  [
    'no plan yet',
    { plan: 'pending', macros: 'done', first_message: 'done' },
    'Maya',
    `That is everything, Maya. Your numbers are set and Bradley has your message. ${CLOSE}`,
  ],
  [
    'nothing set and nothing sent',
    { plan: 'pending', macros: 'pending', first_message: 'unavailable' },
    null,
    `That is everything. ${CLOSE}`,
  ],
];

describe('the closing line repeats only what this tour did', () => {
  it.each(CLOSE_CASES)('%s', (_name, outcomes, firstName, expected) => {
    expect(lineOf('complete', { ...BASE, coachLinked: true, firstName, outcomes })).toBe(expected);
  });

  it('a coachless client with numbers hears only that the numbers are set', () => {
    const outcomes = run(TO_COMPLETE, { coachLinked: false }).outcomes;
    expect(lineOf('complete', { ...COACHLESS, outcomes })).toBe(
      `That is everything, Maya. Your numbers are set. ${CLOSE}`,
    );
  });

  it('every new variant keeps the voice rules', () => {
    const variants = [
      lineOf('welcome', COACHLESS),
      lineOf('welcome', { ...BASE, coachLinked: true, program: null }),
      lineOf('complete', { ...COACHLESS, outcomes: { macros: 'done' } }),
      lineOf('complete', { ...COACHLESS, firstName: null, outcomes: {} }),
      lineOf('complete', { ...BASE, coachName: 'your coach', outcomes: { first_message: 'done' } }),
    ];
    for (const l of variants) {
      expect(l).not.toMatch(/!|\u2014|undefined|null|\$\{/);
      expect(l).not.toMatch(/\b\w+'(t|ll|re|ve|d|m)\b/i);
      expect(l).toMatch(/\.$/);
    }
    expect(variants[4]).toContain('Your coach has your message.');
  });
});

describe('the store and TutorialHost carry the coach link', () => {
  beforeEach(async () => {
    __resetTutorialStoreForTests();
    await AsyncStorage.clear();
    mockUser = null;
    mockNavigate.mockClear();
  });

  it('a client without a coach gets no coach step and no coach done line', async () => {
    await hydrateTutorial('u1', 'Maya');
    setTutorialRoute(['Home', 'HomeMain']);
    startClientTutorial({ macros: { calories: 1789, protein_g: 150, carbs_g: 185, fat_g: 50 } });
    expect(buildCopyContext(useTutorialStore.getState(), 'full').coachLinked).toBe(false);
    dispatchTutorial({ type: 'ACK' });
    dispatchTutorial({ type: 'SIGNAL', signal: 'macro_card_opened' });
    expect(currentStep(useTutorialStore.getState().tutorial)?.id).toBe('wearables');
    setTutorialRoute(['MoreTab', 'Connections']);
    dispatchTutorial({ type: 'DEFER' });
    setTutorialRoute(['MoreTab', 'Health']);
    dispatchTutorial({ type: 'ACK' });
    setTutorialRoute(['Log']);
    dispatchTutorial({ type: 'SIGNAL', signal: 'meal_logged' });
    const s = useTutorialStore.getState();
    expect(currentStep(s.tutorial)?.id).toBe('complete');
    expect(s.celebration?.stepId).toBe('first_meal');
    expect(lineOf('complete', buildCopyContext(s, 'full'))).toBe(
      `That is everything, Maya. Your numbers are set. ${CLOSE}`,
    );
  });

  it('TutorialHost passes user.coach_id to the store, and a later link updates it', async () => {
    mockUser = { id: 'u1', firstName: 'Maya' };
    const host = () => (
      <TutorialHost tabs={[]} onNavigate={jest.fn()}>
        <View />
      </TutorialHost>
    );
    const view = await render(host());
    await waitFor(() => expect(useTutorialStore.getState().hydrated).toBe(true));
    expect(useTutorialStore.getState().coachLinked).toBe(false);
    mockUser = { id: 'u1', firstName: 'Maya', coach_id: 'coach-1' };
    await view.rerender(host());
    await waitFor(() => expect(useTutorialStore.getState().coachLinked).toBe(true));
    expect(buildCopyContext(useTutorialStore.getState(), 'full').coachLinked).toBe(true);
  });
});

describe('Settings > Tutorial', () => {
  beforeEach(async () => {
    __resetTutorialStoreForTests();
    await AsyncStorage.clear();
    mockNavigate.mockClear();
  });

  it('says "Take the tour" until a tour is completed, then "Take the tour again"', async () => {
    await hydrateTutorial('u1', 'Maya');
    await render(<ClientTutorialSetting />);
    expect(screen.getByLabelText('Take the tour')).toBeTruthy();
    expect(screen.queryByLabelText('Take the tour again')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Take the tour'));
    expect(mockNavigate).toHaveBeenCalledWith('Home', { screen: 'HomeMain' });
    expect(useTutorialStore.getState().tutorial.status).toBe('active');
    expect(screen.getByLabelText('The tour is in progress')).toBeTruthy();
    await act(async () => {
      dispatchTutorial({ type: 'ACK' });
      setTutorialRoute(['MoreTab', 'Connections']);
      dispatchTutorial({ type: 'DEFER' });
      setTutorialRoute(['MoreTab', 'Health']);
      dispatchTutorial({ type: 'ACK' });
      setTutorialRoute(['Log']);
      dispatchTutorial({ type: 'SIGNAL', signal: 'meal_logged' });
      dispatchTutorial({ type: 'ACK' });
    });
    expect(useTutorialStore.getState().tutorial.status).toBe('completed');
    expect(screen.getByLabelText('Take the tour again')).toBeTruthy();
  });
});
