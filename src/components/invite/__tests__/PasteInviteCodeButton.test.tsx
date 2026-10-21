/**
 * INVITE-PASTE-CODE: "Paste code" carries the code from the /join page's
 * "Copy code" into the app on first open. The clipboard is read only on a tap.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import PasteInviteCodeButton, { PASTE_EMPTY_MESSAGE } from '../PasteInviteCodeButton';

const mockGetString = jest.fn();
jest.mock('expo-clipboard', () => ({ getStringAsync: () => mockGetString() }));

const mockSelection = jest.fn();
const mockWarning = jest.fn();
jest.mock('../../../ui/haptics/haptics.service', () => ({
  HapticService: { selection: () => mockSelection(), warning: () => mockWarning() },
}));

jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ semanticColors: jest.requireActual('../../../theme/tokens').lightTokens }),
}));

beforeEach(() => {
  mockGetString.mockReset();
  mockSelection.mockReset();
  mockWarning.mockReset();
});

async function renderButton(props: { disabled?: boolean } = {}) {
  const onCode = jest.fn();
  const onNoCode = jest.fn();
  await render(<PasteInviteCodeButton onCode={onCode} onNoCode={onNoCode} {...props} />);
  return { onCode, onNoCode, button: screen.getByTestId('paste-invite-code') };
}

describe('INVITE-PASTE-CODE PasteInviteCodeButton', () => {
  it('shows "Paste code" as a 44 pt button and never reads the clipboard without a tap', async () => {
    const { button } = await renderButton();
    expect(screen.getByRole('button', { name: 'Paste code' })).toBeTruthy();
    expect(StyleSheet.flatten(button.props.style).minHeight).toBeGreaterThanOrEqual(44);
    expect(mockGetString).not.toHaveBeenCalled();
  });

  it('a tap reads the clipboard once, fills the field with the code and ticks', async () => {
    mockGetString.mockResolvedValue('  TGP-K7M2QX3 ');
    const { onCode, onNoCode, button } = await renderButton();
    await fireEvent.press(button);
    await waitFor(() => expect(onCode).toHaveBeenCalledWith('TGP-K7M2QX3'));
    expect(mockGetString).toHaveBeenCalledTimes(1);
    expect(mockSelection).toHaveBeenCalledTimes(1);
    expect(mockWarning).not.toHaveBeenCalled();
    expect(onNoCode).not.toHaveBeenCalled();
  });

  it('a copied join link fills the code inside it', async () => {
    mockGetString.mockResolvedValue('https://app.trygrowthproject.com/join/TGP-K7M2QX3');
    const { onCode, button } = await renderButton();
    await fireEvent.press(button);
    await waitFor(() => expect(onCode).toHaveBeenCalledWith('TGP-K7M2QX3'));
  });

  it.each([
    ['text with no code', 'see you at the gym'],
    ['an empty clipboard', ''],
  ])('%s shows the existing no-code line and fills nothing', async (_label, clip) => {
    mockGetString.mockResolvedValue(clip);
    const { onCode, onNoCode, button } = await renderButton();
    await fireEvent.press(button);
    await waitFor(() => expect(onNoCode).toHaveBeenCalledWith(PASTE_EMPTY_MESSAGE));
    expect(onCode).not.toHaveBeenCalled();
    expect(mockWarning).toHaveBeenCalledTimes(1);
    expect(mockSelection).not.toHaveBeenCalled();
  });

  it('an unreadable clipboard (paste refused) is handled like an empty one', async () => {
    mockGetString.mockRejectedValue(new Error('denied'));
    const { onCode, onNoCode, button } = await renderButton();
    await fireEvent.press(button);
    await waitFor(() => expect(onNoCode).toHaveBeenCalledWith(PASTE_EMPTY_MESSAGE));
    expect(onCode).not.toHaveBeenCalled();
  });

  it('disabled: a tap reads nothing', async () => {
    const { onCode, button } = await renderButton({ disabled: true });
    await fireEvent.press(button);
    expect(mockGetString).not.toHaveBeenCalled();
    expect(onCode).not.toHaveBeenCalled();
  });
});
