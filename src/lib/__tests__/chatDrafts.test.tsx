/**
 * CHAT-DISCARD (owner 10-21, op 1): half-typed chat text is kept on the device per signed-in user and per chat, and a
 * failed send keeps its key with its text (Sol B1, m#841).
 */
import React from 'react';
import { Text, TextInput } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockDisk = new Map<string, string>();
jest.mock('../../storage/mmkv', () => ({
  cacheStorage: {
    getString: () => undefined, // the AsyncStorage fallback: no synchronous read
    getStringAsync: async (k: string) => mockDisk.get(k),
    set: async (k: string, v: string) => { mockDisk.set(k, v); },
    delete: async (k: string) => { mockDisk.delete(k); },
    getAllKeys: async () => [...mockDisk.keys()],
  },
}));
let mockUser: { id: string } | null = { id: 'client-1' };
jest.mock('../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));

const { useChatDraft, CHAT_DRAFT_KEY_PREFIX } = require('../chatDrafts');
const { authEvents } = require('../../utils/authEvents');

function Box({ thread, initial, failed }: { thread: string | null; initial?: string; failed?: [string, string] }) {
  const [text, setText, sendKey] = useChatDraft(thread, initial);
  return (
    <>
      <TextInput accessibilityLabel="box" value={text} onChangeText={setText} />
      <Text testID="key">{sendKey.keyFor(text) ?? 'none'}</Text>
      <Text testID="fail" onPress={() => failed && sendKey.keepFailed(failed[0], failed[1])}>fail</Text>
    </>
  );
}
const value = (v: Awaited<ReturnType<typeof render>>): string => v.getByLabelText('box').props.value;
const diskKeys = () => [...mockDisk.keys()];

beforeEach(async () => {
  mockUser = { id: 'client-1' };
  authEvents.emit('logout');
  await waitFor(() => expect(diskKeys()).toEqual([]));
  mockDisk.clear();
});

it('keeps half-typed text per chat and brings it back when that chat opens again', async () => {
  const a = await render(<Box thread="client:coach" />);
  await fireEvent.changeText(a.getByLabelText('box'), 'Hey, loved th');
  await a.unmount();
  await waitFor(() => expect(mockDisk.get(`${CHAT_DRAFT_KEY_PREFIX}client-1:client:coach`)).toContain('Hey, loved th'));
  const other = await render(<Box thread="dm:w:coach-1" />);
  expect(value(other)).toBe('');
  await other.unmount();
  expect(value(await render(<Box thread="client:coach" />))).toBe('Hey, loved th');
});

it('reads the device copy after the app closed (memory empty) and never shows it to another account', async () => {
  mockDisk.set(`${CHAT_DRAFT_KEY_PREFIX}client-1:roman`, JSON.stringify({ text: 'What should I eat' }));
  const same = await render(<Box thread="roman" />);
  await waitFor(() => expect(value(same)).toBe('What should I eat'));
  await same.unmount();
  mockUser = { id: 'client-2' };
  const other = await render(<Box thread="roman" />);
  await waitFor(() => expect(other.getByTestId('key').props.children).toBe('none'));
  expect(value(other)).toBe('');
});

it('a failed send keeps its key with its text; an edit is a new send; an empty box (sent) drops both', async () => {
  const a = await render(<Box thread="coach:client-1" failed={['see you at 6', 'key-1']} />);
  await fireEvent.changeText(a.getByLabelText('box'), 'see you at 6');
  await fireEvent.press(a.getByTestId('fail'));
  await a.unmount();
  const b = await render(<Box thread="coach:client-1" />);
  expect([value(b), b.getByTestId('key').props.children]).toEqual(['see you at 6', 'key-1']);
  await fireEvent.changeText(b.getByLabelText('box'), 'see you at 7');
  expect(b.getByTestId('key').props.children).toBe('none');
  await fireEvent.changeText(b.getByLabelText('box'), '');
  await fireEvent.changeText(b.getByLabelText('box'), 'see you at 6');
  expect(b.getByTestId('key').props.children).toBe('none');
});

it('a passed draft (Send check-in) goes under kept text, never over it (Opus C1); once is enough', async () => {
  const a = await render(<Box thread="coach:client-1" />);
  await fireEvent.changeText(a.getByLabelText('box'), 'old reply');
  await a.unmount();
  const b = await render(<Box thread="coach:client-1" initial="How did the week go?" />);
  expect(value(b)).toBe('old reply\n\nHow did the week go?');
  await b.unmount();
  expect(value(await render(<Box thread="coach:client-1" initial="How did the week go?" />))).toBe('old reply\n\nHow did the week go?');
  // After the app closed (memory empty, no synchronous read) the device copy still comes first.
  mockDisk.set(`${CHAT_DRAFT_KEY_PREFIX}client-1:coach:client-9`, JSON.stringify({ text: 'Half a thou' }));
  const c = await render(<Box thread="coach:client-9" initial="How did the week go?" />);
  await waitFor(() => expect(value(c)).toBe('Half a thou\n\nHow did the week go?'));
  await waitFor(() => expect(mockDisk.get(`${CHAT_DRAFT_KEY_PREFIX}client-1:coach:client-9`)).toContain('How did the week go?'));
  // No kept text: the passed draft alone.
  expect(value(await render(<Box thread="coach:client-5" initial="How did the week go?" />))).toBe('How did the week go?');
});

it('a sign-out removes every kept text from memory and the device', async () => {
  const b = await render(<Box thread="coach:client-1" />);
  await fireEvent.changeText(b.getByLabelText('box'), 'old reply');
  await b.unmount();
  await waitFor(() => expect(diskKeys()).toHaveLength(1));
  authEvents.emit('logout');
  await waitFor(() => expect(diskKeys()).toEqual([]));
  expect(value(await render(<Box thread="coach:client-1" />))).toBe('');
});

it('without a chat (null) the box keeps nothing', async () => {
  const a = await render(<Box thread={null} />);
  await fireEvent.changeText(a.getByLabelText('box'), 'a comment');
  expect(value(a)).toBe('a comment');
  await a.unmount();
  expect(value(await render(<Box thread={null} />))).toBe('');
  expect(diskKeys()).toEqual([]);
});
