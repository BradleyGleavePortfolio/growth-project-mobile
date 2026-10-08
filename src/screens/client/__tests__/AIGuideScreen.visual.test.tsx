import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import AIGuideScreen from '../AIGuideScreen';
import { aiApi } from '../../../services/api';
import { getChatHistory, saveChatMessage } from '../../../db/chatDb';

jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'client', firstName: 'Alex' }) }));
jest.mock('../../../db/chatDb', () => ({ getChatHistory: jest.fn(async () => []), saveChatMessage: jest.fn() }));
jest.mock('../../../services/api', () => ({ aiApi: {
  getStructuredContext: jest.fn(async () => ({ data: { coach: { name: 'Taylor' } } })),
  chat: jest.fn(async () => ({ data: { reply: 'Training notes received.' } })),
} }));
jest.mock('../../../theme/ThemeProvider', () => ({ useTheme: () => ({ colors: new Proxy({}, { get: () => 'theme-color' }) }) }));
jest.mock('../../../components/FadeInView', () => ({ __esModule: true, default: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('../../../components/ai/AiRefusalNotice', () => () => null);
jest.mock('../../../components/ai/AiDailyCapModal', () => () => null);
jest.mock('../../../services/sentry', () => ({ captureError: jest.fn() }));
jest.mock('@react-native-community/netinfo', () => ({ __esModule: true, default: { fetch: jest.fn(async () => ({ isConnected: true })) } }));

beforeEach(() => { jest.clearAllMocks(); });

it('first paint gives neutral instructions without inventing a coach, training or offline state', async () => {
  const screen = await render(<AIGuideScreen />);
  expect(await screen.findByText('Ask about training, food or recovery.')).toBeTruthy();
  expect(screen.queryByText(/Trained on|Working offline|on hand/)).toBeNull();
  expect(aiApi.getStructuredContext).not.toHaveBeenCalled();
});

it.each(['Today’s focus', 'Plan adjustments', 'Meal ideas', 'Recovery', 'Training notes'])(
  'keeps the %s shortcut sending a real request', async (prompt) => {
    const screen = await render(<AIGuideScreen />);
    await fireEvent.press(await screen.findByText(prompt));
    await screen.findByText('Training notes received.');
    expect(aiApi.chat).toHaveBeenCalledWith(prompt, []);
    expect(screen.getByText('YOU')).toBeTruthy();
    expect(screen.getByText('GUIDANCE')).toBeTruthy();
    expect(screen.getByText('Coach · Taylor')).toBeTruthy();
  },
);

it('keeps typed send, persisted history and the 44pt send action', async () => {
  jest.mocked(getChatHistory).mockResolvedValueOnce([{ id: 'old', role: 'user', text: 'Earlier question', timestamp: '2026-10-01' }]);
  const screen = await render(<AIGuideScreen />);
  await screen.findByText('Earlier question');
  await fireEvent.changeText(screen.getByPlaceholderText('Ask about training, food or recovery'), 'Next question');
  await fireEvent.press(screen.getByLabelText('Send message'));
  await screen.findByText('Training notes received.');
  await waitFor(() => expect(saveChatMessage).toHaveBeenCalledTimes(2));
  expect(aiApi.chat).toHaveBeenCalledWith('Next question', [{ role: 'user', content: 'Earlier question' }]);
  expect(StyleSheet.flatten(screen.getByLabelText('Send message').props.style)).toMatchObject({ width: 44, height: 44 });
});

it('leaves out the coach label when context returns no coach', async () => {
  jest.mocked(aiApi.getStructuredContext).mockResolvedValueOnce({ data: {} } as Awaited<ReturnType<typeof aiApi.getStructuredContext>>);
  const screen = await render(<AIGuideScreen />);
  await fireEvent.press(await screen.findByText('Recovery'));
  await screen.findByText('Training notes received.');
  expect(screen.queryByText(/Coach ·|Trained on/)).toBeNull();
});

it('does not promise automatic delivery when an offline failure restores the draft', async () => {
  jest.mocked(aiApi.chat).mockRejectedValueOnce({ code: 'ERR_NETWORK' });
  const screen = await render(<AIGuideScreen />);
  await fireEvent.press(await screen.findByText('Recovery'));
  expect(await screen.findByText('Connection unavailable. The message remains in the input.')).toBeTruthy();
  expect(screen.getByPlaceholderText('Ask about training, food or recovery').props.value).toBe('Recovery');
  expect(saveChatMessage).not.toHaveBeenCalled();
});

it('labels a returned degraded reply without claiming the device is offline', async () => {
  jest.mocked(aiApi.chat).mockResolvedValueOnce({ data: { reply: 'Limited guidance.', degraded: true } } as Awaited<ReturnType<typeof aiApi.chat>>);
  const screen = await render(<AIGuideScreen />);
  await fireEvent.press(await screen.findByText('Recovery'));
  expect(await screen.findByText('Limited guidance is available for this reply.')).toBeTruthy();
  expect(screen.queryByText(/offline mode/)).toBeNull();
});

it('a service failure shows the failure note and never says limited guidance is available', async () => {
  // FIX-RC-128 B1: a plain 503 returns no guidance at all.
  jest.mocked(aiApi.chat).mockRejectedValueOnce({ response: { status: 503, data: {} } });
  const screen = await render(<AIGuideScreen />);
  await fireEvent.press(await screen.findByText('Recovery'));
  expect(await screen.findByText(/Guidance could not answer this time because of a problem with The Growth Project service\./)).toBeTruthy();
  expect(screen.queryByText('Limited guidance is available for this reply.')).toBeNull();
});
