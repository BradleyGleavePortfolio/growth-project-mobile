/**
 * REPORT-ANY-M (agent 203; owner #200-S4, #201-E6 item 7): the space chat's press and hold (H8). The hold sheet gains
 * C6CHAT-S-V2 c04's Report and Block {name} rows after Reply and Copy; each runs the held row's own SafetyMenu flow (its
 * reasons with the row's card, its Block confirm) once the hold sheet has gone, so it sends exactly what the row's •••
 * sends. The real screen, rows, sheet and SafetyMenu, with CommunitySpaceChatScreen.test.tsx's stand-ins for the wire,
 * the device store, the space list, the voice outbox and the player; every switch on ([R27]). Names are made up.
 */
import React from 'react';
import { Alert, Keyboard, Platform, type AlertButton } from 'react-native';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { authEvents } from '../utils/authEvents';
import { HapticService } from '../ui/haptics/haptics.service';

const mockDisk = new Map<string, string>();
jest.mock('../storage/mmkv', () => ({
  cacheStorage: {
    getString: () => undefined,
    getStringAsync: async (k: string) => mockDisk.get(k),
    set: async (k: string, v: string) => { mockDisk.set(k, v); },
    delete: async (k: string) => { mockDisk.delete(k); },
    getAllKeys: async () => [...mockDisk.keys()],
  },
}));
jest.mock('../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../theme/tokens');
  return { useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }) };
});
jest.mock('../config/featureFlags', () => {
  const actual = jest.requireActual('../config/featureFlags');
  const on: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(actual.featureFlags)) on[k] = typeof v === 'boolean' ? true : v;
  return { ...actual, featureFlags: on };
});
const mockParams: { current: Record<string, unknown> } = { current: { cohortId: 'c-every' } };
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), getState: () => ({ routeNames: ['CommunityTab', 'CommunitySpaceChat'] }) }),
  useRoute: () => ({ params: mockParams.current }),
  useIsFocused: () => true,
}));
jest.mock('../components/community/SpaceDrawer', () => {
  const { Text } = jest.requireActual('react-native');
  return { SpaceListButton: ({ label, testID = 'space-list-open' }: { label?: string; testID?: string }) => <Text testID={testID} accessibilityLabel={label ?? 'Open space list'}>{label ?? 'list'}</Text> };
});
let mockUser = { id: 'me-1', name: 'Dana Reyes', coach_id: 'coach-1' };
jest.mock('../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('react-native-safe-area-context', () => {
  const { createContext, createElement } = require('react');
  const { View } = require('react-native');
  const insets = { top: 47, right: 0, bottom: 34, left: 0 };
  return {
    SafeAreaView: ({ children, style, testID }: { children?: unknown; style?: unknown; testID?: string }) => createElement(View, { style, testID }, children),
    SafeAreaInsetsContext: createContext(insets),
    useSafeAreaInsets: () => insets,
  };
});
jest.mock('../hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => ({ isOnline: true, isInternetReachable: null }),
  isEffectivelyOnline: jest.requireActual('../hooks/useNetworkStatus').isEffectivelyOnline,
}));
let mockRole = 'client';
jest.mock('../hooks/useCommunity', () => ({
  useCommunityCohorts: () => ({ data: { feature_flag_state: 'on', cohorts: [
    { id: 'c-every', workspace_id: 'ws', name: 'Everyone', is_default: true, kind: 'default', member_count: 1000, my_role: mockRole },
  ] }, isLoading: false, isError: false, refetch: jest.fn() }),
  useCommunityMe: () => ({ dataUpdatedAt: 0 }),
  communityKeys: { cohorts: () => ['community', 'cohorts'], me: () => ['community', 'me'] },
}));
jest.mock('../components/community/VoiceNotePlayer', () => {
  const { Text, View } = jest.requireActual('react-native');
  return (p: { testID: string; durationMs: number; trailing?: import('react').ReactNode; footer?: import('react').ReactNode }) => (
    <View><Text testID={p.testID}>{`player ${p.durationMs}`}</Text>{p.trailing}{p.footer}</View>
  );
});
jest.mock('../api/communityVoiceApi', () => ({ communityVoiceApi: { getOne: jest.fn(async () => ({ url: 'https://x/v.m4a' })), remove: jest.fn(async () => ({ deleted: true })) } }));
const mockVoice = { items: [] as unknown[], online: true, send: jest.fn(), retry: jest.fn(), discard: jest.fn() };
jest.mock('../hooks/useVoiceOutbox', () => ({ useVoiceOutbox: () => mockVoice }));
jest.mock('../components/community/VoiceRecordSheet', () => ({ __esModule: true, default: () => null }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));
const mockApi = { get: jest.fn(), post: jest.fn(), delete: jest.fn() };
jest.mock('../services/api', () => ({ __esModule: true, default: mockApi }));

/* eslint-disable @typescript-eslint/no-var-requires */
const Screen = require('../screens/community/CommunitySpaceChatScreen').default;
const { resetReportedVoiceNotes } = require('../components/community/VoiceReportedFold');
const { VOICE_NOTE_HEARD_LINE } = require('../components/community/SafetyMenu');
/* eslint-enable @typescript-eslint/no-var-requires */

const msg = (id: string, at: string, who: { id: string; name: string; is_coach?: boolean }, extra: Record<string, unknown> = {}) => ({
  id, cohort_id: 'c-every', sender_user_id: who.id, body: `body ${id}`, kind: 'text', created_at: at, updated_at: at,
  edited: false, deleted: false, parent_message_id: null, voice_note: null,
  sender: { id: who.id, name: who.name, avatar_url: null, is_coach: !!who.is_coach }, ...extra,
});
const COACH = { id: 'coach-1', name: 'Sam Okafor', is_coach: true };
const JO = { id: 'u-2', name: 'jo b.' };
const ME = { id: 'me-1', name: 'Dana Reyes' };
const BY_COACH = { role: 'coach', user_id: 'coach-1', name: 'Sam Okafor' };
const voiceOf = (id: string, ms: number) => ({ kind: 'voice', body: null, voice_note: { id, duration_ms: ms, waveform_peaks: null, heard_at: null } });
const fail = (status: number) => Object.assign(new Error(`HTTP ${status}`), { isAxiosError: true, response: { status, data: {} } });
const REPORTS = '/community/moderation/reports';
const SPAM = 'Spam or scams';
let page: unknown[] = [];

beforeEach(() => {
  authEvents.emit('logout');
  mockDisk.clear();
  (jest.requireMock('expo-secure-store') as { __store: Map<string, string> }).__store.set('supabase_token', 'tok-me-1');
  resetReportedVoiceNotes();
  mockRole = 'client';
  mockUser = { id: 'me-1', name: 'Dana Reyes', coach_id: 'coach-1' };
  mockParams.current = { cohortId: 'c-every' };
  page = [
    msg('m6', '2026-10-22T10:30:00.000Z', ME, { body: 'See you all Saturday' }),
    msg('m5', '2026-10-22T10:20:00.000Z', JO, { kind: 'image', body: 'Morning walk', image: { url: 'https://signed.example/p1.jpg', width: 1200, height: 900, expires_at: '2026-10-22T11:00:00.000Z' } }),
    msg('m4', '2026-10-22T10:10:00.000Z', JO, voiceOf('v4', 65000)),
    msg('m3', '2026-10-22T10:05:00.000Z', JO),
    msg('m2', '2026-10-22T09:30:00.000Z', COACH, voiceOf('v1', 42000)),
    msg('m1', '2026-10-22T08:00:00.000Z', COACH),
  ];
  mockApi.get.mockReset().mockImplementation(async (url: string) => {
    if (url.endsWith('/read')) return { data: { last_read_at: '2026-10-22T11:00:00.000Z', last_read_message_id: 'm6' } };
    if (url.endsWith('/members')) return { data: { members: [], next_cursor: null } };
    if (url === '/community/voice-consent') return { data: { seen: true, seen_at: '2026-10-20T10:00:00.000Z' } };
    return { data: { messages: page, next_before: null } };
  });
  mockApi.post.mockReset().mockImplementation(async (url: string) => {
    if (url === '/community/blocks') {
      page = page.filter((m) => (m as { sender_user_id: string }).sender_user_id !== JO.id);
      return { data: { blocked_user_id: JO.id, blocked: true } };
    }
    return url.endsWith('/read') ? { data: { ok: true } } : { data: {} };
  });
  mockApi.delete.mockReset().mockResolvedValue({ data: {} });
});

let client: QueryClient;
const open = async () => {
  client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
  const r = await render(<QueryClientProvider client={client}><Screen /></QueryClientProvider>);
  await r.findByTestId('space-chat-row-m3');
  return r;
};
afterEach(() => client?.clear());
type R = Awaited<ReturnType<typeof open>>;
const realOS = Platform.OS;
const setOS = (os: string) => Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
const hold = async (r: R, id: string) => { await fireEvent(r.getByTestId(`space-chat-row-${id}`), 'longPress'); };
/** The hold sheet's rows, top to bottom, as a screen reader hears them. */
const sheetRows = (r: R) => within(r.getByTestId('space-chat-sheet')).getAllByRole('button').map((b) => b.props.accessibilityLabel as string);
/** A Modal's onDismiss (the jest Modal never calls it): iOS runs what waits on a sheet's going there. */
const dismissOf = (r: R, testID: string) => {
  let node = r.getByTestId(testID) as unknown as { props: Record<string, unknown>; parent: unknown } | null;
  while (node && typeof node.props.onDismiss !== 'function') node = node.parent as typeof node;
  if (!node) throw new Error('no Modal onDismiss');
  return node.props.onDismiss as () => void;
};
/** A sheet row; on iOS its action runs only on the hold sheet's onDismiss. */
const pick = async (r: R, id: 'reply' | 'copy' | 'report' | 'block' | 'cancel') => {
  const dismiss = Platform.OS === 'ios' ? dismissOf(r, 'space-chat-sheet') : null;
  await fireEvent.press(r.getByTestId(`space-chat-sheet-${id}`));
  if (dismiss) await act(async () => { dismiss(); });
};
const reportsSent = () => mockApi.post.mock.calls.filter(([u]) => u === REPORTS).map(([, body]) => body);
const refresh = () => act(async () => { await client.invalidateQueries({ queryKey: ['community', 'space-chat'] }); });

let alert: jest.SpyInstance;
beforeEach(() => {
  setOS('android');
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(() => { setOS(realOS); alert.mockRestore(); });

describe('H8 SC1-SC6: the hold sheet draws c04\'s rows (Reply, Copy, Report, Block {name}, Cancel)', () => {
  it('SC1: another member\'s text: Reply, Copy, Report, Block jo b., Cancel (Report spoken "Report this content")', async () => {
    const r = await open();
    await hold(r, 'm3');
    expect(sheetRows(r)).toEqual(['Reply', 'Copy', 'Report this content', 'Block jo b.', 'Cancel']);
    expect(within(r.getByTestId('space-chat-sheet-report')).getByText('Report')).toBeTruthy();
    expect(within(r.getByTestId('space-chat-sheet-block')).getByText('Block jo b.')).toBeTruthy();
  });

  it('SC2: the coach\'s text, a member viewing: Reply, Copy, Report, Cancel (never Block on her coach)', async () => {
    const r = await open();
    await hold(r, 'm1');
    expect(sheetRows(r)).toEqual(['Reply', 'Copy', 'Report this content', 'Cancel']);
    expect(r.queryByTestId('space-chat-sheet-block')).toBeNull();
  });

  it('SC3: another member\'s voice note: Reply, Report, Block jo b., Cancel (no Copy, as today)', async () => {
    const r = await open();
    await hold(r, 'm4');
    expect(sheetRows(r)).toEqual(['Reply', 'Report this content', 'Block jo b.', 'Cancel']);
  });

  it('SC4: another member\'s photo: Reply, Report, Block jo b., Cancel', async () => {
    const r = await open();
    await hold(r, 'm5');
    expect(sheetRows(r)).toEqual(['Reply', 'Report this content', 'Block jo b.', 'Cancel']);
  });

  it('SC5: her own text keeps today\'s sheet: Reply, Copy, Cancel', async () => {
    const r = await open();
    await hold(r, 'm6');
    expect(sheetRows(r)).toEqual(['Reply', 'Copy', 'Cancel']);
  });

  it('SC6: the coach holds a member\'s text: Reply, Copy, Report, Block jo b., Cancel; Remove stays on the row\'s •••', async () => {
    mockRole = 'owner';
    mockUser = { id: 'coach-1', name: 'Sam Okafor', coach_id: '' };
    const r = await open();
    await hold(r, 'm3');
    expect(sheetRows(r)).toEqual(['Reply', 'Copy', 'Report this content', 'Block jo b.', 'Cancel']);
    await pick(r, 'cancel');
    await fireEvent.press(r.getByTestId('space-chat-menu-m3'));
    expect(r.getByTestId('space-chat-menu-m3-remove')).toBeTruthy();
  });

  it('SC1: the rows hold c04\'s look by tokens (forest Report, red Block) and the hold is one medium tap', async () => {
    const tap = jest.spyOn(HapticService, 'mediumImpact');
    const keyboard = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => undefined);
    try {
      const r = await open();
      await hold(r, 'm3');
      expect(tap).toHaveBeenCalledTimes(1);
      const { forestPop: fp, semantic } = jest.requireActual('../theme/tokens');
      const color = (id: string, word: string) => within(r.getByTestId(`space-chat-sheet-${id}`)).getByText(word).props.style;
      expect(JSON.stringify(color('report', 'Report'))).toContain(fp.ink);
      expect(JSON.stringify(color('block', 'Block jo b.'))).toContain(semantic.danger.fg);
    } finally {
      tap.mockRestore();
      keyboard.mockRestore();
    }
  });
});

describe('H8 SC7-SC8: Report and Block run the row\'s own SafetyMenu once the hold sheet has gone', () => {
  it('SC7 iOS: Report opens the reasons for that message (the row\'s card) only after the hold sheet\'s onDismiss; a reason posts that message; "Report sent" after the menu has gone', async () => {
    setOS('ios');
    const r = await open();
    await hold(r, 'm1'); // a row held before, then another: the menu is the one held last
    await pick(r, 'cancel');
    await hold(r, 'm3');
    const dismiss = dismissOf(r, 'space-chat-sheet');
    await fireEvent.press(r.getByTestId('space-chat-sheet-report'));
    expect(r.queryByTestId('space-chat-report-m3-sheet')).toBeNull(); // nothing over a closing sheet
    await act(async () => { dismiss(); });
    expect(r.queryByTestId('space-chat-sheet')).toBeNull();
    const sheet = r.getByTestId('space-chat-report-m3-sheet');
    expect(within(sheet).getByText('Why are you reporting this?')).toBeTruthy();
    expect(within(r.getByTestId('space-chat-report-m3-context')).getByText(/body m3/)).toBeTruthy();
    expect(within(r.getByTestId('space-chat-report-m3-context')).getByText('jo b.')).toBeTruthy();
    expect(within(sheet).queryByText(VOICE_NOTE_HEARD_LINE)).toBeNull();
    const menuGone = dismissOf(r, 'space-chat-report-m3-sheet');
    await fireEvent.press(within(sheet).getByLabelText(SPAM));
    await waitFor(() => expect(reportsSent()).toEqual([{ target_type: 'message', target_id: 'm3', reason: 'spam' }]));
    expect(alert).not.toHaveBeenCalledWith('Report sent', expect.anything()); // iOS: not while the sheet is closing
    await act(async () => { menuGone(); });
    expect(alert).toHaveBeenCalledWith('Report sent', expect.any(String));
  });

  it('SC7 iOS: a voice note\'s reasons carry its card and the owner\'s line; once reported its row folds, as the ••• folds it', async () => {
    setOS('ios');
    const r = await open();
    await hold(r, 'm4');
    await pick(r, 'report');
    const sheet = r.getByTestId('space-chat-report-m4-sheet');
    expect(within(r.getByTestId('space-chat-report-m4-context')).getByText(/voice note · 1:05/)).toBeTruthy();
    expect(within(sheet).getByText(VOICE_NOTE_HEARD_LINE)).toBeTruthy();
    const menuGone = dismissOf(r, 'space-chat-report-m4-sheet');
    await fireEvent.press(within(sheet).getByLabelText(SPAM));
    await waitFor(() => expect(reportsSent()).toEqual([{ target_type: 'message', target_id: 'm4', reason: 'spam' }]));
    await act(async () => { menuGone(); });
    expect(await r.findByTestId('space-chat-reported-m4')).toBeTruthy();
    await hold(r, 'm4');
    expect(r.queryByTestId('space-chat-sheet')).toBeNull(); // SC9: a folded reported note holds nothing
  });

  it('SC7 Android: the same report from the sheet, at once', async () => {
    const r = await open();
    await hold(r, 'm5');
    await pick(r, 'report');
    expect(within(r.getByTestId('space-chat-report-m5-context')).getByText(/Morning walk/)).toBeTruthy();
    await fireEvent.press(within(r.getByTestId('space-chat-report-m5-sheet')).getByLabelText(SPAM));
    await waitFor(() => expect(reportsSent()).toEqual([{ target_type: 'message', target_id: 'm5', reason: 'spam' }]));
    expect(alert).toHaveBeenCalledWith('Report sent', expect.any(String));
  });

  it('SC7: the sheet\'s Report sends exactly the body the row\'s ••• sends; once sent, both doors show it done', async () => {
    let r = await open();
    await fireEvent.press(r.getByTestId('space-chat-menu-m3'));
    await fireEvent.press(r.getByTestId('space-chat-menu-m3-report'));
    await fireEvent.press(within(r.getByTestId('space-chat-menu-m3-sheet')).getByLabelText(SPAM));
    await waitFor(() => expect(reportsSent()).toHaveLength(1));
    const byDots = reportsSent();
    await r.unmount();
    client.clear();
    resetReportedVoiceNotes();
    mockApi.post.mockClear();
    r = await open();
    await hold(r, 'm3');
    await pick(r, 'report');
    await fireEvent.press(within(r.getByTestId('space-chat-report-m3-sheet')).getByLabelText(SPAM));
    await waitFor(() => expect(reportsSent()).toHaveLength(1));
    expect(reportsSent()).toEqual(byDots);
    // One rule: the row's ••• now shows "Reported", and the hold sheet offers no second Report.
    await fireEvent.press(r.getByTestId('space-chat-menu-m3'));
    expect(r.getByTestId('space-chat-menu-m3-reported')).toBeTruthy();
    await fireEvent.press(r.getByTestId('space-chat-menu-m3-close'));
    await hold(r, 'm3');
    expect(sheetRows(r)).toEqual(['Reply', 'Copy', 'Block jo b.', 'Cancel']);
  });

  it('SC8 iOS: Block asks "Block jo b.?" only after the hold sheet has gone; Block posts and the rows go', async () => {
    setOS('ios');
    let confirm: AlertButton | undefined;
    alert.mockImplementation((_t: string, _m: string, buttons?: AlertButton[]) => { confirm = buttons?.find((b) => b.text === 'Block'); });
    const r = await open();
    await hold(r, 'm3');
    const dismiss = dismissOf(r, 'space-chat-sheet');
    await fireEvent.press(r.getByTestId('space-chat-sheet-block'));
    expect(alert).not.toHaveBeenCalled();
    await act(async () => { dismiss(); });
    expect(alert).toHaveBeenCalledWith('Block jo b.?', expect.any(String), expect.any(Array));
    await act(async () => { await confirm?.onPress?.(); });
    expect(mockApi.post.mock.calls.filter(([u]) => u === '/community/blocks')).toHaveLength(1);
    await waitFor(() => expect(r.queryByTestId('space-chat-row-m3')).toBeNull());
    expect(r.queryByTestId('space-chat-row-m4')).toBeNull();
  });
});

describe('H8 SC9-SC10: no hold where the row has nothing to report, and a message that leaves takes its sheets', () => {
  it('SC9: a row the coach removed holds nothing', async () => {
    page = [msg('m7', '2026-10-22T10:40:00.000Z', JO, { deleted: true, body: null, removed_at: '2026-10-22T11:00:00.000Z', removed_by: BY_COACH }), ...page];
    const r = await open();
    await hold(r, 'm7');
    expect(r.queryByTestId('space-chat-sheet')).toBeNull();
  });

  it('SC10: the held message leaves while the hold sheet is up: the sheet closes, no reasons open', async () => {
    const r = await open();
    await hold(r, 'm3');
    expect(r.getByTestId('space-chat-sheet')).toBeTruthy();
    page = page.filter((m) => (m as { id: string }).id !== 'm3');
    await refresh();
    await waitFor(() => expect(r.queryByTestId('space-chat-sheet')).toBeNull());
    expect(r.queryByTestId('space-chat-report-m3-sheet')).toBeNull();
  });

  it('SC7 and SC10 iOS: Report picked, then the message leaves before the sheet has gone: no reasons for a message that is gone', async () => {
    setOS('ios');
    const r = await open();
    await hold(r, 'm3');
    const dismiss = dismissOf(r, 'space-chat-sheet');
    await fireEvent.press(r.getByTestId('space-chat-sheet-report'));
    page = page.filter((m) => (m as { id: string }).id !== 'm3');
    await refresh();
    await waitFor(() => expect(r.queryByTestId('space-chat-row-m3')).toBeNull());
    await act(async () => { dismiss(); });
    expect(r.queryByTestId('space-chat-report-m3-sheet')).toBeNull();
    expect(reportsSent()).toEqual([]);
  });

  it('SC7 and SC10: the reasons are up and the space closes (403): the reasons go with it, nothing is sent', async () => {
    const r = await open();
    await hold(r, 'm3');
    await pick(r, 'report');
    expect(r.getByTestId('space-chat-report-m3-sheet')).toBeTruthy();
    mockApi.get.mockImplementation(async (url: string) => { if (url.endsWith('/messages')) throw fail(403); return { data: {} }; });
    await refresh();
    await r.findByTestId('space-chat-no-access');
    expect(r.queryByTestId('space-chat-report-m3-sheet')).toBeNull();
    expect(reportsSent()).toEqual([]);
  });
});

// ─── FIX-RAM-1 VN-LINE2 (fix 4): the owner's voice note line reads to a client viewer only ─────────────────────────
describe('VN-LINE2 (FIX-RAM-1): in the space chat the voice note line reads to a client viewer only', () => {
  /** The reasons step for jo b.'s voice note (m4), from the hold sheet's Report or from the row's own •••. */
  const readsLine = async (r: R, door: 'hold' | 'dots') => {
    if (door === 'hold') {
      await hold(r, 'm4');
      await pick(r, 'report');
    } else {
      await fireEvent.press(r.getByTestId('space-chat-menu-m4'));
      await fireEvent.press(r.getByTestId('space-chat-menu-m4-report'));
    }
    const tid = door === 'hold' ? 'space-chat-report-m4' : 'space-chat-menu-m4';
    return within(r.getByTestId(`${tid}-sheet`)).queryByText(VOICE_NOTE_HEARD_LINE) !== null;
  };

  it.each(['hold', 'dots'] as const)('VN-LINE2 space chat: a client reads the line word for word (by the %s)', async (door) => {
    const r = await open();
    expect(await readsLine(r, door)).toBe(true);
  });

  it.each([
    ['coach', 'hold'], ['coach', 'dots'], ['owner', 'hold'], ['owner', 'dots'],
  ] as const)('VN-LINE2 space chat: a viewer whose my_role is %s reads no line (by the %s)', async (role, door) => {
    mockRole = role;
    mockUser = { id: 'coach-1', name: 'Sam Okafor', coach_id: '' };
    const r = await open();
    expect(await readsLine(r, door)).toBe(false);
  });
});
