/**
 * Sol B-324-1: the shared support email action never fails silently and
 * never leaves a rejected promise unhandled.
 */
import React from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockSetString = jest.fn();
jest.mock('expo-clipboard', () => ({ setStringAsync: (...a: unknown[]) => mockSetString(...a) }));

import {
  SUPPORT_EMAIL_COPY,
  SupportEmailFallback,
  supportEmailStatusText,
  useSupportEmail,
} from '../SupportEmailFallback';
import { SUPPORT_EMAIL } from '../../../constants/support';

function Host({ subject }: { subject?: string }) {
  const email = useSupportEmail(subject);
  return (
    <View>
      <Pressable testID="open" onPress={() => void email.open()}>
        <Text>Email support</Text>
      </Pressable>
      <Text testID="state">{email.state}</Text>
      <SupportEmailFallback handle={email} linkColor="#000000" testID="fb" />
    </View>
  );
}

describe('SupportEmailFallback', () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  beforeAll(() => process.on('unhandledRejection', onUnhandled));
  afterAll(() => process.off('unhandledRejection', onUnhandled));
  beforeEach(() => {
    unhandled.length = 0;
    // Linking.openURL is already a jest.fn in the RN preset; spyOn reuses it.
    jest.clearAllMocks();
    mockSetString.mockReset();
  });
  afterEach(() => jest.restoreAllMocks());

  it('opens a draft to SUPPORT_EMAIL with the encoded subject and shows nothing extra', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const r = await render(<Host subject="Support request" />);
    await fireEvent.press(r.getByTestId('open'));
    expect(openURL).toHaveBeenCalledWith(`mailto:${SUPPORT_EMAIL}?subject=Support%20request`);
    expect(r.queryByTestId('fb')).toBeNull();
  });

  it('a rejected mail intent shows the failure, the selectable address, Copy and Try again', async () => {
    jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no mail app'));
    const r = await render(<Host />);
    await fireEvent.press(r.getByTestId('open'));
    await waitFor(() => r.getByTestId('fb'));
    expect(r.getByTestId('fb-status').props.children).toBe(SUPPORT_EMAIL_COPY.failed);
    expect(r.getByTestId('fb-status').props.accessibilityRole).toBe('alert');
    const address = r.getByTestId('fb-address');
    expect(address.props.selectable).toBe(true);
    expect(address.props.children).toBe(SUPPORT_EMAIL);
    expect(r.getByTestId('fb-copy').props.accessibilityLabel).toBe(`Copy ${SUPPORT_EMAIL}`);
    expect(r.getByTestId('fb-retry')).toBeTruthy();
    await new Promise((resolve) => setImmediate(resolve));
    expect(unhandled).toEqual([]);
  });

  it('Copy reports success, a refused copy and a thrown copy in words', async () => {
    jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no mail app'));
    const r = await render(<Host />);
    await fireEvent.press(r.getByTestId('open'));
    await waitFor(() => r.getByTestId('fb'));

    mockSetString.mockResolvedValueOnce(true);
    await fireEvent.press(r.getByTestId('fb-copy'));
    await waitFor(() => expect(r.getByTestId('fb-status').props.children).toBe(SUPPORT_EMAIL_COPY.copied));
    expect(mockSetString).toHaveBeenLastCalledWith(SUPPORT_EMAIL);

    mockSetString.mockResolvedValueOnce(false);
    await fireEvent.press(r.getByTestId('fb-copy'));
    await waitFor(() => expect(r.getByTestId('fb-status').props.children).toBe(SUPPORT_EMAIL_COPY.copyFailed));

    mockSetString.mockResolvedValueOnce(true);
    await fireEvent.press(r.getByTestId('fb-copy'));
    await waitFor(() => expect(r.getByTestId('fb-status').props.children).toBe(SUPPORT_EMAIL_COPY.copied));

    mockSetString.mockRejectedValueOnce(new Error('clipboard unavailable'));
    await fireEvent.press(r.getByTestId('fb-copy'));
    await waitFor(() => expect(r.getByTestId('fb-status').props.children).toBe(SUPPORT_EMAIL_COPY.copyFailed));
    // The address stays on screen in every state.
    expect(r.getByTestId('fb-address').props.children).toBe(SUPPORT_EMAIL);
    await new Promise((resolve) => setImmediate(resolve));
    expect(unhandled).toEqual([]);
  });

  it('Try again retries; it hides the fallback once the email app opens', async () => {
    const openURL = jest
      .spyOn(Linking, 'openURL')
      .mockRejectedValueOnce(new Error('no mail app'))
      .mockRejectedValueOnce(new Error('still no mail app'))
      .mockResolvedValueOnce(true);
    const r = await render(<Host subject="Help" />);
    await fireEvent.press(r.getByTestId('open'));
    await waitFor(() => r.getByTestId('fb'));
    await fireEvent.press(r.getByTestId('fb-retry'));
    await waitFor(() => expect(openURL).toHaveBeenCalledTimes(2));
    expect(r.getByTestId('fb-status').props.children).toBe(SUPPORT_EMAIL_COPY.failed);
    await fireEvent.press(r.getByTestId('fb-retry'));
    await waitFor(() => expect(r.queryByTestId('fb')).toBeNull());
    expect(openURL).toHaveBeenCalledTimes(3);
    expect(openURL).toHaveBeenLastCalledWith(`mailto:${SUPPORT_EMAIL}?subject=Help`);
  });

  it('copy follows the shipped-copy rules (no exclamation marks, no generic failure lines)', () => {
    for (const state of ['failed', 'copied', 'copy_failed'] as const) {
      const text = supportEmailStatusText(state) ?? '';
      expect(text.length).toBeGreaterThan(20);
      expect(text).not.toMatch(/!/);
      expect(text).not.toMatch(/something went wrong/i);
    }
    expect(supportEmailStatusText('idle')).toBeNull();
  });
});
