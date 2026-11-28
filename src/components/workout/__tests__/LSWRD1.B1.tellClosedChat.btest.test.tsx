/**
 * LS-WRD-1 B1 (B-TEST, growth-project-mobile#1023 @ d00799ab): while the coaching chat is closed (either person's
 * block) the refused-workout card offers no "Tell <coach>", on the card or on its sheet.
 *
 * The app's rule (owner 10-23, FR-880R2 and FR-880R3; hooks/useCoachChatClosed): every client place that opens the
 * coach chat drops its coach action while the chat is closed, as Home's and You's "Message <coach>" do
 * (HomeHeaderActions.tsx, YouScreen.tsx). Tell <coach> opens that same chat (Home > Messages), where a closed chat
 * shows no messages and no box to type in (MessagesScreen.tsx), so the tap leads nowhere.
 *
 * The engine and the signed-in person are faked. The card, the block list saved on the phone (blockedUsersStore) and
 * the closed-chat read (GET /messages?limit=1 with its `x-conversation-closed` header) are the real ones, set up as
 * src/screens/client/__tests__/YouScreen.c9s1.test.tsx sets them up for You's button.
 */
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
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
jest.mock('../../../hooks/useCoachlessClient', () => ({ useCoachlessClient: () => false }));
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

import RefusedWorkoutCard from '../RefusedWorkoutCard';
import { useBlockedUsersStore } from '../../../store/blockedUsersStore';
import { queryClient } from '../../../services/queryClient';

const refused: RefusedWorkout = {
  id: 'a',
  body: {
    date: '2026-10-10', workout_name: 'Upper body B', workout_type: 'strength', duration_minutes: 48, notes: '',
    exercises: [{ exercise_name: 'Bench press', sets_completed: 3, reps_per_set: [8, 8, 8], weight_per_set: [145, 145, 145] }],
  },
  refusal: {
    status: 400, code: 'WORKOUT_INVALID', said: 'property surprise should not exist',
    nextStep: 'If an app update is waiting, install it, then send it again.',
  },
};

const thread = { closed: false };
beforeEach(() => {
  jest.clearAllMocks();
  thread.closed = false;
  queryClient.clear();
  mockList.mockResolvedValue([refused]);
  // The client's own coaching thread read: closed carries the header (b#1141), open carries none.
  mockGet.mockImplementation(async (u: unknown) =>
    u === '/messages?limit=1'
      ? { data: [], headers: thread.closed ? { 'x-conversation-closed': 'blocked_by_them' } : {} }
      : { data: {} });
});
afterEach(() => act(async () => { useBlockedUsersStore.setState({ blocked: [] }); }));

async function show() {
  const view = await render(<RefusedWorkoutCard />);
  expect(await view.findByTestId('refused-card-a')).toBeTruthy();
  return view;
}

describe('LS-WRD-1 B1: Tell <coach> follows the coaching chat', () => {
  it('control: with the chat open the card and its sheet offer Tell Sam', async () => {
    const view = await show();
    expect(await view.findByTestId('refused-card-tell')).toBeTruthy();
    expect(view.getByText('Tell Sam')).toBeTruthy();
    await fireEvent.press(view.getByTestId('refused-card-open'));
    expect(await view.findByTestId('refused-sheet-tell')).toBeTruthy();
  });

  it('my coach blocked me (the thread read says closed): no Tell <coach> on the card or its sheet', async () => {
    thread.closed = true;
    const view = await show();
    await waitFor(() => expect(view.queryByTestId('refused-card-tell')).toBeNull());
    expect(view.queryByText('Tell Sam')).toBeNull();
    await fireEvent.press(view.getByTestId('refused-card-open'));
    expect(await view.findByTestId('refused-sheet')).toBeTruthy();
    expect(view.queryByTestId('refused-sheet-tell')).toBeNull();
    // What still works stays: the workout can be sent again and removed.
    expect(view.getByTestId('refused-sheet-send')).toBeTruthy();
    expect(view.getByTestId('refused-sheet-remove')).toBeTruthy();
  });

  it('I blocked my coach (the block list on this phone): Tell <coach> leaves the card and its sheet at once', async () => {
    const view = await show();
    expect(await view.findByTestId('refused-card-tell')).toBeTruthy();
    await act(async () => {
      useBlockedUsersStore.setState({ blocked: [{ id: 'k1', displayName: 'Sam', blockedAt: '2026-10-24T00:00:00Z' }] });
    });
    expect(view.queryByTestId('refused-card-tell')).toBeNull();
    await fireEvent.press(view.getByTestId('refused-card-open'));
    expect(await view.findByTestId('refused-sheet')).toBeTruthy();
    expect(view.queryByTestId('refused-sheet-tell')).toBeNull();
  });
});
