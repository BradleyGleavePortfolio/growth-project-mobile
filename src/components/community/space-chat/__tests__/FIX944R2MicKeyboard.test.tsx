/**
 * FIX-944R2 (m#944 fix round 2): LO-944R2 B1 = LS-944R2 B1, the cases beside the two B-TESTs
 * (LO944R2KeyboardUnderSheet.btest.test.tsx, LS944R2MicKeyboard.btest.test.tsx), with their stubs and the same spy.
 * The mic puts the keyboard away (react-native's Keyboard.dismiss) at the moment it opens the record sheet; nothing
 * else on the mic or the box puts it away (typing, Send, a reply, a refused text coming back, opening or leaving the
 * space).
 *   d: guards, green before and after the fix.
 * FIX-944R3 (owner #ALM-E11; the operator's ruling in FIX-944R3's job): the 08a first-use card is gone and the mic asks
 * the server nothing first, so the cases that pinned the card or the first-use answer are retired with them: b (a tap
 * before the answer, opening the card or the record sheet), c (the coach's card), d's answer cases (mounted with the
 * answer in, then a refetch; the answer changing with no tap), d's iOS and Android card paths (Not now, Record, the
 * card's onDismiss) and d's per-tap counts (whose taps opened the card). What they held for the record sheet (one call
 * per tap, made before the sheet is drawn, for a member and for the coach, on iOS and Android) is checked on every tap
 * of FIX944R3NoFirstUseCard.test.tsx, and the B-TESTs' record-sheet rows stay. d's mounted guard has no answer to wait
 * for now; d's box guard is as it was.
 */
import React from 'react';
import { Alert, Keyboard } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('../spaceChatApi', () => ({ SPACE_MESSAGE_MAX: 4000 }));
const mockSheet = jest.fn();
jest.mock('../../VoiceRecordSheet', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => { mockSheet(props); return null; },
}));
// The box's own stores, as spaceChatComposeKT2 stubs them (d's composer cases only).
const mockDrafts: Record<string, string> = {};
jest.mock('../../../../lib/chatDrafts', () => {
  const ReactActual = jest.requireActual('react');
  return {
    useChatDraft: (key: string) => {
      const [, bump] = ReactActual.useState(0);
      return [mockDrafts[key] ?? '', (v: string) => { mockDrafts[key] = v; bump((n: number) => n + 1); }];
    },
  };
});
const mockRows: { localId: string; state: string; reason?: string; body: string; reply?: unknown }[] = [];
jest.mock('../spaceChatOutbox', () => ({
  REJECTED_WORDS: { title: 'Not sent', message: 'Change it and send again.' },
  spaceOutbox: { discard: jest.fn() },
  useSpaceOutbox: () => mockRows,
}));
jest.mock('../../../messaging/ReplyComposer', () => ({ ReplyComposer: () => null }));

import SpaceChatMic from '../SpaceChatMic';
import SpaceChatComposer from '../SpaceChatComposer';

const sheetOpen = () => mockSheet.mock.calls.some(([p]) => (p as { visible: boolean }).visible);
const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

let dismiss: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  mockSheet.mockClear();
  for (const k of Object.keys(mockDrafts)) delete mockDrafts[k];
  mockRows.length = 0;
  dismiss = jest.spyOn(Keyboard, 'dismiss');
});
afterEach(() => {
  dismiss.mockRestore();
});

describe('FIX-944R2 d: nothing else puts the keyboard away (guards)', () => {
  it('d: the mic mounted and nothing pressed calls Keyboard.dismiss no time', async () => {
    const qc = newClient();
    const mic = (
      <QueryClientProvider client={qc}>
        <SpaceChatMic cohortName="Morning crew" userId="u-1" coach={false} onSend={jest.fn()} />
      </QueryClientProvider>
    );
    const r = await render(mic);
    await r.rerender(mic);
    expect({ sheet: sheetOpen(), calls: dismiss.mock.calls.length }).toEqual({ sheet: false, calls: 0 });
    await r.unmount();
    expect(dismiss.mock.calls.length).toBe(0);
    qc.clear();
  });

  it('d: the box with the mic as its trailing control: opening, typing, Send, a reply and a refused text coming back call it no time', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const qc = newClient();
    const onSend = jest.fn();
    const box = (reply: { id: string; body: string; authorLabel: string } | null) => (
      <QueryClientProvider client={qc}>
        <SpaceChatComposer
          cohortId="space-1"
          onSend={onSend}
          reply={reply}
          onReply={jest.fn()}
          trailing={reply ? undefined : <SpaceChatMic cohortName="Morning crew" userId="u-1" coach={false} onSend={jest.fn()} />}
        />
      </QueryClientProvider>
    );
    try {
      const r = await render(box(null));
      expect(r.getByTestId('space-chat-mic')).toBeTruthy();
      await fireEvent.changeText(r.getByTestId('space-chat-composer-field'), 'on my way');
      expect(r.queryByTestId('space-chat-mic')).toBeNull();
      await fireEvent.press(r.getByTestId('space-chat-composer-send'));
      expect(onSend).toHaveBeenCalledWith('on my way');
      expect(r.getByTestId('space-chat-mic')).toBeTruthy();
      await r.rerender(box({ id: 'm-1', body: 'see you there', authorLabel: 'Sam' }));
      await r.rerender(box(null));
      mockRows.push({ localId: 'l-1', state: 'failed', reason: 'rejected', body: 'refused words' });
      await r.rerender(box(null));
      await waitFor(() => expect(r.getByTestId('space-chat-composer-field').props.value).toBe('refused words'));
      expect(alert).toHaveBeenCalledTimes(1);
      await r.unmount();
      expect(dismiss.mock.calls.length).toBe(0);
    } finally {
      alert.mockRestore();
      qc.clear();
    }
  });
});
