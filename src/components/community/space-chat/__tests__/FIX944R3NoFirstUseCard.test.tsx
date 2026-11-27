/**
 * FIX-944R3 (m#944 fix round 3). Owner #ALM-E11, answering #ALM-D2: "if i go into a space and click the mic button for a
 * voice note i DONT want that fat card to come up ever". The 08a first-use card (SpaceVoiceFirstUse) is gone, and with it
 * the tests that pinned it (the operator's ruling in FIX-944R3's job: FIX944R1FirstUseSizes, LS944R1FirstUseFits and the
 * card cases of the round 1 and round 2 tests). This one table walks every path that could show the card at 3ee287ef:
 *   - who: a member, and the coach (whose card had two lines);
 *   - what the server would say to the first-use read, if the phone asked: the first time, after a first note, not in
 *     yet, the read fails, offline;
 *   - iOS and Android (Record on the card opened the sheet on its onDismiss on iOS, at once on Android);
 *   - the mic alone, and the mic in the box while the box holds the keyboard;
 *   - every tap: the first, again after Cancel, again after a sent note, and the first tap of a new session for another
 *     person on the same phone.
 * On every tap: no card and no other Modal; the record sheet open on that tap, aimed at this space, with its own audience
 * line; the keyboard put away once and before the sheet is drawn (FIX-944R2's rule, kept); the microphone asked only as
 * the sheet opens (VoiceNoteComposer starts recording as it opens, as it did after Record on the card); and the phone
 * sends no request at all (no GET or POST community/voice-consent).
 */
import React from 'react';
import { Keyboard, Platform } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

jest.mock('../../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../../theme/tokens');
  return { useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }) };
});
jest.mock('../../../HapticPressable', () => {
  const ReactActual = jest.requireActual('react');
  return {
    __esModule: true,
    default: ({ children, ...props }: { children?: unknown }) => ReactActual.createElement('HapticPressableHost', props, children),
  };
});
// The wire, below every client: whatever asks the server goes through here.
const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock('../../../../services/api', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => mockGet(...a), post: (...a: unknown[]) => mockPost(...a), delete: jest.fn() },
}));
// The real record sheet with a stand-in microphone; its props are kept to read what the mic asked of it.
const mockSheet = jest.fn();
const mockMic: { recorder: unknown } = { recorder: null };
jest.mock('../../VoiceRecordSheet', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    mockSheet(props);
    const Real = jest.requireActual('../../VoiceRecordSheet').default;
    return jest.requireActual('react').createElement(Real, { ...props, recorder: mockMic.recorder });
  },
}));
// The box's own stores, as spaceChatComposeKT2 stubs them.
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
jest.mock('../spaceChatOutbox', () => ({
  REJECTED_WORDS: { title: 'Not sent', message: 'Change it and send again.' },
  spaceOutbox: { discard: jest.fn() },
  useSpaceOutbox: () => [],
}));
jest.mock('../../../messaging/ReplyComposer', () => ({ ReplyComposer: () => null }));

import SpaceChatMic from '../SpaceChatMic';
import SpaceChatComposer from '../SpaceChatComposer';

const SPACE = 'Morning crew';
const CONSENT = /voice-consent/;
type Answer = 'the first time' | 'after a first note' | 'not in yet' | 'the read fails' | 'offline';
const ANSWERS: Answer[] = ['the first time', 'after a first note', 'not in yet', 'the read fails', 'offline'];
type Where = 'the mic alone' | 'the mic in the box holding the keyboard';
const WHERES: Where[] = ['the mic alone', 'the mic in the box holding the keyboard'];
const PATHS = (['member', 'coach'] as const).flatMap((who) => (['ios', 'android'] as const).flatMap((os) =>
  ANSWERS.flatMap((answer) => WHERES.map((where) => [who, os, answer, where] as const))));

/** What the server would say to GET or POST community/voice-consent, if the phone asked. */
function serverWouldAnswer(answer: Answer) {
  const network = Object.assign(new Error('Network Error'), { isAxiosError: true, code: 'ERR_NETWORK' });
  const failed = Object.assign(new Error('Request failed with status code 500'), {
    isAxiosError: true, response: { status: 500, data: {} },
  });
  const reply = (url: string) => {
    if (!CONSENT.test(url)) return Promise.reject(new Error(`no route in this test: ${url}`));
    if (answer === 'the first time') return Promise.resolve({ data: { seen: false, seen_at: null } });
    if (answer === 'after a first note') return Promise.resolve({ data: { seen: true, seen_at: '2026-11-20T10:00:00.000Z' } });
    if (answer === 'not in yet') return new Promise(() => undefined);
    return Promise.reject(answer === 'offline' ? network : failed);
  };
  mockGet.mockImplementation(reply);
  mockPost.mockImplementation(reply);
}

/** A microphone that asks the phone once (undetermined, then granted) and records. */
function standInMicrophone() {
  let granted = false;
  return {
    isAvailable: true,
    getPermissionStatus: jest.fn(async () => (granted ? 'granted' : 'undetermined')),
    requestPermission: jest.fn(async () => { granted = true; return 'granted'; }),
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue({ uri: 'file:///r.m4a', durationMs: 4000 }),
    cancel: jest.fn().mockResolvedValue(undefined),
  };
}

type Node = { type: string; props: Record<string, unknown>; children: (Node | string)[] | null };
function nodes(tree: unknown): Node[] {
  const out: Node[] = [];
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    out.push(n as Node);
    ((n as Node).children ?? []).forEach(walk);
  };
  walk(tree);
  return out;
}
const texts = (all: Node[]) => all.flatMap((n) => (n.children ?? []).filter((c): c is string => typeof c === 'string'));
const lastSheet = () => (mockSheet.mock.calls.length
  ? mockSheet.mock.calls[mockSheet.mock.calls.length - 1][0] as { visible: boolean; target: unknown; onClose: () => void; onSend: (r: unknown) => void }
  : null);

const realOS = Platform.OS;
const setOS = (os: string) => Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
afterEach(() => {
  setOS(realOS);
  onlineManager.setOnline(true);
});

describe('FIX-944R3: no first-use card on any path; the mic opens the record sheet on the tap', () => {
  it.each(PATHS)('%s, %s, the server would say "%s", %s: no card, the record sheet on every tap, no voice-consent request', async (who, os, answer, where) => {
    jest.clearAllMocks();
    for (const k of Object.keys(mockDrafts)) delete mockDrafts[k];
    setOS(os);
    if (answer === 'offline') onlineManager.setOnline(false);
    serverWouldAnswer(answer);
    const microphone = standInMicrophone();
    mockMic.recorder = microphone;
    const dismiss = jest.spyOn(Keyboard, 'dismiss');
    const drawnAtCall: boolean[] = [];
    dismiss.mockImplementation(() => { drawnAtCall.push(lastSheet()?.visible === true); });
    const onSend = jest.fn();
    const screenFor = (qc: QueryClient, userId: string) => {
      const mic = <SpaceChatMic cohortName={SPACE} userId={userId} coach={who === 'coach'} onSend={onSend} />;
      return (
        <SafeAreaInsetsContext.Provider value={{ top: 47, right: 0, bottom: 34, left: 0 }}>
          <QueryClientProvider client={qc}>
            {where === 'the mic alone' ? mic : <SpaceChatComposer cohortId="space-1" onSend={jest.fn()} trailing={mic} />}
          </QueryClientProvider>
        </SafeAreaInsetsContext.Provider>
      );
    };
    const seen: Record<string, unknown>[] = [];
    // One tap on the mic, then what the screen holds.
    const tap = async (r: Awaited<ReturnType<typeof render>>, step: string) => {
      if (where !== 'the mic alone') await fireEvent(r.getByTestId('space-chat-composer-field'), 'focus');
      const before = dismiss.mock.calls.length;
      const started = microphone.start.mock.calls.length;
      await fireEvent.press(r.getByTestId('space-chat-mic'));
      // The sheet starts recording as it opens; at 3ee287ef the card came first, so nothing started.
      const recorded = await waitFor(() => expect(microphone.start.mock.calls.length).toBe(started + 1)).then(() => true, () => false);
      const all = nodes(r.toJSON());
      const shown = texts(all);
      seen.push({
        step,
        card: all.some((n) => String(n.props.testID ?? '').startsWith('space-chat-voice-first-use'))
          || shown.includes('Voice notes') || shown.some((t) => /reports a voice note|delete your voice note/.test(t)),
        modals: all.filter((n) => n.type === 'Modal').length,
        sheet: lastSheet()?.visible === true && r.queryByTestId('voice-record-sheet') !== null,
        aimedAt: lastSheet()?.target,
        audienceLine: r.queryByTestId('voice-privacy-text')?.props.children ?? null,
        keyboardAway: dismiss.mock.calls.length - before,
        drawnAtCall: drawnAtCall[drawnAtCall.length - 1],
        recorded,
        phoneAsked: microphone.requestPermission.mock.calls.length,
      });
    };
    const close = async () => { await act(async () => { lastSheet()?.onClose(); }); };

    try {
      const first = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const r = await render(screenFor(first, 'u-1'));
      await act(async () => { await Promise.resolve(); });
      // Nothing is drawn, recorded or asked before her tap.
      expect({
        sheet: r.queryByTestId('voice-record-sheet'),
        modals: nodes(r.toJSON()).filter((n) => n.type === 'Modal').length,
        asked: microphone.getPermissionStatus.mock.calls.length,
      }).toEqual({ sheet: null, modals: 0, asked: 0 });
      await tap(r, 'first tap');
      await close();
      await tap(r, 'again after Cancel');
      const recording = { uri: 'file:///note.m4a', durationMs: 4000 };
      await act(async () => { lastSheet()?.onSend(recording); });
      const sent = { handedOn: onSend.mock.calls, sheetClosed: lastSheet()?.visible === false };
      await tap(r, 'again after a sent note');
      await close();
      await r.unmount();
      first.clear();
      const next = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const again = await render(screenFor(next, 'u-2'));
      await tap(again, 'a new session, another person');
      await again.unmount();
      next.clear();

      const each = {
        card: false, modals: 1, sheet: true, aimedAt: { kind: 'cohort', cohortName: SPACE },
        audienceLine: `Everyone in ${SPACE} can hear this voice note.`,
        keyboardAway: 1, drawnAtCall: false, recorded: true, phoneAsked: 1,
      };
      expect(seen).toEqual([
        { step: 'first tap', ...each },
        { step: 'again after Cancel', ...each },
        { step: 'again after a sent note', ...each },
        { step: 'a new session, another person', ...each },
      ]);
      // Cancel, a sent note, leaving and coming back put the keyboard away no time: one call per tap, four taps.
      expect({
        sent,
        keyboardCalls: dismiss.mock.calls.length,
        voiceConsent: [...mockGet.mock.calls, ...mockPost.mock.calls].filter(([url]) => CONSENT.test(String(url))).length,
        requests: [...mockGet.mock.calls, ...mockPost.mock.calls].map(([url]) => String(url)),
      }).toEqual({ sent: { handedOn: [[recording]], sheetClosed: true }, keyboardCalls: 4, voiceConsent: 0, requests: [] });
    } finally {
      dismiss.mockRestore();
      mockMic.recorder = null;
    }
  }, 30_000);
});
