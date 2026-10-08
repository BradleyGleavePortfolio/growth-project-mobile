import React from 'react';
import { Alert, Text } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { createNavigationContainerRef, NavigationContainer, type ParamListBase } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { Draft, WorkoutPayload } from '../types/coachAi';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000000' }) }),
}));
jest.mock('../components/coach/ai-builder/useAiBuilder', () => ({ fireAiHaptic: jest.fn() }));
const mockGetDraft = jest.fn();
const mockEditDraft = jest.fn();
const mockApproveDraft = jest.fn();
const mockRejectDraft = jest.fn();
jest.mock('../api/coachAi', () => ({
  __esModule: true,
  default: {
    getDraft: (...args: unknown[]) => mockGetDraft(...args),
    editDraft: (...args: unknown[]) => mockEditDraft(...args),
    approveDraft: (...args: unknown[]) => mockApproveDraft(...args),
    rejectDraft: (...args: unknown[]) => mockRejectDraft(...args),
  },
}));

import AIWorkoutDraftScreen from '../screens/coach/AIWorkoutDraftScreen';

const draft: Draft<WorkoutPayload> = {
  draftId: 'draft-1', type: 'WORKOUT_PROGRAM', clientId: 'client-1',
  modelUsed: 'internal-model', tokensIn: 100, tokensOut: 200, costCents: 50,
  generatedPayload: {
    title: 'Workout draft', summary: 'Upper body',
    weeks: [{ week: 1, notes: '', days: [{
      day: 1, focus: 'Upper', exercises: [{ name: 'Bench press', sets: 3, reps: '8-10', rir: 2 }],
    }] }],
  },
};
const Stack = createNativeStackNavigator();

async function openDraft() {
  const navigation = createNavigationContainerRef<ParamListBase>();
  const screen = await render(
    <NavigationContainer
      ref={navigation}
      initialState={{ index: 1, routes: [{ name: 'ClientDetail' }, { name: 'AIWorkoutDraft' }] }}
    >
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="ClientDetail">{() => <Text>Client detail</Text>}</Stack.Screen>
        <Stack.Screen
          name="AIWorkoutDraft" component={AIWorkoutDraftScreen}
          initialParams={{ draftId: 'draft-1', clientId: 'client-1', clientName: 'Test client' }}
        />
      </Stack.Navigator>
    </NavigationContainer>,
  );
  await screen.findByTestId('workout-sets-0-0-0');
  return { screen, navigation };
}

async function chooseAlert(label: string) {
  const calls = jest.mocked(Alert.alert).mock.calls;
  const button = calls[calls.length - 1]?.[2]?.find((item) => item.text === label);
  expect(button).toBeDefined();
  await act(async () => { await button?.onPress?.(); });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockGetDraft.mockResolvedValue({ data: draft });
  mockEditDraft.mockResolvedValue({ data: draft });
  mockApproveDraft.mockResolvedValue({ data: {} });
  mockRejectDraft.mockResolvedValue({ data: {} });
});

describe('AI workout draft keep edits', () => {
  it.each(['Back', 'Native removal'])('retains edits on %s until discard is confirmed', async (action) => {
    const { screen, navigation } = await openDraft();
    await fireEvent.changeText(screen.getByTestId('workout-sets-0-0-0'), '5');
    await act(async () => {
      if (action === 'Back') await fireEvent.press(screen.getByLabelText('Back'));
      else navigation.goBack();
    });
    expect(Alert.alert).toHaveBeenLastCalledWith('Discard edits?', expect.any(String), expect.any(Array));
    expect(navigation.getCurrentRoute()?.name).toBe('AIWorkoutDraft');
    await chooseAlert('Keep editing');
    expect(screen.getByTestId('workout-sets-0-0-0').props.value).toBe('5');
    await fireEvent.press(screen.getByLabelText('Back'));
    await chooseAlert('Discard');
    await waitFor(() => expect(navigation.getCurrentRoute()?.name).toBe('ClientDetail'));
    expect(mockEditDraft).not.toHaveBeenCalled();
    expect(mockRejectDraft).not.toHaveBeenCalled();
  });

  it('leaves an untouched draft without a prompt', async () => {
    const { screen, navigation } = await openDraft();
    await fireEvent.press(screen.getByLabelText('Back'));
    await waitFor(() => expect(navigation.getCurrentRoute()?.name).toBe('ClientDetail'));
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('saves the edited payload and then leaves without a discard prompt', async () => {
    const { screen, navigation } = await openDraft();
    await fireEvent.changeText(screen.getByTestId('workout-sets-0-0-0'), '5');
    await fireEvent.press(screen.getByLabelText('Save edits'));
    await waitFor(() => expect(Alert.alert).toHaveBeenLastCalledWith('Saved', expect.any(String)));
    expect(mockEditDraft).toHaveBeenCalledWith('draft-1', expect.objectContaining({
      weeks: [expect.objectContaining({ days: [expect.objectContaining({
        exercises: [expect.objectContaining({ sets: 5 })],
      })] })],
    }));
    await fireEvent.press(screen.getByLabelText('Back'));
    await waitFor(() => expect(navigation.getCurrentRoute()?.name).toBe('ClientDetail'));
    expect(Alert.alert).toHaveBeenCalledTimes(1);
  });

  it('keeps the guard and edited payload when saving fails', async () => {
    mockEditDraft.mockRejectedValue(new Error('No connection'));
    const { screen, navigation } = await openDraft();
    await fireEvent.changeText(screen.getByTestId('workout-sets-0-0-0'), '5');
    await fireEvent.press(screen.getByLabelText('Save edits'));
    await waitFor(() => expect(Alert.alert).toHaveBeenLastCalledWith('Save failed', expect.any(String)));
    await fireEvent.press(screen.getByLabelText('Back'));
    expect(Alert.alert).toHaveBeenLastCalledWith('Discard edits?', expect.any(String), expect.any(Array));
    expect(navigation.getCurrentRoute()?.name).toBe('AIWorkoutDraft');
    expect(screen.getByTestId('workout-sets-0-0-0').props.value).toBe('5');
  });

  it.each(['Save and approve', 'Discard and approve'])('retains %s and its ClientDetail destination without an extra discard prompt', async (choice) => {
    const { screen, navigation } = await openDraft();
    await fireEvent.changeText(screen.getByTestId('workout-sets-0-0-0'), '5');
    await fireEvent.press(screen.getByLabelText('Approve draft'));
    await chooseAlert(choice);
    await waitFor(() => expect(mockApproveDraft).toHaveBeenCalledWith('draft-1'));
    if (choice === 'Discard and approve') expect(mockEditDraft).not.toHaveBeenCalled();
    await chooseAlert('OK');
    await waitFor(() => expect(navigation.getCurrentRoute()?.name).toBe('ClientDetail'));
    expect(navigation.getCurrentRoute()?.params).toEqual({ clientId: 'client-1', clientName: 'Test client' });
    expect(jest.mocked(Alert.alert).mock.calls.some(([title]) => title === 'Discard edits?')).toBe(false);
  });

  it('keeps edits protected when rejection fails and the coach closes the reason sheet', async () => {
    mockRejectDraft.mockRejectedValue(new Error('No connection'));
    const { screen, navigation } = await openDraft();
    await fireEvent.changeText(screen.getByTestId('workout-sets-0-0-0'), '5');
    await fireEvent.press(screen.getByLabelText('Reject draft'));
    await fireEvent.changeText(screen.getByLabelText('Rejection reason'), 'Use fewer sets');
    await fireEvent.press(screen.getAllByText('Reject')[1]);
    await waitFor(() => expect(Alert.alert).toHaveBeenLastCalledWith('Reject failed', expect.any(String)));
    expect(screen.getByLabelText('Rejection reason').props.value).toBe('Use fewer sets');
    await fireEvent.press(screen.getByText('Cancel'));
    await fireEvent.press(screen.getByLabelText('Back'));
    expect(Alert.alert).toHaveBeenLastCalledWith('Discard edits?', expect.any(String), expect.any(Array));
    expect(navigation.getCurrentRoute()?.name).toBe('AIWorkoutDraft');
    expect(screen.getByTestId('workout-sets-0-0-0').props.value).toBe('5');
  });

  it('rejects with the entered reason and returns without an extra discard prompt', async () => {
    const { screen, navigation } = await openDraft();
    await fireEvent.changeText(screen.getByTestId('workout-sets-0-0-0'), '5');
    await fireEvent.press(screen.getByLabelText('Reject draft'));
    expect(screen.getByText('Add a reason for rejecting this draft.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Rejection reason'), 'Use fewer sets');
    await fireEvent.press(screen.getAllByText('Reject')[1]);
    await waitFor(() => expect(mockRejectDraft).toHaveBeenCalledWith('draft-1', 'Use fewer sets'));
    await chooseAlert('OK');
    await waitFor(() => expect(navigation.getCurrentRoute()?.name).toBe('ClientDetail'));
    expect(jest.mocked(Alert.alert).mock.calls.some(([title]) => title === 'Discard edits?')).toBe(false);
  });

  it('shows all review actions without model, token or dollar-cost provenance', async () => {
    const { screen } = await openDraft();
    expect(screen.queryByText(/Model used:|internal-model|tokens|\$0\.50/)).toBeNull();
    for (const label of ['Back', 'Save edits', 'Approve draft', 'Reject draft']) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
    expect(screen.getByLabelText('Week 1 notes')).toBeTruthy();
    expect(screen.getByLabelText('Day 1 focus')).toBeTruthy();
    expect(screen.getByLabelText('Exercise 1 name')).toBeTruthy();
    expect(screen.getByLabelText('Exercise 1 notes')).toBeTruthy();
    for (const label of ['Sets', 'Reps', 'RIR', 'RPE']) expect(screen.getByLabelText(label)).toBeTruthy();
  });
});
