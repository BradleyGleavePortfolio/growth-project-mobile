/**
 * FIX-WRD-1 (growth-project-mobile#1023, LS-WRD-1 B1): the refused-workout card and its sheet offer "Tell <coach>" only
 * while the app knows the coaching chat is open (hooks/useCoachChatClosed: known and not closed), as Home's and You's
 * "Message <coach>" do (FR-880R2 and FR-880R3, owner 10-23 "Dissapear"). Everything else on the card stays as it was.
 *
 * Beside the B-TEST (LSWRD1.B1.tellClosedChat.btest.test.tsx), with the same stand-ins: the engine, the signed-in
 * person (c1, coach k1), the coaches (Sam Rivera), haptics, insets, navigation and services/api for the client's own
 * thread read (GET /messages?limit=1, its `x-conversation-closed` header). The card, the block list saved on the phone
 * (blockedUsersStore) and useCoachChatClosed are the real ones. Made-up people only.
 */
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import type { RefusedWorkout } from '../../../offline/sync/sync-engine';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
const mockList = jest.fn(async (..._a: unknown[]): Promise<RefusedWorkout[]> => []);
jest.mock('../../../offline/sync/sync-engine', () => {
  const { EventEmitter } = jest.requireActual('events');
  return {
    listRefusedWorkouts: (...a: unknown[]) => mockList(...a),
    sendRefusedWorkoutAgain: jest.fn(async () => 'sent'),
    removeRefusedWorkout: jest.fn(async () => undefined),
    deadLetterEvents: new EventEmitter(),
    workoutSyncEvents: new EventEmitter(),
  };
});
let mockCoachless = false;
jest.mock('../../../hooks/useCoachlessClient', () => ({ useCoachlessClient: () => mockCoachless }));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'c1', coach_id: 'k1' }) }));
jest.mock('../../../lib/userCache', () => ({ readUserCacheSync: () => null }));
jest.mock('../../../hooks/useCalendar', () => ({ useMyCoaches: () => ({ data: [{ coach_id: 'k1', name: 'Sam Rivera' }] }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 34, left: 0, right: 0 }) }));
jest.mock('../../../ui/haptics/haptics.service', () => ({ HapticService: { error: jest.fn(), success: jest.fn() } }));
const mockGet = jest.fn();
jest.mock('../../../services/api', () => ({ __esModule: true, default: { get: (...a: unknown[]) => mockGet(...a) } }));
jest.mock('../../../services/queryClient', () => {
  const { QueryClient } = jest.requireActual('@tanstack/react-query');
  return { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) };
});
jest.mock('@react-navigation/native', () => {
  const ReactLib = jest.requireActual('react');
  return {
    useNavigation: () => ({ navigate: jest.fn(), getParent: () => ({ navigate: jest.fn() }) }),
    useFocusEffect: (cb: () => void) => ReactLib.useEffect(() => { cb(); }, [cb]),
  };
});

import RefusedWorkoutCard, { REFUSAL_COPY, refusedView } from '../RefusedWorkoutCard';
import { COACH_CHAT_KEY } from '../../../hooks/useCoachChatClosed';
import { useBlockedUsersStore } from '../../../store/blockedUsersStore';
import { queryClient } from '../../../services/queryClient';

const READ = '/messages?limit=1';
const body = (name: string, date: string) => ({
  date, workout_name: name, workout_type: 'strength', duration_minutes: 48, notes: '',
  exercises: [{ exercise_name: 'Bench press', sets_completed: 3, reps_per_set: [8, 8, 8], weight_per_set: [145, 145, 145] }],
});
const invalid = (id = 'a'): RefusedWorkout => ({
  id, body: body('Upper body B', '2026-10-10'),
  refusal: { status: 400, code: 'WORKOUT_INVALID', said: 'property surprise should not exist', nextStep: 'If an app update is waiting, install it, then send it again.' },
});
const gone = (): RefusedWorkout => ({
  id: 'g', body: body('Legs C', '2026-10-11'),
  refusal: { status: 404, code: 'WORKOUT_NOT_FOUND', said: 'Workout not found', nextStep: 'This workout is no longer in your history. Remove it from this phone.' },
});
const blockK1 = { id: 'k1', displayName: 'Sam', blockedAt: '2026-10-24T00:00:00Z' };

// The client's own thread read: closed carries the header (b#1141), open carries none; `held` keeps it out until answered.
const thread: { closed: boolean; held: null | ((closed: boolean) => void) } = { closed: false, held: null };
const answer = (closed: boolean) => ({ data: [], headers: closed ? { 'x-conversation-closed': 'blocked_by_them' } : {} });

beforeEach(() => {
  jest.clearAllMocks();
  mockCoachless = false;
  thread.closed = false;
  thread.held = null;
  queryClient.clear();
  // A cold phone: the saved block list is read again by the gate on mount.
  useBlockedUsersStore.setState({ blocked: [], hydrated: false, userId: null });
  mockList.mockResolvedValue([invalid()]);
  mockGet.mockImplementation(async (u: unknown) => (u === READ ? answer(thread.closed) : { data: {} }));
});
afterEach(() => act(async () => { useBlockedUsersStore.setState({ blocked: [] }); }));

/** Lets the saved list and the thread read settle (each answers at once here unless held). */
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 50)); });
const reads = () => mockGet.mock.calls.filter(([u]) => u === READ).length;
const cardLabels = (view: Awaited<ReturnType<typeof render>>) =>
  view.getAllByRole('button').map((b) => b.props.accessibilityLabel);

async function show(items = [invalid()]) {
  mockList.mockResolvedValue(items);
  const view = await render(<RefusedWorkoutCard />);
  expect(await view.findByTestId('refused-workouts')).toBeTruthy();
  return view;
}

describe('FIX-WRD-1: Tell <coach> on the refused-workout card only while the coaching chat is known open', () => {
  it('b. the read not answered yet: no Tell on the card or the sheet; answered open, Tell on both', async () => {
    mockGet.mockImplementation((u: unknown) => (u === READ
      ? new Promise((resolve) => { thread.held = (closed) => resolve(answer(closed)); })
      : Promise.resolve({ data: {} })));
    const view = await show();
    await settle();
    expect(view.queryByTestId('refused-card-tell')).toBeNull();
    await act(async () => { fireEvent.press(view.getByTestId('refused-card-open')); });
    expect(view.getByTestId('refused-sheet')).toBeTruthy();
    expect(view.queryByTestId('refused-sheet-tell')).toBeNull();
    expect(thread.held).not.toBeNull();
    await act(async () => { thread.held!(false); });
    await settle();
    expect(view.getByTestId('refused-sheet-tell')).toBeTruthy();
    expect(view.getByTestId('refused-card-tell')).toBeTruthy();
  });

  it('b. the read not answered yet, then answered closed: Tell never shows', async () => {
    mockGet.mockImplementation((u: unknown) => (u === READ
      ? new Promise((resolve) => { thread.held = (closed) => resolve(answer(closed)); })
      : Promise.resolve({ data: {} })));
    const view = await show();
    await settle();
    expect(view.queryByTestId('refused-card-tell')).toBeNull();
    await act(async () => { thread.held!(true); });
    await settle();
    expect(view.queryByTestId('refused-card-tell')).toBeNull();
    await act(async () => { fireEvent.press(view.getByTestId('refused-card-open')); });
    expect(view.queryByTestId('refused-sheet-tell')).toBeNull();
  });

  it('b. Home already read the chat open (the same query, the saved list read): Tell on the card\'s first render', async () => {
    await act(async () => { await useBlockedUsersStore.getState().hydrate('c1'); });
    queryClient.setQueryData([...COACH_CHAT_KEY, 'k1'], false);
    mockGet.mockImplementation((u: unknown) => (u === READ ? new Promise(() => undefined) : Promise.resolve({ data: {} })));
    const view = await show();
    expect(view.getByTestId('refused-card-tell')).toBeTruthy();
  });

  it('c. the chat closed, WORKOUT_INVALID: the card shows Send again alone; the sheet keeps its lede, Send again, Remove and the footnote', async () => {
    thread.closed = true;
    const view = await show();
    await settle();
    const v = refusedView(invalid().body);
    expect(cardLabels(view)).toEqual([REFUSAL_COPY.label(v.name, v.longDate), 'Send again']);
    expect(reads()).toBeGreaterThan(0);
    await act(async () => { fireEvent.press(view.getByTestId('refused-card-open')); });
    expect(view.getByText(REFUSAL_COPY.why('Sam'))).toBeTruthy();
    expect(view.getByTestId('refused-sheet-send')).toBeTruthy();
    expect(view.getByText('Remove from this phone')).toBeTruthy();
    expect(view.getByText(REFUSAL_COPY.stays)).toBeTruthy();
    expect(view.queryByTestId('refused-sheet-tell')).toBeNull();
    expect(view.queryByText('Tell Sam')).toBeNull();
  });

  it('c. the chat closed, WORKOUT_NOT_FOUND: the card shows See workout alone', async () => {
    thread.closed = true;
    const view = await show([gone()]);
    await settle();
    const v = refusedView(gone().body);
    expect(cardLabels(view)).toEqual([REFUSAL_COPY.label(v.name, v.longDate), 'See workout']);
  });

  it('d. she blocks her coach while the card shows: Tell goes in that render; she unblocks: Tell comes back', async () => {
    const view = await show();
    await settle();
    expect(view.getByTestId('refused-card-tell')).toBeTruthy();
    await act(async () => { useBlockedUsersStore.setState({ blocked: [blockK1] }); });
    expect(view.queryByTestId('refused-card-tell')).toBeNull();
    await act(async () => { useBlockedUsersStore.setState({ blocked: [] }); });
    expect(view.getByTestId('refused-card-tell')).toBeTruthy();
  });

  it('e. a coachless client: no coaching-chat read; Send again and See workout as before (s2_R2)', async () => {
    mockCoachless = true;
    const view = await show();
    await settle();
    const v = refusedView(invalid().body);
    expect(cardLabels(view)).toEqual([REFUSAL_COPY.label(v.name, v.longDate), 'Send again', 'See workout']);
    expect(reads()).toBe(0);
  });

  it('f. no refused workout: nothing shows and no coaching-chat read starts', async () => {
    mockList.mockResolvedValue([]);
    const view = await render(<RefusedWorkoutCard />);
    await settle();
    expect(mockList).toHaveBeenCalledWith('c1');
    expect(view.queryByTestId('refused-workouts')).toBeNull();
    expect(reads()).toBe(0);
  });

  it('g. two refused with the chat closed: the count card as before; after See both, neither card offers Tell', async () => {
    thread.closed = true;
    const view = await show([invalid('a'), gone()]);
    await settle();
    expect(view.getByText('2 workouts not saved')).toBeTruthy();
    expect(view.getByText('Upper body B, Sat 10 Oct')).toBeTruthy();
    expect(view.getByText('Legs C, Sun 11 Oct')).toBeTruthy();
    await act(async () => { fireEvent.press(view.getByText('See both')); });
    expect(view.getAllByText('Workout not saved')).toHaveLength(2);
    expect(view.queryAllByTestId('refused-card-tell')).toHaveLength(0);
    expect(view.queryByText('Tell Sam')).toBeNull();
  });
});
