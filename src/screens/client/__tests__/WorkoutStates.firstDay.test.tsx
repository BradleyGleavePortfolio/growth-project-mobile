/**
 * WORKOUT-STATES-M (C1 v2 C7, frames C2_first and C2_loading): the Train tab's first day with clientTrainV2 on.
 *   - A coached client whose coach has set no workout yet reads her coach's card ("Sam is building your first plan. ...")
 *     on the scheme's cream card above "Nothing planned yet.", and "Message Sam" under Quick workout, only while the
 *     coaching chat is known to be open (owner 10-23 "Dissapear"; FR-880R2 and FR-880R3's one hook).
 *   - Until she has a workout of her own or from the coach, the three lines that only say there is nothing yet are left
 *     off (Recent workouts with "No recent workouts", and the two chart lines); a failed read keeps main's page.
 *   - A client with no coach meets no coach at all: no card, no line, no link, no request for her coaches or her chat.
 * The stand-ins are WorkoutScreen.trainV2159.test.tsx's (:19-62), copied, plus the closed-chat hook, the coaches read
 * recording whether it was switched on, and m#1000's refused-workout card stood in (this file proves the first day).
 * Fixtures are fictional: a client c1, coach Sam Rivera.
 */
import fs from 'fs';
import path from 'path';
import React from 'react';
import { AppState, Dimensions, PixelRatio, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { lightTokens } from '../../../theme/tokens';
import { HapticService } from '../../../ui/haptics/haptics.service';
import { getTodayString } from '../../../utils/date';

const mockFlags = { clientTrainV2: true, romanChat: false, clientTutorial: false };
jest.mock('../../../config/featureFlags', () => ({ get featureFlags() { return mockFlags; } }));

let mockUser: { id: string; email: string; role: string; coach_id?: string } = { id: 'c1', email: 'c1@example.test', role: 'client' };
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../../../lib/userCache', () => ({ ...jest.requireActual('../../../lib/userCache'), readUserCacheSync: () => null }));

const mockNavigate = jest.fn();
const mockParentNavigate = jest.fn();
const mockNavigation = { navigate: mockNavigate, setParams: jest.fn(), getParent: () => ({ navigate: mockParentNavigate }) };
jest.mock('@react-navigation/native', () => {
  const ReactLib = jest.requireActual('react');
  return {
    NavigationContext: require('react').createContext(undefined),
    useNavigation: () => mockNavigation,
    useRoute: () => ({ params: {} }),
    useFocusEffect: (cb: () => undefined | (() => void)) => {
      ReactLib.useEffect(() => {
        const cleanup = cb();
        return typeof cleanup === 'function' ? cleanup : undefined;
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
    },
  };
});
const mockGetRoutines = jest.fn(async () => ({ data: [] as unknown[] }));
let mockHistory: unknown[] = [];
jest.mock('../../../services/api', () => ({
  workoutApi: {
    getRoutines: () => mockGetRoutines(),
    getAll: async () => ({ data: mockHistory }),
    getVolume: async () => ({ data: [] }),
    deleteWorkout: jest.fn(async () => ({})),
  },
}));
const mockRefetch = jest.fn(async () => ({}));
let mockQuery: { data?: unknown[]; isLoading?: boolean; isError?: boolean } = {};
jest.mock('../../../hooks/useWorkoutBuilder', () => ({ useMyWorkoutAssignments: () => ({ ...mockQuery, refetch: mockRefetch }) }));
// The coaches read: records every call's switch, so a client with no coach is proved never to switch it on.
let mockCoaches: Array<{ coach_id: string; name: string }> | undefined = [{ coach_id: 'coach', name: 'Sam Rivera' }];
const mockCoachesOn: boolean[] = [];
jest.mock('../../../hooks/useCalendar', () => ({
  useMyCoaches: (on: boolean) => { mockCoachesOn.push(on); return { data: on ? mockCoaches : undefined }; },
}));
// The closed-chat hook (FR-880R2/R3), its answer set per case and every call recorded.
let mockChat = { closed: false, known: true };
const mockChatCalls: Array<string | null | undefined> = [];
jest.mock('../../../hooks/useCoachChatClosed', () => ({
  useCoachChatClosed: (coachId: string | null | undefined) => { mockChatCalls.push(coachId); return mockChat; },
}));
let mockNames: { names: Record<string, string>; loading: boolean } = { names: {}, loading: false };
jest.mock('../../../hooks/useExerciseNames', () => ({ useExerciseNames: () => mockNames }));
const mockLoadSession = jest.fn();
jest.mock('../../../storage/activeWorkoutSession', () => ({ loadActiveWorkoutSession: (...a: unknown[]) => mockLoadSession(...a) }));
jest.mock('../../../components/workout/WorkoutSyncCards', () => () => null);
jest.mock('../../../components/workout/RefusedWorkoutCard', () => () => null);
jest.mock('@expo-google-fonts/cormorant-garamond', () => ({ CormorantGaramond_400Regular_Italic: 1, useFonts: () => [true] }));
jest.mock('../../../components/tutorial/PlanExplanationCard', () => () => null);

// Every text the three "nothing yet" parts can draw, collected on every render (case 7: none may flash).
const mockSeen: string[] = [];
const mockCollect = (node: unknown): void => {
  if (typeof node === 'string') { mockSeen.push(node); return; }
  if (Array.isArray(node)) { node.forEach(mockCollect); return; }
  const props = (node as { props?: { children?: unknown; headline?: unknown; body?: unknown } } | null)?.props;
  if (!props) return;
  if (typeof props.headline === 'string') mockSeen.push(props.headline);
  if (typeof props.body === 'string') mockSeen.push(props.body);
  mockCollect(props.children);
};
jest.mock('../../../components/FadeInView', () => ({ children }: { children: React.ReactNode }) => { mockCollect(children); return children; });
jest.mock('../../../ui/sections/QuietSection', () => {
  const actual = jest.requireActual('../../../ui/sections/QuietSection');
  const ReactLib = jest.requireActual('react');
  return { ...actual, QuietOverline: (p: { children?: unknown }) => { mockCollect(p.children); return ReactLib.createElement(actual.QuietOverline, p); } };
});
jest.mock('../../../ui/empty-states', () => {
  const actual = jest.requireActual('../../../ui/empty-states');
  const ReactLib = jest.requireActual('react');
  return { ...actual, EmptyStateNoData: (p: { headline?: string; body?: string }) => { mockCollect({ props: p }); return ReactLib.createElement(actual.EmptyStateNoData, p); } };
});

import WorkoutScreen from '../WorkoutScreen';
import { messageCoachLabel } from '../../../components/home/HomeHeaderActions';

const today = getTodayString();
const at = (day: string) => `${day}T12:00:00`;
const COACHED = { id: 'c1', email: 'c1@example.test', role: 'client', coach_id: 'coach' };
const SOLO = { id: 'c1', email: 'c1@example.test', role: 'client' };
const CARD = 'Sam is building your first plan. You can log a session of your own at any time.';
const CARD_NO_NAME = 'Your coach is building your first plan. You can log a session of your own at any time.';
const LINE = 'When Sam sends a plan, each day shows here with what to lift and why.';
const NOTHING_YET = ['Recent workouts', 'No recent workouts', 'Complete workouts to see volume data', 'Log a workout to see muscle breakdown'];
const open = {
  id: 'a1', workout_plan_id: 'p1', client_id: 'c1', assigned_by_coach_id: 'coach', scheduled_for: at(today), completed_at: null,
  post_rpe: null, post_notes: null, snapshot_source: true, snapshot: { plan_name: 'Full body A', plan_type: 'strength' },
  workout_plan: { id: 'p1', name: 'Full body A', type: 'strength', duration_estimate_minutes: 55, exercises: [] },
  exercises: [{ exercise_external_id: 'squat', order: 1, sets: 4, reps_or_duration_seconds: 5, weight_lbs: 185, rest_seconds: 90, superset_group_id: null, notes: null }],
};
const done = { ...open, id: 'a0', completed_at: at(today) };
const saved = { id: 's1', workout_name: 'Leg day', started_at: at(today), completed_at: at(today), duration_minutes: 40, exercises: [] };

function forestButtons(view: { toJSON: () => unknown }): string[] {
  const found: string[] = [];
  const step = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(step); return; }
    const n = node as { props?: Record<string, unknown>; children?: unknown[] };
    const style = StyleSheet.flatten(n.props?.style as StyleProp<ViewStyle>);
    if (n.props?.accessibilityRole === 'button' && style?.backgroundColor === lightTokens.accent) found.push(String(n.props.accessibilityLabel));
    (n.children ?? []).forEach(step);
  };
  step(view.toJSON());
  return found;
}

/** Every text and every accessibility label in the tree, top to bottom. */
function words(view: { toJSON: () => unknown }): string[] {
  const seen: string[] = [];
  const step = (node: unknown): void => {
    if (typeof node === 'string') { seen.push(node); return; }
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(step); return; }
    const n = node as { props?: Record<string, unknown>; children?: unknown[] };
    for (const k of ['accessibilityLabel', 'accessibilityHint']) if (typeof n.props?.[k] === 'string') seen.push(n.props[k] as string);
    (n.children ?? []).forEach(step);
  };
  step(view.toJSON());
  return seen;
}

const firstDay = async () => {
  const view = await render(<WorkoutScreen />);
  await waitFor(() => expect(view.getByText('Nothing planned yet.')).toBeTruthy());
  await waitFor(() => expect(view.getByText('My routines')).toBeTruthy());
  return view;
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));
  jest.spyOn(HapticService, 'mediumImpact').mockResolvedValue(undefined);
  mockFlags.clientTrainV2 = true;
  mockUser = { ...COACHED };
  mockQuery = { data: [] };
  mockHistory = [];
  mockCoaches = [{ coach_id: 'coach', name: 'Sam Rivera' }];
  mockCoachesOn.length = 0;
  mockChat = { closed: false, known: true };
  mockChatCalls.length = 0;
  mockSeen.length = 0;
  mockNames = { names: { squat: 'Back squat' }, loading: false };
  mockLoadSession.mockResolvedValue(null);
});

describe('WORKOUT-STATES-M: the first day on Train (C2_first)', () => {
  it('1. first day with a coach: the card, the title, the line, Quick workout, Message Sam, My routines; no "nothing yet" lines', async () => {
    const view = await firstDay();
    const card = view.getByTestId('train-first-card');
    expect(within(card).getByText(CARD)).toBeTruthy();
    expect(card.props.accessible).toBe(true);
    expect(card.props.accessibilityLabel).toBe(CARD);
    // The avatar's letter is there, and hidden from screen readers.
    expect(within(card).getByText('S', { includeHiddenElements: true })).toBeTruthy();
    expect(within(card).queryByText('S', { includeHiddenElements: false })).toBeNull();
    const order = words(view);
    const want = [CARD, 'Nothing planned yet.', LINE, 'Quick workout', 'Start an empty session', 'Message Sam', 'My routines'];
    const pos = want.map((w) => order.indexOf(w));
    expect(pos.every((i) => i >= 0)).toBe(true);
    expect([...pos].sort((a, b) => a - b)).toEqual(pos);
    expect(forestButtons(view)).toEqual(['Quick workout']);
    expect(view.getByText('No routines yet')).toBeTruthy();
    const create = view.getAllByLabelText('Create a routine');
    await fireEvent.press(create[create.length - 1]);
    expect(mockNavigate).toHaveBeenLastCalledWith('RoutineBuilder');
    for (const t of NOTHING_YET) expect(view.queryByText(t)).toBeNull();
  });

  it('2. Message Sam is a button at least 44 pt tall that opens the coaching chat as You does', async () => {
    const view = await firstDay();
    const link = view.getByRole('button', { name: 'Message Sam' });
    const style = StyleSheet.flatten(link.props.style as StyleProp<ViewStyle>);
    expect(Number(style.minHeight)).toBeGreaterThanOrEqual(44);
    expect(mockChatCalls.every((id) => id === 'coach')).toBe(true);
    await fireEvent.press(link);
    expect(mockParentNavigate).toHaveBeenCalledTimes(1);
    expect(mockParentNavigate).toHaveBeenCalledWith('Home', { screen: 'Messages', initial: false });
    expect(messageCoachLabel('Sam Rivera')).toBe('Message Sam');
  });

  const CHAT = [
    ['the answer is not known yet', { closed: false, known: false }, false],
    ['the chat is known closed (either person blocks)', { closed: true, known: true }, false],
    ['the chat is known open', { closed: false, known: true }, true],
  ] as const;
  it.each(CHAT)('3. %s: the link', async (_name, chat, shown) => {
    mockChat = { ...chat };
    const view = await firstDay();
    if (shown) expect(view.getByText('Message Sam')).toBeTruthy();
    else expect(view.queryByText(/^Message /)).toBeNull();
  });

  it.each(CHAT)('3c. %s: the card and the line stay', async (_name, chat) => {
    mockChat = { ...chat };
    const view = await firstDay();
    expect(view.getByTestId('train-first-card')).toBeTruthy();
    expect(view.getByText(LINE)).toBeTruthy();
  });

  it('4. before the coach\'s name loads: "Your coach is building...", no avatar, "Message your coach"', async () => {
    mockCoaches = undefined;
    const view = await firstDay();
    const card = view.getByTestId('train-first-card');
    expect(within(card).getByText(CARD_NO_NAME)).toBeTruthy();
    expect(within(card).queryByText(/^[A-Z]$/, { includeHiddenElements: true })).toBeNull();
    expect(view.getByText('When your coach sends a plan, each day shows here with what to lift and why.')).toBeTruthy();
    expect(view.getByText('Message your coach')).toBeTruthy();
    expect(messageCoachLabel(null)).toBe('Message your coach');
  });

  it('5a. no coach: "Your plan", no card, line, link or Coach guidelines, no coach read, no coach name or word', async () => {
    mockUser = { ...SOLO };
    const view = await firstDay();
    expect(view.getByText('Your plan')).toBeTruthy();
    expect(view.queryByTestId('train-first-card')).toBeNull();
    expect(view.queryByText(/sends a plan/)).toBeNull();
    expect(view.queryByText(/^Message /)).toBeNull();
    expect(view.queryByLabelText('Coach guidelines')).toBeNull();
    expect(mockCoachesOn.length).toBeGreaterThan(0);
    expect(mockCoachesOn.every((on) => on === false)).toBe(true);
    expect(mockChatCalls.filter(Boolean)).toEqual([]);
    const all = words(view);
    expect(all.filter((w) => /Sam|Rivera/.test(w))).toEqual([]);
    expect(all.filter((w) => /coach/i.test(w))).toEqual([]);
    expect(view.getByText('My routines')).toBeTruthy();
    expect(view.getAllByLabelText('Create a routine').length).toBeGreaterThan(0);
    await fireEvent.press(view.getByLabelText('Quick workout'));
    expect(mockNavigate).toHaveBeenLastCalledWith('ActiveWorkout', { routineName: 'Quick Workout', exercises: '[]' });
  });

  it('5b. no coach: the first day leaves off the three "nothing yet" lines too', async () => {
    mockUser = { ...SOLO };
    const view = await firstDay();
    for (const t of NOTHING_YET) expect(view.queryByText(t)).toBeNull();
  });

  it('6a. saved workouts and no coach workout: the card, the line and the link, and Recent workouts with her rows', async () => {
    mockHistory = [saved];
    const view = await firstDay();
    await waitFor(() => expect(view.getByText('Leg day')).toBeTruthy());
    expect(view.getByTestId('train-first-card')).toBeTruthy();
    expect(view.getByText(LINE)).toBeTruthy();
    expect(view.getByText('Message Sam')).toBeTruthy();
    expect(view.getByText('Recent workouts')).toBeTruthy();
    expect(view.queryByText('No recent workouts')).toBeNull();
  });

  it('6b. one open coach workout and no saved workout: no card, no link, the "nothing yet" lines as on main', async () => {
    mockQuery = { data: [open] };
    const view = await render(<WorkoutScreen />);
    await waitFor(() => expect(view.getByText('Full body A')).toBeTruthy());
    await waitFor(() => expect(view.getByText('No recent workouts')).toBeTruthy());
    expect(view.queryByTestId('train-first-card')).toBeNull();
    expect(view.queryByText(/^Message /)).toBeNull();
    for (const t of NOTHING_YET) expect(view.getByText(t)).toBeTruthy();
    expect(mockChatCalls).toEqual([]);
  });

  it('6c. H6: the coach\'s first workout arrives while she is away: on the next read the card and the link leave', async () => {
    const view = await firstDay();
    expect(view.getByTestId('train-first-card')).toBeTruthy();
    expect(view.getByText('Message Sam')).toBeTruthy();
    mockQuery = { data: [open] };
    await view.rerender(<WorkoutScreen />);
    await waitFor(() => expect(view.getByText('Full body A')).toBeTruthy());
    expect(view.queryByTestId('train-first-card')).toBeNull();
    expect(view.queryByText(/^Message /)).toBeNull();
    expect(view.queryByText('Nothing planned yet.')).toBeNull();
    for (const t of NOTHING_YET) expect(view.getByText(t)).toBeTruthy();
  });

  it('7. no flash: while the coach read loads, the "nothing yet" lines never draw; settled with a workout they appear', async () => {
    mockQuery = { isLoading: true };
    const view = await render(<WorkoutScreen />);
    await waitFor(() => expect(view.getByText('My routines')).toBeTruthy());
    expect(view.getByTestId('train-day-loading')).toBeTruthy();
    for (const t of NOTHING_YET) expect(view.queryByText(t)).toBeNull();
    mockQuery = { data: [] };
    await view.rerender(<WorkoutScreen />);
    await waitFor(() => expect(view.getByTestId('train-first-card')).toBeTruthy());
    for (const t of NOTHING_YET) expect(view.queryByText(t)).toBeNull();
    expect(mockSeen.filter((t) => NOTHING_YET.includes(t))).toEqual([]);
    await view.unmount();

    mockQuery = { isLoading: true };
    const second = await render(<WorkoutScreen />);
    await waitFor(() => expect(second.getByText('My routines')).toBeTruthy());
    for (const t of NOTHING_YET) expect(second.queryByText(t)).toBeNull();
    mockQuery = { data: [open] };
    await second.rerender(<WorkoutScreen />);
    await waitFor(() => expect(second.getByText('Full body A')).toBeTruthy());
    for (const t of NOTHING_YET) expect(second.getByText(t)).toBeTruthy();
  });

  it('8a. the coach read failed with nothing kept: main\'s line and Try again, no card, no link, the lines as on main', async () => {
    mockQuery = { isError: true };
    const view = await render(<WorkoutScreen />);
    await waitFor(() => expect(view.getByText('This workout did not load.')).toBeTruthy());
    expect(view.getByTestId('train-retry')).toBeTruthy();
    expect(view.queryByTestId('train-first-card')).toBeNull();
    expect(view.queryByText(/^Message /)).toBeNull();
    await waitFor(() => expect(view.getByText('No recent workouts')).toBeTruthy());
    for (const t of NOTHING_YET) expect(view.getByText(t)).toBeTruthy();
  });

  it('8b. the routines read failed with an empty coach read: the card, title and line; no link; main\'s failure and Try again', async () => {
    mockGetRoutines.mockRejectedValueOnce(new Error('offline'));
    const view = await render(<WorkoutScreen />);
    await waitFor(() => expect(view.getByText('Your routines and history did not load. Check the connection, then try again.')).toBeTruthy());
    expect(view.getByTestId('train-first-card')).toBeTruthy();
    expect(view.getByText('Nothing planned yet.')).toBeTruthy();
    expect(view.getByText(LINE)).toBeTruthy();
    expect(view.queryByText(/^Message /)).toBeNull();
    expect(view.getAllByLabelText('Try again').length).toBeGreaterThan(0);
    expect(view.queryByText('No routines yet')).toBeNull();
  });

  it('9. every coach workout done: no card, no link', async () => {
    mockQuery = { data: [done] };
    const view = await render(<WorkoutScreen />);
    await waitFor(() => expect(view.getByText('My routines')).toBeTruthy());
    expect(view.queryByTestId('train-first-card')).toBeNull();
    expect(view.queryByText('Nothing planned yet.')).toBeNull();
    expect(view.queryByText(/^Message /)).toBeNull();
    expect(mockChatCalls).toEqual([]);
  });

  it('10. switch off: no card, no link, and the "nothing yet" lines as on main', async () => {
    mockFlags.clientTrainV2 = false;
    const view = await render(<WorkoutScreen />);
    await waitFor(() => expect(view.getByText('No recent workouts')).toBeTruthy());
    expect(view.queryByTestId('train-first-card')).toBeNull();
    expect(view.queryByText(/^Message /)).toBeNull();
    for (const t of NOTHING_YET) expect(view.getByText(t)).toBeTruthy();
    expect(mockChatCalls).toEqual([]);
  });

  it('11. 320 x 568 at 130%: the sentence and the link are never cut or capped, and the link is at least 44 pt', async () => {
    const dims = jest.spyOn(Dimensions, 'get').mockReturnValue({ width: 320, height: 568, scale: 2, fontScale: 1.3 });
    const font = jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(1.3);
    try {
      const view = await firstDay();
      const sentence = within(view.getByTestId('train-first-card')).getByText(CARD);
      expect(sentence.props.numberOfLines).toBeUndefined();
      expect(sentence.props.maxFontSizeMultiplier).toBeUndefined();
      const link = view.getByRole('button', { name: 'Message Sam' });
      expect(within(link).getByText('Message Sam').props.numberOfLines).toBeUndefined();
      expect(Number(StyleSheet.flatten(link.props.style as StyleProp<ViewStyle>).minHeight)).toBeGreaterThanOrEqual(44);
    } finally {
      dims.mockRestore();
      font.mockRestore();
    }
  });
});

describe('WORKOUT-STATES-M: guards on the three product files', () => {
  const read = (rel: string) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  // schemePanels994.test.tsx:251's census pattern, rebuilt here without the family's bare name in this file.
  const pale = new RegExp(
    [
      'success\\.bg', 'successBg', 'feedbackSuccessBg', `(^|[^A-Za-z])${['sa', 'ge'].join('')}([^A-Za-z]|$)`,
      `(^|[^A-Za-z])${['sa', 'ge'].join('')}Line([^A-Za-z]|$)`, 'brand\\[50\\]', 'primaryPale',
      ['e0', 'eb', 'e4'].join(''), ['c9', 'd8', 'cd'].join(''), ['d6', 'e4', 'da'].join(''),
      'rgba?\\(\\s*224[,\\s]+235[,\\s]+228', 'rgba?\\(\\s*201[,\\s]+216[,\\s]+205', 'rgba?\\(\\s*214[,\\s]+228[,\\s]+218',
    ].join('|'),
    'i',
  );
  it.each(['train/TrainToday.tsx', 'WorkoutScreen.tsx', 'train/TrainMessageCoach.tsx'])('12. %s: no colour literal, no pale green name', (rel) => {
    const src = read(rel);
    expect(src.match(/['"`]#[0-9a-fA-F]{3,8}['"`]/g)).toBeNull();
    expect(src.match(/rgba?\(/g)).toBeNull();
    expect(src.split('\n').filter((l) => pale.test(l))).toEqual([]);
  });

  it('12. TrainMessageCoach.tsx names no font face and reads the one closed-chat hook and the one label', () => {
    const src = read('train/TrainMessageCoach.tsx');
    expect(src).not.toMatch(/fontFamily|CormorantGaramond|Inter_/);
    expect(src).toMatch(/useCoachChatClosed\(/);
    expect(src).toMatch(/messageCoachLabel\(/);
  });

  it('12. the first card is the scheme\'s cream card, and the note card\'s pinned line is unchanged', () => {
    const src = read('train/TrainToday.tsx');
    expect(src).toContain('[s.card, schemeCard]} testID="train-first-card"');
    expect(src).toContain('[s.card, schemeCard]} testID="train-coach-note"');
  });
});
