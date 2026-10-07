import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { LeanOnboardingParamList } from '../../../navigation/LeanOnboardingNavigator';

const mockDrafts: Record<string, string> = {};
const mockUpdate = jest.fn(async (_payload: unknown) => ({ data: {} }));
jest.mock('../../../services/api', () => ({
  profileApi: { update: (payload: unknown) => mockUpdate(payload) },
}));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../utils/authEvents', () => ({ authEvents: { emit: jest.fn() } }));
jest.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'lean-client', role: 'student' }),
}));
jest.mock('../../../lib/coachSharingFirstSignIn', () => ({
  useFirstSignInCoachSharing: () => ({ notice: null, accept: jest.fn() }),
}));
jest.mock('../../../storage/mmkv', () => ({
  prefsStorage: {
    getStringAsync: jest.fn(async (key: string) => mockDrafts[key] ?? null),
    set: jest.fn(async (key: string, value: string) => { mockDrafts[key] = value; }),
  },
}));
jest.mock('expo-localization', () => ({ getLocales: () => [{ regionCode: 'US' }] }));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({
    colors: require('../../../constants/colors').Colors,
    semanticColors: require('../../../theme/tokens').lightTokens,
  }),
}));
jest.mock('../../../components/onboarding/StepTransitionView', () => {
  const React = require('react');
  const { View } = require('react-native');
  return ({ children }: { children: React.ReactNode }) => React.createElement(View, null, children);
});

import LeanQ1 from '../LeanQ1GoalScreen';
import LeanQ2 from '../LeanQ2ExperienceScreen';
import LeanQ3 from '../LeanQ3IntentScreen';
import LeanQ4 from '../LeanQ4MetricsScreen';
import LeanQ5 from '../LeanQ5Screen';
import LeanQ6 from '../LeanQ6Screen';
import { getOnboardingData } from '../../../utils/onboardingStore';
import { authEvents } from '../../../utils/authEvents';

const navigation = {
  navigate: jest.fn(),
  goBack: jest.fn(),
} as NativeStackNavigationProp<LeanOnboardingParamList>;
const screens = [LeanQ1, LeanQ2, LeanQ3, LeanQ4, LeanQ5, LeanQ6];
const draftKey = 'onboarding.lean_q5_draft:lean-client';

beforeEach(async () => {
  jest.clearAllMocks();
  for (const key of Object.keys(mockDrafts)) delete mockDrafts[key];
  await AsyncStorage.clear();
  await AsyncStorage.setItem('prefs:auth.user_data', JSON.stringify({ id: 'lean-client', role: 'student' }));
});

it.each(screens.map((Screen, index) => [Screen, index + 1] as const))(
  'renders honest six-step progress on %p (%i)',
  async (Screen, step) => {
    const r = await render(<Screen navigation={navigation} />);
    expect(r.getByText(`Step ${step} of 6`)).toBeTruthy();
    expect(r.queryByText(/I'll|I’ll|Track my|←|SAVE AND CONTINUE|^CONTINUE$/)).toBeNull();
    expect(r.queryByText(/home screen is set up|Your title begins/)).toBeNull();
  },
);

it.each([
  [LeanQ1, 'Build muscle', 'LeanQ2', { primaryGoal: 'build_muscle' }],
  [LeanQ2, 'Some experience', 'LeanQ3', { fitnessLevel: 'some' }],
  [LeanQ3, 'Track meals', 'LeanQ4', { intent: 'track_meals' }],
] as const)('retains the answer and onward route for %p', async (Screen, label, route, answer) => {
  const r = await render(<Screen navigation={navigation} />);
  await fireEvent.press(r.getByText(label));
  await waitFor(() => expect(navigation.navigate).toHaveBeenCalledWith(route));
  expect(await getOnboardingData()).toMatchObject(answer);
});

it.each(screens.slice(1))('keeps Back reachable on %p', async (Screen) => {
  const r = await render(<Screen navigation={navigation} />);
  await fireEvent.press(r.getByText('Back'));
  expect(navigation.goBack).toHaveBeenCalledTimes(1);
});

it('saves an optional sex choice with metric measurements and advances to Q5', async () => {
  const r = await render(<LeanQ4 navigation={navigation} />);
  await fireEvent.press(r.getByLabelText('Use metric units'));
  await fireEvent.press(r.getByLabelText('Female'));
  await fireEvent.changeText(r.getByLabelText('Height in centimetres'), '168');
  await fireEvent.changeText(r.getByLabelText('Current weight in kilograms'), '72');
  await fireEvent.press(r.getByTestId('lean-q4-save-continue'));
  await waitFor(() => expect(navigation.navigate).toHaveBeenCalledWith('LeanQ5'));
  expect(await getOnboardingData()).toMatchObject({ sex: 'female', height: 168, currentWeight: 72 });
});

it('leaves sex and measurements unanswered on the Q4 skip path', async () => {
  const r = await render(<LeanQ4 navigation={navigation} />);
  await fireEvent.press(r.getByTestId('lean-q4-skip'));
  await waitFor(() => expect(navigation.navigate).toHaveBeenCalledWith('LeanQ5'));
  expect(await getOnboardingData()).toEqual({});
});

it.each([undefined, `${new Date().getFullYear() - 30}-01-01`])(
  'does not invent a birth date from the displayed wheel or an unconfirmed old draft (%s)',
  async (oldDob) => {
    if (oldDob) mockDrafts[draftKey] = JSON.stringify({ dob: oldDob });
    const r = await render(<LeanQ5 navigation={navigation} />);
    await fireEvent.press(r.getByTestId('save-continue-btn'));
    await waitFor(() => expect(navigation.navigate).toHaveBeenCalledWith('LeanQ6'));
    expect((await getOnboardingData()).dob).toBeUndefined();
    await waitFor(() => expect(JSON.parse(mockDrafts[draftKey] ?? '{}').dob).toBeUndefined());
  },
);

it('retains explicit birth-year selection, target-weight conversion and final macro calculation', async () => {
  await AsyncStorage.setItem('onboarding_data', JSON.stringify({ sex: 'female', height: 168, currentWeight: 72 }));
  const year = new Date().getFullYear() - 30;
  const q5 = await render(<LeanQ5 navigation={navigation} />);
  await fireEvent.press(q5.getByTestId(`wheel-year-${year}`));
  await fireEvent.changeText(q5.getByTestId('target-weight-input'), '150');
  await fireEvent.press(q5.getByTestId('unit-chip-kg'));
  expect(Number(q5.getByTestId('target-weight-input').props.value)).toBeCloseTo(68, 1);
  await fireEvent.press(q5.getByTestId('save-continue-btn'));
  await waitFor(() => expect(navigation.navigate).toHaveBeenCalledWith('LeanQ6'));
  expect(await getOnboardingData()).toMatchObject({ dob: `${year}-01-01`, targetWeight: 68 });
  await q5.unmount();
  const q6 = await render(<LeanQ6 navigation={navigation} />);
  await fireEvent.press(q6.getByTestId('chip-vegan'));
  await fireEvent.press(q6.getByTestId('continue-btn'));
  await waitFor(() => expect(authEvents.emit).toHaveBeenCalled());
  expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
    sex: 'female', dob: `${year}-01-01`, diet_restrictions: ['vegan'],
    calorie_target: expect.any(Number), protein_target: expect.any(Number),
    onboarding_completed: true,
  }));
});

it.each([LeanQ2, LeanQ3, LeanQ6])('keeps skip-to-finish available on %p', async (Screen) => {
  const r = await render(<Screen navigation={navigation} />);
  await fireEvent.press(r.getByText('Skip for now'));
  await waitFor(() => expect(authEvents.emit).toHaveBeenCalled());
  expect(await AsyncStorage.getItem('onboarding_complete')).toBe('true');
});

it('keeps Q1 skip confirmation with the actual profile-edit destination', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const r = await render(<LeanQ1 navigation={navigation} />);
  await fireEvent.press(r.getByText('Skip for now'));
  expect(alert).toHaveBeenCalledWith('Skip personalisation?', expect.stringContaining('Profile > Edit profile'), expect.any(Array));
  const confirm = alert.mock.calls[0]?.[2]?.find((button) => button.text === 'Skip anyway');
  await confirm?.onPress?.();
  await waitFor(() => expect(authEvents.emit).toHaveBeenCalled());
  alert.mockRestore();
});

it('keeps Q5 skip and dietary None deselection', async () => {
  const q5 = await render(<LeanQ5 navigation={navigation} />);
  await fireEvent.press(q5.getByTestId('skip-btn'));
  expect(navigation.navigate).toHaveBeenCalledWith('LeanQ6');
  await q5.unmount();
  const q6 = await render(<LeanQ6 navigation={navigation} />);
  await fireEvent.press(q6.getByTestId('chip-vegan'));
  await fireEvent.press(q6.getByTestId('chip-none'));
  await fireEvent.press(q6.getByTestId('continue-btn'));
  await waitFor(() => expect(authEvents.emit).toHaveBeenCalled());
  expect((await getOnboardingData()).restrictions).toEqual([]);
});
