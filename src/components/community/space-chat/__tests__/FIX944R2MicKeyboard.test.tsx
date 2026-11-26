/**
 * FIX-944R2 (m#944 fix round 2): LO-944R2 B1 = LS-944R2 B1, the cases beside the two B-TESTs
 * (LO944R2KeyboardUnderSheet.btest.test.tsx, LS944R2MicKeyboard.btest.test.tsx), with their stubs and the same spy.
 * The mic puts the keyboard away (react-native's Keyboard.dismiss) at the moment it opens the 08a first-use card or the
 * record sheet, for a member and for the coach, also when the tap came before the server's first-use answer; nothing
 * else on the mic, the card or the box puts it away (typing, Send, a reply, a refused text coming back, opening or
 * leaving the space, the card's Record and Not now, the answer arriving or changing).
 *   b: a tap before the answer: the keyboard goes down when the answer opens a sheet, before that sheet is drawn.
 *   c: the coach's two-line card.
 *   d: guards, green before and after the fix; and exactly one call per tap that opens a sheet (red before: no call).
 *   e (kept, covered elsewhere): the card before any recorder and the iOS one-Modal order (spaceChatVoice "first time:
 *      the 08a card, not the sheet; ..."), the record sheet after first use and the label "Record a voice note"
 *      (spaceChatVoice "opens the record sheet aimed at this space and hands the recording on"), the testID
 *      space-chat-mic (both suites, spaceChatComposeKT2 "KT-2: the mic opens no recorder until the first-use card is
 *      answered, ...").
 */
import React from 'react';
import { Alert, Keyboard, Platform } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('../spaceChatApi', () => ({
  SPACE_MESSAGE_MAX: 4000,
  spaceChatApi: { getVoiceConsent: jest.fn(), recordVoiceConsent: jest.fn() },
}));
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
import { voiceConsentKey } from '../SpaceVoiceFirstUse';
import { spaceChatApi } from '../spaceChatApi';

const CARD = 'space-chat-voice-first-use';
const consent = spaceChatApi.getVoiceConsent as jest.Mock;
const answerOf = (seen: boolean) => ({ seen, seen_at: seen ? '2026-11-20T10:00:00.000Z' : null });
const sheetOpen = () => mockSheet.mock.calls.some(([p]) => (p as { visible: boolean }).visible);
const lastSheet = () => mockSheet.mock.calls[mockSheet.mock.calls.length - 1][0] as { visible: boolean; onClose: () => void };
const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

type Shown = () => boolean;
function mic(qc: QueryClient, coach = false) {
  return render(
    <QueryClientProvider client={qc}>
      <SpaceChatMic cohortName="Morning crew" userId="u-1" coach={coach} onSend={jest.fn()} />
    </QueryClientProvider>,
  );
}
// The card's Modal, for its onDismiss (iOS: the card has finished closing), as spaceChatVoice finds it.
type El = { props: { onDismiss?: () => void }; parent: El | null };
function cardDismiss(r: { getByTestId: (id: string) => unknown }): (() => void) | undefined {
  let el = r.getByTestId(CARD) as El | null;
  while (el && !el.props.onDismiss) el = el.parent;
  return el?.props.onDismiss;
}

let dismiss: jest.SpyInstance;
const realOS = Platform.OS;
const setOS = (os: string) => Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
beforeEach(() => {
  jest.clearAllMocks();
  mockSheet.mockClear();
  for (const k of Object.keys(mockDrafts)) delete mockDrafts[k];
  mockRows.length = 0;
  (spaceChatApi.recordVoiceConsent as jest.Mock).mockResolvedValue(answerOf(true));
  dismiss = jest.spyOn(Keyboard, 'dismiss');
});
afterEach(() => {
  dismiss.mockRestore();
  setOS(realOS);
});

describe('FIX-944R2 b: a tap before the first-use answer', () => {
  it.each([
    ['the first-use card', false],
    ['the record sheet', true],
  ])('b: a tap before the answer puts the keyboard away when the answer opens %s, before it is drawn', async (_what, seen) => {
    let answer: (v: unknown) => void = () => undefined;
    consent.mockImplementationOnce(() => new Promise((res) => { answer = res; }));
    let shown: Shown = () => false;
    const drawnAtCall: boolean[] = [];
    dismiss.mockImplementation(() => { drawnAtCall.push(shown()); });
    const qc = newClient();
    const r = await mic(qc);
    shown = seen ? sheetOpen : () => r.queryByTestId(CARD) !== null;
    await waitFor(() => expect(consent).toHaveBeenCalledTimes(1));
    await fireEvent.press(r.getByTestId('space-chat-mic'));
    expect(shown()).toBe(false);
    dismiss.mockClear();
    drawnAtCall.length = 0;
    await act(async () => { answer(answerOf(seen)); });
    await waitFor(() => expect(shown()).toBe(true));
    expect({ calls: dismiss.mock.calls.length, drawnAtCall }).toEqual({ calls: 1, drawnAtCall: [false] });
    await r.unmount();
    qc.clear();
  });
});

describe('FIX-944R2 c: the coach', () => {
  it('c: a tap on the mic puts the keyboard away before the coach\'s two-line card shows', async () => {
    consent.mockResolvedValue(answerOf(false));
    const qc = newClient();
    const r = await mic(qc, true);
    await waitFor(() => expect(consent).toHaveBeenCalled());
    await fireEvent.press(r.getByTestId('space-chat-mic'));
    await waitFor(() => expect(r.queryByTestId(CARD)).not.toBeNull());
    expect({
      reportLine: r.queryByText(/If someone reports a voice note/) !== null,
      keyboardPutAway: dismiss.mock.calls.length > 0,
    }).toEqual({ reportLine: false, keyboardPutAway: true });
    await r.unmount();
    qc.clear();
  });
});

describe('FIX-944R2 d: nothing else puts the keyboard away (guards), and one call per tap that opens a sheet', () => {
  it.each([
    ['seen false', false],
    ['seen true', true],
  ])('d: the mic mounted with the answer in (%s) and nothing pressed calls Keyboard.dismiss no time', async (_what, seen) => {
    consent.mockResolvedValue(answerOf(seen));
    const qc = newClient();
    const r = await mic(qc);
    await waitFor(() => expect(consent).toHaveBeenCalled());
    await act(async () => { await qc.refetchQueries({ queryKey: voiceConsentKey('u-1') }); });
    expect({ card: r.queryByTestId(CARD) !== null, sheet: sheetOpen(), calls: dismiss.mock.calls.length })
      .toEqual({ card: false, sheet: false, calls: 0 });
    await r.unmount();
    qc.clear();
  });

  it('d: the answer changing (a refetch, seen false to true, true to false) with no tap calls it no time', async () => {
    consent.mockResolvedValue(answerOf(false));
    const qc = newClient();
    const r = await mic(qc);
    await waitFor(() => expect(consent).toHaveBeenCalledTimes(1));
    consent.mockResolvedValue(answerOf(true));
    await act(async () => { await qc.refetchQueries({ queryKey: voiceConsentKey('u-1') }); });
    await act(async () => { qc.setQueryData(voiceConsentKey('u-1'), answerOf(false)); });
    await act(async () => { qc.setQueryData(voiceConsentKey('u-1'), answerOf(true)); });
    expect({ card: r.queryByTestId(CARD) !== null, sheet: sheetOpen(), calls: dismiss.mock.calls.length })
      .toEqual({ card: false, sheet: false, calls: 0 });
    await r.unmount();
    qc.clear();
  });

  // The mic's whole path on one platform: each tap that opens a sheet, and each control that must not put the keyboard
  // away, as the number of calls it adds. iOS: the card, Not now, the card again, Record, the card's onDismiss (the record
  // sheet after the card), the record sheet from the mic. Android: the card, Record (the record sheet at once).
  async function micPath(os: 'ios' | 'android') {
    setOS(os);
    consent.mockResolvedValue(answerOf(false));
    const qc = newClient();
    const r = await mic(qc);
    await waitFor(() => expect(consent).toHaveBeenCalled());
    const taps: number[] = [];
    const others: Record<string, number> = {};
    let n = dismiss.mock.calls.length;
    const added = () => { const k = dismiss.mock.calls.length - n; n = dismiss.mock.calls.length; return k; };
    await fireEvent.press(r.getByTestId('space-chat-mic'));
    await waitFor(() => expect(r.queryByTestId(CARD)).not.toBeNull());
    taps.push(added());
    if (os === 'ios') {
      await fireEvent.press(r.getByTestId(`${CARD}-not-now`));
      others.notNow = added();
      await fireEvent.press(r.getByTestId('space-chat-mic'));
      await waitFor(() => expect(r.queryByTestId(CARD)).not.toBeNull());
      taps.push(added());
    }
    const onDismiss = cardDismiss(r);
    await fireEvent.press(r.getByTestId(`${CARD}-record`));
    others.record = added();
    if (os === 'ios') {
      const beforeDismiss = sheetOpen();
      await act(async () => { onDismiss?.(); });
      others.sheetAfterCard = added();
      others.openBeforeDismiss = beforeDismiss ? 1 : 0;
    }
    const sheetAfterCard = sheetOpen();
    if (os === 'ios') {
      await act(async () => { lastSheet().onClose(); });
      await fireEvent.press(r.getByTestId('space-chat-mic'));
      await waitFor(() => expect(lastSheet().visible).toBe(true));
      taps.push(added());
    }
    await r.unmount();
    qc.clear();
    return { taps, others, sheetAfterCard };
  }

  it('d (iOS): Not now, Record (seen false to true) and the record sheet after the card call Keyboard.dismiss no time', async () => {
    const { others, sheetAfterCard } = await micPath('ios');
    expect({ others, sheetAfterCard }).toEqual({ others: { notNow: 0, record: 0, sheetAfterCard: 0, openBeforeDismiss: 0 }, sheetAfterCard: true });
  });

  it('d (Android): Record opens the record sheet at once and calls Keyboard.dismiss no time', async () => {
    const { others, sheetAfterCard } = await micPath('android');
    expect({ others, sheetAfterCard }).toEqual({ others: { record: 0 }, sheetAfterCard: true });
  });

  it.each([['ios', 3], ['android', 1]] as const)('d (%s): exactly one call per mic tap that opens a sheet', async (os, count) => {
    const { taps } = await micPath(os);
    expect(taps).toEqual(Array(count).fill(1));
  });

  it('d: the box with the mic as its trailing control: opening, typing, Send, a reply and a refused text coming back call it no time', async () => {
    consent.mockResolvedValue(answerOf(true));
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
      await waitFor(() => expect(consent).toHaveBeenCalled());
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
