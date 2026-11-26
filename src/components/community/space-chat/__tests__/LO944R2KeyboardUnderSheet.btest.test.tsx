/**
 * B-TEST LO-944R2 B1 (m#944 review round 2, the Opus lens): the mic opens its sheets over a box that may still hold
 * the keyboard. The box shows the mic while it is empty, focused or not (SpaceChatComposer.tsx:70-77), and nothing on
 * the mic's path puts the keyboard away (SpaceChatMic.tsx:45; part 4's screen passes the mic as it is). A Modal does
 * not take the keyboard from the box on iOS (this unit's own Space info path puts it away first for that reason:
 * FR-897, LO-897 C1), so the keyboard stays over the foot of the sheet, where the first-use card's Record and Not now
 * sit (SpaceVoiceFirstUse.tsx:83-91) and where the record sheet's controls sit. On a 390 pt iPhone both buttons are
 * under it: the first voice note cannot be recorded or the card closed.
 * Green when a tap on the mic puts the keyboard away before either sheet shows.
 */
import React from 'react';
import { Keyboard } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('../spaceChatApi', () => ({ spaceChatApi: { getVoiceConsent: jest.fn(), recordVoiceConsent: jest.fn() } }));
const mockSheet = jest.fn();
jest.mock('../../VoiceRecordSheet', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => { mockSheet(props); return null; },
}));

import SpaceChatMic from '../SpaceChatMic';
import { spaceChatApi } from '../spaceChatApi';

const sheetOpen = () => mockSheet.mock.calls.some(([p]) => (p as { visible: boolean }).visible);

describe('B-TEST LO-944R2 B1', () => {
  it.each([
    ['the first-use card', false],
    ['the record sheet', true],
  ])('B-TEST LO-944R2 B1: a tap on the mic puts the keyboard away before %s shows', async (_what, seen) => {
    (spaceChatApi.getVoiceConsent as jest.Mock).mockResolvedValue({ seen, seen_at: seen ? '2026-11-20T10:00:00.000Z' : null });
    const dismiss = jest.spyOn(Keyboard, 'dismiss');
    try {
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      await render(
        <QueryClientProvider client={qc}>
          <SpaceChatMic cohortName="Morning crew" userId="u-1" coach={false} onSend={jest.fn()} />
        </QueryClientProvider>,
      );
      await waitFor(() => expect(spaceChatApi.getVoiceConsent).toHaveBeenCalled());
      await fireEvent.press(screen.getByTestId('space-chat-mic'));
      await waitFor(() => expect(seen ? sheetOpen() : screen.queryByTestId('space-chat-voice-first-use') !== null).toBe(true));
      expect({ sheetShown: true, keyboardPutAway: dismiss.mock.calls.length > 0 }).toEqual({ sheetShown: true, keyboardPutAway: true });
    } finally {
      dismiss.mockRestore();
      mockSheet.mockClear();
    }
  });
});
