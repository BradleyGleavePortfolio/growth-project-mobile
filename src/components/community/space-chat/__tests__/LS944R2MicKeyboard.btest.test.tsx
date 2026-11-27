/**
 * B-TEST LS-944R2 B1 (m#944 review round 2, the LS seat): the mic opens the 08a first-use card, and later the record
 * sheet, with the keyboard still up. Both are transparent Modals with their only controls at the foot
 * (SpaceVoiceFirstUse.tsx:68, :83-91; VoiceRecordSheet.tsx:24), the card has no scrim tap and no other way out on iOS,
 * and nothing on the mic's path puts the keyboard away (SpaceChatMic.tsx:45). So with the box focused and empty, the
 * keyboard covers Not now and most or all of Record. Part 4 already puts the keyboard away before Space info and the
 * message sheet (FR-897, LO-897 C1: "the sheet never opens under the keyboard").
 * Green when the keyboard is put away by the time the card or the record sheet opens.
 * FIX-944R3 (owner #ALM-E11; the operator's ruling in FIX-944R3's job): the first-use card is gone, so its row is retired
 * with it, and the mic asks the server nothing first, so the record sheet's row taps at once (no first-use answer to
 * wait for). The record sheet's row, its title and its check are as they were.
 */
import React from 'react';
import { Keyboard } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockSheet = jest.fn();
jest.mock('../../VoiceRecordSheet', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => { mockSheet(props); return null; },
}));

import SpaceChatMic from '../SpaceChatMic';

describe('B-TEST LS-944R2 B1', () => {
  it.each([
    ['the record sheet'],
  ])('B-TEST LS-944R2 B1: the mic puts the keyboard away before %s opens', async () => {
    mockSheet.mockClear();
    const dismiss = jest.spyOn(Keyboard, 'dismiss');
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    try {
      const r = await render(
        <QueryClientProvider client={qc}>
          <SpaceChatMic cohortName="Everyone" userId="u-1" coach={false} onSend={jest.fn()} />
        </QueryClientProvider>,
      );
      await fireEvent.press(r.getByTestId('space-chat-mic'));
      const opened = mockSheet.mock.calls.some(([p]) => (p as { visible: boolean }).visible);
      expect({ opened, keyboardPutAway: dismiss.mock.calls.length > 0 }).toEqual({ opened: true, keyboardPutAway: true });
    } finally {
      dismiss.mockRestore();
      qc.clear();
    }
  });
});
