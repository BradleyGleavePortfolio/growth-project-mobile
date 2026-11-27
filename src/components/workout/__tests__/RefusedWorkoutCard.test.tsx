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
const mockTabNavigate = jest.fn();
jest.mock('@react-navigation/native', () => {
  const ReactLib = jest.requireActual('react');
  return {
    // The card is on WorkoutMain (the Train stack); its parent is the client tab navigator.
    useNavigation: () => ({ navigate: mockNavigate, getParent: () => ({ navigate: mockTabNavigate }) }),
    useFocusEffect: (cb: () => void) => ReactLib.useEffect(() => { cb(); }, [cb]),
  };
});

import RefusedWorkoutCard, { refusedView } from '../RefusedWorkoutCard';
import { HapticService } from '../../../ui/haptics/haptics.service';

const W2 = 'If an app update is waiting, install it, then send it again.';
const W3 = 'This workout is no longer in your history. Remove it from this phone.';
const PLAIN = "Part of this workout couldn't be saved.";
const VALIDATION = /property|should not exist/;
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

  // OPERATOR RULING 7208809287 item 3: WORKOUT_INVALID reads the plain line, never the validation line; other codes
  // keep "The server said:" and the server's words.
  it.each([
    ['s2_R1 coached, WORKOUT_INVALID', false, invalid(), ['Send again', 'Tell Sam'], PLAIN, W2],
    ['s2_R2 coachless, WORKOUT_INVALID', true, invalid(), ['Send again', 'See workout'], PLAIN, W2],
    ['coached, WORKOUT_NOT_FOUND: no Send again', false, gone(), ['See workout', 'Tell Sam'], 'The server said:\n“Workout not found”', W3],
    ['coachless, WORKOUT_NOT_FOUND', true, gone(), ['See workout'], 'The server said:\n“Workout not found”', W3],
  ])('%s', async (_name, coachless, item, buttons, said, next) => {
    mockCoachless = coachless;
    const view = await show([item]);
    expect(view.getByText('Workout not saved')).toBeTruthy();
    expect(view.getByText(`${item.body.workout_name} · ${refusedView(item.body).date}`)).toBeTruthy();
    expect(view.getByText(said)).toBeTruthy();
    expect(view.getByText(next)).toBeTruthy();
    expect(view.queryByText(VALIDATION)).toBeNull();
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

  it('three or more: one count card with See all (OPERATOR RULING 7208809287 item 4); See all shows each card', async () => {
    const view = await show([invalid('a'), invalid('b', 'Push', '2026-10-12'), gone()]);
    expect(view.getByText('3 workouts not saved')).toBeTruthy();
    expect(view.queryByText('See both')).toBeNull();
    expect(view.queryByTestId('refused-card-a')).toBeNull();
    await act(async () => { fireEvent.press(view.getByText('See all')); });
    expect(view.getAllByText('Workout not saved')).toHaveLength(3);
    expect(['a', 'b', 'g'].map((id) => !!view.queryByTestId(`refused-card-${id}`))).toEqual([true, true, true]);
    expect(view.queryByText(VALIDATION)).toBeNull();
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
    // WORKOUT_INVALID in the sheet: the plain line and the next step, never the validation line.
    expect(view.getAllByText(PLAIN).length).toBeGreaterThanOrEqual(2); // the card and the sheet
    expect(view.queryByText(VALIDATION)).toBeNull();
    // B3: the scrim speaks main's word for the same control.
    const scrim = view.getByTestId('refused-sheet-scrim', { includeHiddenElements: true });
    expect(scrim.props.accessibilityLabel).toBe('Close');
    await act(async () => { fireEvent.press(scrim); });
    expect(view.queryByTestId('refused-sheet')).toBeNull();
  });

  it('C3: a timed exercise reads "3 × 60 sec" in the sheet, as the Train tab writes it; reps rows as before', async () => {
    const timedBody = {
      date: '2026-10-10', workout_name: 'Core A', workout_type: 'strength', duration_minutes: 20, notes: '',
      exercises: [
        { exercise_name: 'Plank', sets_completed: 3, reps_per_set: [60, 60, 60], weight_per_set: [0, 0, 0], plan_assignment_id: 'as1', plan_order: 0 },
        { exercise_name: 'Dead bug', sets_completed: 3, reps_per_set: [10, 10, 10], weight_per_set: [0, 0, 0], plan_assignment_id: 'as1', plan_order: 1 },
        { exercise_name: 'Carry', sets_completed: 2, reps_per_set: [40, 40], weight_per_set: [50, 50], plan_assignment_id: 'as1', plan_order: 2 },
        { exercise_name: 'Added row', sets_completed: 2, reps_per_set: [8, 8], weight_per_set: [0, 0] },
      ],
    };
    const row = (order: number, unit: 'reps' | 'seconds') => ({
      exercise_external_id: `x${order}`, order, sets: 3, reps_or_duration_seconds: 60, unit, weight_lbs: null,
    });
    const assignments = [
      { id: 'other', exercises: [row(0, 'reps')] },
      { id: 'as1', snapshot_source: true, exercises: [row(0, 'seconds'), row(1, 'reps'), row(2, 'seconds')] },
    ] as never;
    expect(refusedView(timedBody, assignments).rows.map((r) => r.line)).toEqual(['3 × 60 sec', '3 × 10', '2 × 40 sec · 50 lb', '2 × 8']);
    // Not loaded yet (the tab's first read): reps, as before.
    expect(refusedView(timedBody).rows.map((r) => r.line)).toEqual(['3 × 60', '3 × 10', '2 × 40 · 50 lb', '2 × 8']);
    mockList.mockResolvedValue([{ id: 't', body: timedBody, refusal: invalid().refusal }]);
    const view = await render(<RefusedWorkoutCard assignments={assignments} />);
    await act(async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); });
    await act(async () => { fireEvent.press(view.getByTestId('refused-card-open')); });
    expect(view.getByText('3 × 60 sec')).toBeTruthy();
    expect(view.getByText('3 × 10')).toBeTruthy();
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

  // B1: the coach chat is on the Home stack; the card is on the Train stack. It opens through the tabs, Home's first
  // screen under it (the real navigators: LSWRM1.B1.tellOpensCoachChat.btest.test.tsx).
  it.each([
    ['the card', 'refused-card-tell', false],
    ['the sheet (it closes first)', 'refused-sheet-tell', true],
  ])('Tell Sam from %s opens the coach chat on the Home stack', async (_name, testID, fromSheet) => {
    const view = await show([invalid()]);
    if (fromSheet) await act(async () => { fireEvent.press(view.getByTestId('refused-card-open')); });
    await act(async () => { fireEvent.press(view.getByTestId(testID)); });
    expect(mockTabNavigate).toHaveBeenCalledTimes(1);
    expect(mockTabNavigate).toHaveBeenCalledWith('Home', { screen: 'Messages', initial: false });
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(view.queryByTestId('refused-sheet')).toBeNull();
  });

  it('N2: two taps in one frame send once, and "Not accepted again." still shows', async () => {
    const view = await show([invalid()]);
    let answer!: (o: string) => void;
    mockSend.mockImplementationOnce(() => new Promise((r) => { answer = r; }));
    mockSend.mockResolvedValue('kept');
    await act(async () => {
      fireEvent.press(view.getByTestId('refused-card-send'));
      fireEvent.press(view.getByTestId('refused-card-send'));
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
    await act(async () => { answer('dead_letter'); for (let i = 0; i < 4; i++) await Promise.resolve(); });
    expect(view.getByTestId('refused-sheet-again')).toBeTruthy();
    mockSend.mockReset();
    mockSend.mockImplementation(async () => 'sent');
  });

  it('N2: a database error on Send again is caught; the card stays and can send again', async () => {
    const view = await show([invalid()]);
    mockSend.mockRejectedValueOnce(new Error('database is locked'));
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);
    await act(async () => { fireEvent.press(view.getByTestId('refused-card-send')); for (let i = 0; i < 4; i++) await Promise.resolve(); });
    await new Promise((r) => setImmediate(r));
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
    expect(HapticService.error).toHaveBeenCalledTimes(1); // the caught error is felt (docs/HAPTICS.md: error on a failed action)
    expect(view.getByTestId('refused-card-a')).toBeTruthy();
    expect(view.getByTestId('refused-card-send').props.accessibilityState).toMatchObject({ disabled: false });
    await act(async () => { fireEvent.press(view.getByTestId('refused-card-send')); });
    expect(mockSend).toHaveBeenCalledTimes(2);
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
