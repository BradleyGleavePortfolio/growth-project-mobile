/**
 * voiceReportedStore (Opus R5-B3, Sol R5-B1): a reported voice note stays folded after a restart for
 * the account that reported it, the phone keeps only note ids under that account's key, and a sign-out
 * leaves the next account on the phone with nothing folded.
 */
import React from 'react';
import { Text } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearUserCache, setUserCache } from '../../../lib/userCache';
import { authEvents } from '../../../utils/authEvents';
import {
  markVoiceNoteReported,
  resetReportedVoiceNotes,
  useReportedVoiceNotes,
} from '../voiceReportedStore';

function Probe(): React.ReactElement {
  const reported = useReportedVoiceNotes();
  return <Text testID="probe">{[...reported].sort().join(',') || 'none'}</Text>;
}

const settle = () => act(async () => {
  await new Promise((r) => setTimeout(r, 0));
});

beforeEach(async () => {
  resetReportedVoiceNotes();
  await AsyncStorage.clear();
  await clearUserCache();
});

it('keeps a report through a restart, saved as ids only under the account key', async () => {
  await setUserCache({ id: 'u-a', email: 'a@example.invalid' });
  await act(async () => markVoiceNoteReported('vn-1'));
  await settle();
  expect(JSON.parse((await AsyncStorage.getItem('tgp.voiceReported.v1:u-a')) ?? '[]')).toEqual(['vn-1']);

  // Cold start: memory is gone; the first reader brings the fold back from the phone.
  resetReportedVoiceNotes();
  const { getByTestId } = await render(<Probe />);
  await waitFor(() => expect(getByTestId('probe').props.children).toBe('vn-1'));
});

it('a sign-out drops the ids, and the next account starts clean', async () => {
  await setUserCache({ id: 'u-a', email: 'a@example.invalid' });
  await act(async () => markVoiceNoteReported('vn-1'));
  await settle();
  const { getByTestId } = await render(<Probe />);
  await waitFor(() => expect(getByTestId('probe').props.children).toBe('vn-1'));

  await act(async () => {
    await clearUserCache();
    authEvents.emit('logout');
  });
  await settle();
  expect(getByTestId('probe').props.children).toBe('none');
  expect(await AsyncStorage.getItem('tgp.voiceReported.v1:u-a')).toBeNull();

  await act(async () => {
    await setUserCache({ id: 'u-b', email: 'b@example.invalid' });
    authEvents.emit('login');
  });
  await settle();
  expect(getByTestId('probe').props.children).toBe('none');
  await act(async () => markVoiceNoteReported('vn-2'));
  await settle();
  expect(getByTestId('probe').props.children).toBe('vn-2');
  expect(JSON.parse((await AsyncStorage.getItem('tgp.voiceReported.v1:u-b')) ?? '[]')).toEqual(['vn-2']);
});

it('an account change without a sign-out never carries the first account’s folds', async () => {
  await setUserCache({ id: 'u-a', email: 'a@example.invalid' });
  await act(async () => markVoiceNoteReported('vn-1'));
  await settle();
  const { getByTestId } = await render(<Probe />);
  await waitFor(() => expect(getByTestId('probe').props.children).toBe('vn-1'));

  await act(async () => {
    await setUserCache({ id: 'u-b', email: 'b@example.invalid' });
    authEvents.emit('login');
  });
  await settle();
  expect(getByTestId('probe').props.children).toBe('none');
});

it('a damaged saved entry starts clean instead of failing', async () => {
  await setUserCache({ id: 'u-a', email: 'a@example.invalid' });
  await AsyncStorage.setItem('tgp.voiceReported.v1:u-a', '{not json');
  const { getByTestId } = await render(<Probe />);
  await settle();
  expect(getByTestId('probe').props.children).toBe('none');
});
