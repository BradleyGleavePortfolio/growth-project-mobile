import React from 'react';
import { Alert, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { AxiosHeaders, type AxiosResponse } from 'axios';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import FastingScreen from '../FastingScreen';
import { fastingApi } from '../../../services/api';

const mockUser = { id: 'client-1' };
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../../../services/api', () => ({
  fastingApi: { getHistory: jest.fn(), start: jest.fn(), end: jest.fn(), deleteFast: jest.fn() },
}));
jest.mock('../../../utils/logger', () => ({ logger: { error: jest.fn() } }));
jest.mock('../../../utils/notifications', () => ({ scheduleFastingAlert: jest.fn(async () => 'notification-new') }));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(async () => undefined),
  notificationAsync: jest.fn(async () => undefined),
  ImpactFeedbackStyle: { Medium: 'medium' },
  NotificationFeedbackType: { Warning: 'warning', Success: 'success' },
}));
jest.mock('../../../components/FadeInView', () => {
  const React = require('react');
  const { View } = require('react-native');
  return ({ children }: { children: React.ReactNode }) => React.createElement(View, null, children);
});

const alertKey = 'fasting:scheduled_notification_id:client-1';
const response = (data: unknown): AxiosResponse => ({
  data, status: 200, statusText: 'OK', headers: {}, config: { headers: new AxiosHeaders() },
});
const ended = {
  id: 'ended-fast', protocol: '12:12',
  start_time: '2026-10-06T08:00:00.000Z', end_time: '2026-10-06T20:00:00.000Z',
};
const active = {
  id: 'active-fast', protocol: '16:8', start_time: new Date().toISOString(), end_time: null,
};
const confirmRemoval = async () => {
  const remove = jest.mocked(Alert.alert).mock.calls.at(-1)?.[2]?.find((button) => button.text === 'Remove');
  expect(remove).toBeTruthy();
  await act(async () => { await remove?.onPress?.(); });
};

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  jest.mocked(fastingApi.getHistory).mockResolvedValue(response([ended]));
  jest.mocked(fastingApi.deleteFast).mockResolvedValue(response({ id: ended.id, deleted: true }));
});
afterEach(() => jest.restoreAllMocks());

it('requires confirmation, removes the selected ended fast, and clears statistics for empty history', async () => {
  await render(<FastingScreen />);
  await screen.findByTestId('remove-fast-ended-fast');
  expect(screen.getByTestId('fasting-completed-count').props.children).toBe(1);
  await fireEvent.press(screen.getByTestId('remove-fast-ended-fast'));
  expect(Alert.alert).toHaveBeenLastCalledWith(
    'Remove this fast?', expect.any(String),
    expect.arrayContaining([expect.objectContaining({ text: 'Cancel', style: 'cancel' })]),
  );
  expect(fastingApi.deleteFast).not.toHaveBeenCalled();
  jest.mocked(fastingApi.getHistory).mockResolvedValue(response([]));
  await confirmRemoval();
  expect(fastingApi.deleteFast).toHaveBeenCalledWith('ended-fast');
  // Calm Fasting (FAST-CALM-FIN-130): with no fast left the stats are hidden, not zeros.
  await waitFor(() => expect(screen.getByText('Each fast you end is saved here.')).toBeTruthy());
  expect(screen.queryByTestId('fasting-completed-count')).toBeNull();
  expect(screen.queryByText('12.0h')).toBeNull();
  expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Start fast')).toBeTruthy();
});

it('removes a running fast and cancels only this client’s scheduled end alert after server success', async () => {
  await AsyncStorage.setItem(alertKey, 'notification-active');
  await AsyncStorage.setItem('fasting:scheduled_notification_id:other-client', 'notification-other');
  jest.mocked(fastingApi.getHistory).mockResolvedValue(response([active, ended]));
  await render(<FastingScreen />);
  await screen.findByTestId('remove-fast-active-fast');
  await fireEvent.press(screen.getByTestId('remove-fast-active-fast'));
  jest.mocked(fastingApi.getHistory).mockResolvedValue(response([ended]));
  await confirmRemoval();
  expect(fastingApi.deleteFast).toHaveBeenCalledWith('active-fast');
  expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(1);
  expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('notification-active');
  expect(await AsyncStorage.getItem(alertKey)).toBeNull();
  expect(await AsyncStorage.getItem('fasting:scheduled_notification_id:other-client')).toBe('notification-other');
  expect(screen.queryByLabelText('End fast')).toBeNull();
  expect(screen.getByLabelText('Start fast')).toBeTruthy();
  expect(screen.getByTestId('remove-fast-ended-fast')).toBeTruthy();
});

it('keeps the running fast and end alert after failed deletion, with a specific actionable error', async () => {
  await AsyncStorage.setItem(alertKey, 'notification-active');
  jest.mocked(fastingApi.getHistory).mockResolvedValue(response([active]));
  jest.mocked(fastingApi.deleteFast).mockRejectedValueOnce(new Error('Offline'));
  await render(<FastingScreen />);
  await screen.findByTestId('remove-fast-active-fast');
  await fireEvent.press(screen.getByTestId('remove-fast-active-fast'));
  await confirmRemoval();
  expect(Alert.alert).toHaveBeenLastCalledWith(
    "Couldn't remove fast", 'The fast could not be removed. Check the connection and try again.',
  );
  expect(screen.getByLabelText('End fast').props.accessibilityState.disabled).toBe(false);
  expect(screen.getByTestId('remove-fast-active-fast')).toBeTruthy();
  expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem(alertKey)).toBe('notification-active');
});

it('locks existing actions during removal without claiming a different fast action is underway', async () => {
  let resolveDelete: ((value: AxiosResponse) => void) | undefined;
  jest.mocked(fastingApi.deleteFast).mockReturnValue(new Promise((resolve) => { resolveDelete = resolve; }));
  await render(<FastingScreen />);
  await screen.findByTestId('remove-fast-ended-fast');
  await fireEvent.press(screen.getByTestId('remove-fast-ended-fast'));
  const remove = jest.mocked(Alert.alert).mock.calls.at(-1)?.[2]?.find((button) => button.text === 'Remove');
  await act(async () => { remove?.onPress?.(); });
  expect(screen.getByLabelText('Start fast').props.accessibilityState.disabled).toBe(true);
  expect(screen.queryByText('Starting…')).toBeNull();
  expect(screen.getByText('Removing…')).toBeTruthy();
  expect(StyleSheet.flatten(screen.getByTestId('remove-fast-ended-fast').props.style).minHeight).toBe(44);
  jest.mocked(fastingApi.getHistory).mockResolvedValue(response([]));
  await act(async () => resolveDelete?.(response({ id: ended.id, deleted: true })));
  await waitFor(() => expect(screen.getByLabelText('Start fast').props.accessibilityState.disabled).toBe(false));
});

it('leaves the running timer and its end alert intact when removing a history row', async () => {
  await AsyncStorage.setItem(alertKey, 'notification-active');
  jest.mocked(fastingApi.getHistory).mockResolvedValue(response([active, ended]));
  await render(<FastingScreen />);
  await screen.findByTestId('remove-fast-ended-fast');
  await fireEvent.press(screen.getByTestId('remove-fast-ended-fast'));
  jest.mocked(fastingApi.getHistory).mockResolvedValue(response([active]));
  await confirmRemoval();
  expect(fastingApi.deleteFast).toHaveBeenCalledWith('ended-fast');
  expect(screen.getByLabelText('End fast')).toBeTruthy();
  expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem(alertKey)).toBe('notification-active');
});
