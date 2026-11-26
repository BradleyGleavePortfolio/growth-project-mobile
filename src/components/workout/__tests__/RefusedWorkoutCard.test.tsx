/**
 * WORKOUT-REFUSAL-M (203-P1 Style 2, GOAL ctx#579 s2_R1 to s2_R5b): the card on the Train tab and its sheet, for
 * every refused state: one coached, one coachless, the workout gone from the server, two, a resend refused again,
 * no answer, sent, removed. The engine is faked; its own rules are in src/__tests__/workoutRefusalM.engine.test.ts.
 */
import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import type { RefusedWorkout } from '../../../offline/sync/sync-engine';

const mockList = jest.fn(async (..._a: unknown[]): Promise<RefusedWorkout[]> => []);
const mockSend = jest.fn(async (..._a: unknown[]) => 'sent');
const mockRemove = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('../../../offline/sync/sync-engine', () => {
  const { EventEmitter } = jest.requireActual('events');
  return {
    listRefusedWorkouts: (...a: unknown[]) => mockList(...a),
    sendRefusedWorkoutAgain: (...a: unknown[]) => mockSend(...a),
    removeRefusedWorkout: (...a: unknown[]) => mockRemove(...a),
    deadLetterEvents: new EventEmitter(),
    workoutSyncEvents: new EventEmitter(),
  };
});
let mockCoachless = false;
jest.mock('../../../hooks/useCoachlessClient', () => ({ useCoachlessClient: () => mockCoachless }));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'c1', coach_id: 'k1' }) }));
jest.mock('../../../hooks/useCalendar', () => ({ useMyCoaches: () => ({ data: [{ coach_id: 'k1', name: 'Sam Rivera' }] }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 34, left: 0, right: 0 }) }));
jest.mock('../../../ui/haptics/haptics.service', () => ({ HapticService: { error: jest.fn(), success: jest.fn() } }));
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => {
  const ReactLib = jest.requireActual('react');
  return {
    useNavigation: () => ({ navigate: mockNavigate }),
    useFocusEffect: (cb: () => void) => ReactLib.useEffect(() => { cb(); }, [cb]),
  };
});

import RefusedWorkoutCard, { refusedView } from '../RefusedWorkoutCard';

const W2 = 'If an app update is waiting, install it, then send it again.';
const W3 = 'This workout is no longer in your history. Remove it from this phone.';
const body = (name: string, date: string) => ({
  date, workout_name: name, workout_type: 'strength', duration_minutes: 48, notes: '',
  exercises: [
    { exercise_name: 'Bench press', sets_completed: 3, reps_per_set: [8, 8, 8], weight_per_set: [145, 145, 145] },
    { exercise_name: 'Pull-up', sets_completed: 3, reps_per_set: [6, 6, 6], weight_per_set: [0, 0, 0] },
    { exercise_name: 'Row', sets_completed: 2, reps_per_set: [8, 6], weight_per_set: [135, 135] },
  ],
});
const invalid = (id = 'a', name = 'Upper body B', date = '2026-10-10'): RefusedWorkout => ({
  id, body: body(name, date), refusal: { status: 400, code: 'WORKOUT_INVALID', said: 'property surprise should not exist', nextStep: W2 },
});
const gone = (): RefusedWorkout => ({
  id: 'g', body: body('Legs C', '2026-10-11'), refusal: { status: 404, code: 'WORKOUT_NOT_FOUND', said: 'Workout not found', nextStep: W3 },
});

let alerts: Array<{ title: string; body?: string; buttons?: Array<{ text?: string; onPress?: () => void }> }> = [];
beforeEach(() => {
  jest.clearAllMocks();
  mockCoachless = false;
  alerts = [];
  jest.spyOn(Alert, 'alert').mockImplementation((title, msg, buttons) => {
    alerts.push({ title: String(title), body: msg, buttons: buttons as never });
  });
});

async function show(items: RefusedWorkout[]) {
  mockList.mockResolvedValue(items);
  const view = await render(<RefusedWorkoutCard />);
  await act(async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); });
  return view;
}

describe('refusedView: the stored body as the drawing writes it', () => {
  it('names the day, minutes, sets and one line per exercise', () => {
    const v = refusedView(body('Upper body B', '2026-10-10'));
    expect(v).toMatchObject({ name: 'Upper body B', date: 'Sat 10 Oct', longDate: 'Saturday 10 October', meta: 'Sat 10 Oct · 48 min · 8 sets' });
    expect(v.rows.map((r) => `${r.name} ${r.line}`)).toEqual(['Bench press 3 × 8 · 145 lb', 'Pull-up 3 × 6', 'Row 2 sets']);
    expect(refusedView({})).toMatchObject({ name: 'Workout', date: '', meta: '0 sets', rows: [] });
  });
});

describe('the card, every refused state', () => {
  it('shows nothing when no refusal carries a reason (the old server: today\'s behaviour)', async () => {
    const view = await show([]);
    expect(view.queryByTestId('refused-workouts')).toBeNull();
    expect(mockList).toHaveBeenCalledWith('c1');
  });

  it.each([
    ['s2_R1 coached, WORKOUT_INVALID', false, invalid(), ['Send again', 'Tell Sam'], '“property surprise should not exist”', W2],
    ['s2_R2 coachless, WORKOUT_INVALID', true, invalid(), ['Send again', 'See workout'], '“property surprise should not exist”', W2],
    ['coached, WORKOUT_NOT_FOUND: no Send again', false, gone(), ['See workout', 'Tell Sam'], '“Workout not found”', W3],
    ['coachless, WORKOUT_NOT_FOUND', true, gone(), ['See workout'], '“Workout not found”', W3],
  ])('%s', async (_name, coachless, item, buttons, said, next) => {
    mockCoachless = coachless;
    const view = await show([item]);
    expect(view.getByText('Workout not saved')).toBeTruthy();
    expect(view.getByText(`${item.body.workout_name} · ${refusedView(item.body).date}`)).toBeTruthy();
    expect(view.getByText(`The server said:\n${said}`)).toBeTruthy();
    expect(view.getByText(next)).toBeTruthy();
    const labels = view.getAllByRole('button').map((b) => b.props.accessibilityLabel);
    expect(labels).toEqual([`Workout not saved: ${item.body.workout_name}, ${refusedView(item.body).longDate}.`, ...buttons]);
    expect(view.getByTestId('refused-card-open').props.accessibilityHint).toBe('Opens the workout');
  });

  it('s2_R3: two read as one count card; See both shows each card', async () => {
    const view = await show([invalid('a'), gone()]);
    expect(view.getByText('2 workouts not saved')).toBeTruthy();
    expect(view.getByText('Upper body B, Sat 10 Oct')).toBeTruthy();
    expect(view.getByText('Legs C, Sun 11 Oct')).toBeTruthy();
    await act(async () => { fireEvent.press(view.getByText('See both')); });
    expect(view.getAllByText('Workout not saved')).toHaveLength(2);
  });

  it('three or more: See all', async () => {
    const view = await show([invalid('a'), invalid('b', 'Push', '2026-10-12'), gone()]);
    expect(view.getByText('3 workouts not saved')).toBeTruthy();
    expect(view.getByText('See all')).toBeTruthy();
  });

  it('s2_R4a: the card opens the sheet with the sets, the words and every action; the scrim closes it', async () => {
    const view = await show([invalid()]);
    await act(async () => { fireEvent.press(view.getByTestId('refused-card-open')); });
    expect(view.getByTestId('refused-sheet')).toBeTruthy();
    expect(view.getByText('Not saved')).toBeTruthy();
    expect(view.getByText('Sat 10 Oct · 48 min · 8 sets')).toBeTruthy();
    expect(view.getByText('The server did not accept this workout, so it is not in your history and Sam has not seen it.')).toBeTruthy();
    expect(view.getByText('3 × 8 · 145 lb')).toBeTruthy();
    expect(view.getByTestId('refused-sheet-send')).toBeTruthy();
    expect(view.getByTestId('refused-sheet-tell')).toBeTruthy();
    expect(view.getByText('Remove from this phone')).toBeTruthy();
    expect(view.getByText('It stays on this phone until you send it again or remove it. Signing out removes it.')).toBeTruthy();
    await act(async () => { fireEvent.press(view.getByTestId('refused-sheet-scrim', { includeHiddenElements: true })); });
    expect(view.queryByTestId('refused-sheet')).toBeNull();
  });

  it('a coachless sheet names no coach; a gone workout\'s sheet has no Send again', async () => {
    mockCoachless = true;
    const view = await show([gone()]);
    await act(async () => { fireEvent.press(view.getByTestId('refused-card-see')); });
    expect(view.getByText('The server did not accept this workout, so it is not in your history.')).toBeTruthy();
    expect(view.queryByTestId('refused-sheet-send')).toBeNull();
    expect(view.queryByTestId('refused-sheet-tell')).toBeNull();
  });

  it('s2_R4b: Send again refused again opens the sheet with "Not accepted again."', async () => {
    const view = await show([invalid()]);
    mockSend.mockResolvedValueOnce('dead_letter');
    await act(async () => { fireEvent.press(view.getByTestId('refused-card-send')); });
    expect(mockSend).toHaveBeenCalledWith('a', 'c1');
    expect(view.getByTestId('refused-sheet-again')).toBeTruthy();
    expect(view.getByText('Not accepted again.')).toBeTruthy();
  });

  it.each([
    ['s2_R5a sent: the card goes', 'sent'],
    ['no answer: the card goes and the waiting row counts it', 'kept'],
  ])('%s', async (_name, outcome) => {
    const view = await show([invalid()]);
    mockSend.mockResolvedValueOnce(outcome);
    mockList.mockResolvedValue([]);
    await act(async () => { fireEvent.press(view.getByTestId('refused-card-send')); });
    await waitFor(() => expect(view.queryByTestId('refused-workouts')).toBeNull());
  });

  it('Tell Sam opens the coach chat', async () => {
    const view = await show([invalid()]);
    await act(async () => { fireEvent.press(view.getByTestId('refused-card-tell')); });
    expect(mockNavigate).toHaveBeenCalledWith('Messages');
  });

  it('s2_R5b: Remove from this phone asks first; Cancel keeps it, Remove deletes that row only', async () => {
    const view = await show([invalid()]);
    await act(async () => { fireEvent.press(view.getByTestId('refused-card-open')); });
    await act(async () => { fireEvent.press(view.getByTestId('refused-sheet-remove')); });
    expect(alerts[0]).toMatchObject({
      title: 'Remove this workout?',
      body: 'Upper body B from Sat 10 Oct leaves this phone. It is not in your history, so it cannot be brought back.',
    });
    expect(alerts[0].buttons!.map((b) => b.text)).toEqual(['Cancel', 'Remove']);
    expect(mockRemove).not.toHaveBeenCalled();
    mockList.mockResolvedValue([]);
    await act(async () => { alerts[0].buttons![1].onPress!(); for (let i = 0; i < 4; i++) await Promise.resolve(); });
    expect(mockRemove).toHaveBeenCalledWith('a', 'c1');
    expect(view.queryByTestId('refused-workouts')).toBeNull();
  });
});
