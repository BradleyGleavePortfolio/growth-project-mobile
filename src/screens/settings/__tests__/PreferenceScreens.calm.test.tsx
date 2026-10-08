import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { AxiosHeaders } from 'axios';
import CategoryScreen from '../NotificationPreferencesScreen';
import ChannelScreen from '../../notifications/NotificationPreferencesScreen';
import AppScreen from '../../client/PreferencesScreen';
import { DEFAULT_PREFERENCES } from '../../../hooks/usePreferences';
import { notificationsApi } from '../../../services/api';
import { fetchNotificationPreferences, saveNotificationPreferences, preferencesFromBackend } from '../../../services/notificationsApi';
import { darkTokens, lightTokens } from '../../../theme/tokens';

let mockPalette = lightTokens;
const mockBack = jest.fn(), mockUpdateApp = jest.fn();
let mockPrefs = { ...DEFAULT_PREFERENCES };
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ semanticColors: mockPalette, colors: require('../../../constants/colors').default }),
}));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ goBack: mockBack }) }));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../lib/userCache', () => ({ readUserCacheSync: () => null }));
jest.mock('../../../utils/haptics', () => ({ mediumTap: jest.fn() }));
jest.mock('../../../components/HapticPressable', () => ({ __esModule: true, default: require('react-native').Pressable }));
jest.mock('../../../components/support/SupportEmailFallback', () => ({
  SupportEmailFallback: () => null, useSupportEmail: () => ({ open: jest.fn() }),
}));
jest.mock('../../../services/api', () => ({ notificationsApi: { getPreferences: jest.fn(), updatePreferences: jest.fn() } }));
jest.mock('../../../services/notificationsApi', () => ({
  ...jest.requireActual('../../../services/notificationsApi'),
  fetchNotificationPreferences: jest.fn(), saveNotificationPreferences: jest.fn(),
}));
jest.mock('../../../hooks/usePreferences', () => ({
  ...jest.requireActual('../../../hooks/usePreferences'),
  usePreferences: () => ({ prefs: mockPrefs, isLoading: false, isSaving: false, updatePrefs: mockUpdateApp }),
}));
const navigation: Parameters<typeof AppScreen>[0]['navigation'] = {
  goBack: mockBack, navigate: jest.fn(), navigateDeprecated: jest.fn(), preload: jest.fn(),
  dispatch: jest.fn(), reset: jest.fn(), isFocused: jest.fn(), canGoBack: jest.fn(),
  getId: jest.fn(), getParent: jest.fn(), getState: jest.fn(),
  setOptions: jest.fn(), setParams: jest.fn(), replaceParams: jest.fn(),
  addListener: jest.fn(), removeListener: jest.fn(),
};
const response = (data: Record<string, unknown>) => ({
  data, status: 200, statusText: 'OK', headers: {}, config: { headers: new AxiosHeaders() },
});
const getCategories = jest.mocked(notificationsApi.getPreferences);
const patchCategories = jest.mocked(notificationsApi.updatePreferences);
const getChannels = jest.mocked(fetchNotificationPreferences);
const patchChannels = jest.mocked(saveNotificationPreferences);

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockPalette = lightTokens;
  mockPrefs = { ...DEFAULT_PREFERENCES };
  getCategories.mockResolvedValue(response({}));
  patchCategories.mockResolvedValue(response({}));
  getChannels.mockResolvedValue(preferencesFromBackend({}));
  patchChannels.mockImplementation(async (patch) => {
    const next = preferencesFromBackend({});
    if (patch.muteAll !== undefined) next.muteAll = patch.muteAll;
    for (const kind of Object.keys(patch.channels ?? {}) as Array<keyof typeof next.channels>) {
      next.channels[kind] = { ...next.channels[kind], ...patch.channels?.[kind] };
    }
    return next;
  });
});

it('category copy matches the exact fields and all four working actions remain reachable', async () => {
  const screen = await render(<CategoryScreen navigation={navigation} />);
  await screen.findByLabelText('Workout reminders');
  expect(screen.queryByText('Meal reminder preference.')).toBeNull();
  expect(screen.queryByLabelText('Reminders')).toBeNull();
  expect(screen.getAllByRole('switch')).toHaveLength(4);
  expect(screen.getByText('Daily and weekly summary email.')).toBeTruthy();
  expect(screen.queryByText(/critical billing and security/)).toBeNull();
  const cases: Array<[string, Record<string, boolean>]> = [
    ['Coach Messages', { message_push: false, message_inapp: false }],
    ['Workout reminders', { workout_reminder_push: false, workout_reminder_inapp: false }],
    ['Milestones', { milestone_push: false, milestone_inapp: false }],
    ['System', { digest_email: false }],
  ];
  for (const [label, patch] of cases) {
    await fireEvent(screen.getByLabelText(label), 'valueChange', false);
    await waitFor(() => expect(patchCategories).toHaveBeenLastCalledWith(patch));
    await waitFor(() => expect(screen.getByLabelText(label).props.disabled).toBe(false));
  }
  await fireEvent.press(screen.getByLabelText('Go back'));
  expect(mockBack).toHaveBeenCalled();
});

it('all category switches show the server values, not a default claim', async () => {
  getCategories.mockResolvedValue(response({ message_push: false, eat_enabled: false, milestone_push: false, digest_email: false, weekly_summary_enabled: true }));
  const screen = await render(<CategoryScreen navigation={navigation} />);
  for (const label of ['Coach Messages', 'Milestones', 'System']) {
    expect((await screen.findByLabelText(label)).props.value).toBe(false);
  }
});

it.each([true, false])('keeps a saved client_bot=%s harmless without exposing or sending it', async (saved) => {
  await AsyncStorage.setItem('gp_notif_category_prefs', JSON.stringify({ client_bot: saved }));
  getCategories.mockResolvedValue(response({ eat_enabled: !saved, message_push: true }));
  const screen = await render(<CategoryScreen navigation={navigation} />);
  await screen.findByLabelText('Coach Messages');
  expect(screen.queryByLabelText('Reminders')).toBeNull();
  await fireEvent(screen.getByLabelText('Coach Messages'), 'valueChange', false);
  expect(patchCategories).toHaveBeenCalledTimes(1);
  expect(patchCategories).toHaveBeenCalledWith({ message_push: false, message_inapp: false });
  expect(JSON.parse((await AsyncStorage.getItem('gp_notif_category_prefs')) ?? '{}'))
    .toMatchObject({ client_bot: saved, coach_direct: false });
});

it('every mapped kind retains push, in-app and email actions; mute and back remain', async () => {
  const screen = await render(<ChannelScreen />);
  await screen.findByLabelText('Mute all notifications');
  expect(screen.getByTestId('quiet-hours-fixed')).toBeTruthy();
  for (const [kind, label] of [['message', 'Direct messages'], ['build_week', 'Build week gates'], ['milestone', 'Milestones'], ['check_in', 'Check-in reminders']] as const) {
    for (const [channel, text] of [['push', 'Push'], ['in_app', 'In-app'], ['email', 'Email']] as const) {
      await fireEvent(screen.getByLabelText(`${label} via ${text}`), 'valueChange', false);
      await waitFor(() => expect(patchChannels).toHaveBeenLastCalledWith({ channels: { [kind]: { [channel]: false } } }));
      await waitFor(() => expect(screen.getByLabelText('Mute all notifications').props.disabled).toBe(false));
    }
  }
  await fireEvent(screen.getByLabelText('Mute all notifications'), 'valueChange', true);
  await waitFor(() => expect(patchChannels).toHaveBeenLastCalledWith({ muteAll: true }));
  await waitFor(() => expect(screen.getByLabelText('Direct messages via Push').props.disabled).toBe(true));
  await fireEvent.press(screen.getByLabelText('Go back'));
  expect(mockBack).toHaveBeenCalled();
});

it('failed channel loading has a working retry and back instead of a blank screen', async () => {
  getChannels.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(preferencesFromBackend({}));
  const screen = await render(<ChannelScreen />);
  await fireEvent.press(await screen.findByLabelText('Go back'));
  expect(mockBack).toHaveBeenCalled();
  await fireEvent.press(await screen.findByLabelText('Try again'));
  expect(await screen.findByLabelText('Mute all notifications')).toBeTruthy();
  expect(getChannels).toHaveBeenCalledTimes(2);
});

it('all personalization switches and options still save the exact preference keys', async () => {
  const screen = await render(<AppScreen navigation={navigation} />);
  for (const notice of [
    'Home choices are stored only; they do not change Home.',
    'This saved cadence does not change notification delivery.',
    'Tone choices are stored only; they do not change app wording.',
    'Unit choices are stored only; they do not change displayed measurements.',
    'Week choices are stored only; they do not change calendar layouts.',
  ]) expect(screen.getByText(notice)).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Notification settings'));
  expect(navigation.navigate).toHaveBeenCalledWith('NotificationSettings');
  for (const toggle of screen.getAllByRole('switch')) expect(StyleSheet.flatten(toggle.props.style).minHeight).toBe(44);
  for (const [mod, label] of [['hero', 'Hero Action'], ['milestone', 'Milestone Card'], ['trustcues', 'Trust Cues'], ['secondary', 'Secondary Tiles'], ['community', 'Community Feed']] as const) {
    await fireEvent(screen.getByLabelText(label), 'valueChange', false);
    expect(mockUpdateApp).toHaveBeenLastCalledWith({ homeModules: mockPrefs.homeModules.filter((m) => m !== mod) });
  }
  for (const [key, values, labels] of [
    ['notificationCadence', ['daily', 'weekly', 'off'], ['Daily', 'Weekly', 'Off']],
    ['motivationalTone', ['gentle', 'direct', 'drill'], ['Gentle', 'Direct', 'Drill']],
    ['units', ['metric', 'imperial'], ['Metric', 'Imperial']],
    ['firstDayOfWeek', [0, 1, 6], ['Sunday', 'Monday', 'Saturday']],
  ] as const) {
    for (const [i, label] of labels.entries()) {
      await fireEvent.press(screen.getByLabelText(label));
      expect(mockUpdateApp).toHaveBeenLastCalledWith({ [key]: values[i] });
    }
  }
  await fireEvent.press(screen.getByLabelText('Go back'));
  expect(mockBack).toHaveBeenCalled();
});

it.each([lightTokens, darkTokens])('uses the active semantic palette on all three screens', async (palette) => {
  mockPalette = palette;
  for (const Screen of [CategoryScreen, AppScreen]) {
    const screen = await render(<Screen navigation={navigation} />);
    const title = await screen.findByText(Screen === CategoryScreen ? 'Notification categories' : 'Personalization');
    expect(StyleSheet.flatten(title.props.style).color).toBe(palette.textPrimary);
    expect(StyleSheet.flatten(title.props.style).fontFamily).toBe('CormorantGaramond_400Regular');
    await screen.unmount();
  }
  const screen = await render(<ChannelScreen />);
  const title = await screen.findByText('Notification settings');
  expect(StyleSheet.flatten(title.props.style).color).toBe(palette.textPrimary);
  await act(async () => {});
});
