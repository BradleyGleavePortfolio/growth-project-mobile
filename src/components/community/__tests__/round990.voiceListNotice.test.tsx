/**
 * ROUND-990 (owner #203-E74, "why would voice notes not loaded be the whole page instead of a per message short
 * failure notification?"): when a read of the Hall's voice notes fails, the list says so in one short line,
 * "Could not load voice notes." (his own 10-26 words), with a quiet Try again. The notes of the last answer stay
 * drawn and playable while the failure may pass (no answer, 429, 5xx); a note that will not play says so on that
 * note (the player's own line); after any other failure, or after this viewer's own Block, Delete or Remove, the
 * notes concerned are never drawn from an earlier answer again, across later failures, retries and remounts.
 * Mocks follow VoiceNotesSection.listError.test.tsx; the player is the real VoiceNotePlayer on a fake port.
 * One QueryClient per case with retry off, kept across the remount cases.
 */
import React from 'react';
import { Alert, Platform, StyleSheet, type AlertButton } from 'react-native';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import NetInfo from '@react-native-community/netinfo';
import VoiceNotesSection from '../VoiceNotesSection';
import { resetVoiceOutbox } from '../../../hooks/useVoiceOutbox';
import { resetReportedVoiceNotes } from '../VoiceReportedFold';
import { registerVoicePlayback, type VoicePlaybackEvents, type VoicePlaybackHandle } from '../voicePlaybackPort';
import { describeCommunityFailure } from '../../../api/communityErrors';
import { voiceKeys } from '../../../hooks/voiceQueryKeys';
import { settleAndClearQueryCache } from '../../../services/queryClient';
import { captureError } from '../../../services/sentry';

const mockFlags = { communityVoiceNotes: true };
jest.mock('../../../config/featureFlags', () => ({
  get featureFlags() {
    return mockFlags;
  },
}));
jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return { useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }) };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../HapticPressable', () => {
  const React = require('react');
  const { Pressable } = require('react-native');
  return {
    __esModule: true,
    default: ({ children, ...props }: { children?: React.ReactNode }) => React.createElement(Pressable, props, children),
  };
});
const mockRecording = { uri: 'file:///r.m4a', durationMs: 3000, bytes: 10, mimeType: 'audio/mp4', peaks: [0.5] };
jest.mock('../VoiceRecordSheet', () => {
  const React = require('react');
  const { Pressable } = require('react-native');
  return {
    __esModule: true,
    default: ({ visible, onSend }: { visible: boolean; onSend: (r: unknown) => void }) =>
      visible ? React.createElement(Pressable, { testID: 'sheet-send', onPress: () => onSend(mockRecording) }) : null,
  };
});
jest.mock('../../../services/sentry', () => ({ captureError: jest.fn() }));
const mockRole = { current: 'client' as string };
jest.mock('../../../hooks/useCommunity', () => ({
  ...jest.requireActual('../../../hooks/useCommunity'),
  useCommunityMe: () => ({ data: { membership: { role: mockRole.current } } }),
}));
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn() }),
}));
const mockListFeed = jest.fn();
const mockRemove = jest.fn();
jest.mock('../../../api/communityVoiceApi', () => {
  const actual = jest.requireActual('../../../api/communityVoiceApi');
  return {
    ...actual,
    communityVoiceApi: {
      listFeed: (...a: unknown[]) => mockListFeed(...a),
      remove: (...a: unknown[]) => mockRemove(...a),
      issueUploadUrl: jest.fn(),
      uploadBytes: jest.fn(),
      create: jest.fn(),
    },
  };
});
const mockBlock = jest.fn();
jest.mock('../../../api/communitySafetyApi', () => {
  const actual = jest.requireActual('../../../api/communitySafetyApi');
  return { ...actual, communitySafetyApi: { report: jest.fn(), block: (...a: unknown[]) => mockBlock(...a) } };
});
// The member's own note going up (case 12): the three hops answer at once.
const mockPublish = jest.fn();
jest.mock('../../../hooks/useVoiceUpload', () => ({
  publishVoiceNote: (...a: unknown[]) => mockPublish(...a),
}));
jest.mock('expo-file-system', () => {
  class File {
    uri: string;
    constructor(...p: (string | { uri: string })[]) {
      this.uri = p.map((x) => (typeof x === 'string' ? x : x.uri)).join('/');
    }
    get name() {
      return this.uri.split('/').pop();
    }
    exists = true;
    move = () => undefined;
    delete = () => undefined;
  }
  class Directory extends File {
    create = () => undefined;
  }
  return { File, Directory, Paths: { document: 'file:///docs' } };
});
const secure = jest.requireMock('expo-secure-store') as { __store: Map<string, string> };

const SENTENCE = 'Could not load voice notes.';
const PLAYER_LINE = 'Could not play this voice note. Tap play to try again.';
const OLD_BLOCK = ['Voice notes not loaded', 'because of a server problem', 'quote reference', 'email'];
const EMPTY = 'No voice notes yet. Tap Record to share one with your community.';

const answered = (status: number, data: Record<string, unknown> = {}) => ({
  isAxiosError: true,
  response: { status, data, headers: {} },
  config: { headers: {} },
});
const noAnswer = () => ({ isAxiosError: true, config: { headers: {} } });

const note = (id: string, author: string, extra: Record<string, unknown> = {}) => ({
  id,
  workspace_id: 'ws-1',
  cohort_id: null,
  conversation_id: null,
  author_id: author,
  url: `https://storage.example.test/${id}`,
  duration_ms: 42000,
  bytes: 1000,
  mime_type: 'audio/mp4',
  created_at: new Date(Date.now() - 3_600_000).toISOString(),
  ...extra,
});
const page = (notes: ReturnType<typeof note>[], next: string | null = null) => ({ voice_notes: notes, next_cursor: next });
/** Answer A: three notes, the second by another member (u-sam). */
const A = () => page([note('vn-1', 'u-alex'), note('vn-2', 'u-sam'), note('vn-3', 'u-alex')]);

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const tree = (qc: QueryClient) => (
  <QueryClientProvider client={qc}>
    <VoiceNotesSection workspaceId="ws-1" viewerUserId="u-me" viewerCoachId="u-coach" testID="vn" />
  </QueryClientProvider>
);
async function mount(qc: QueryClient) {
  return render(tree(qc));
}
type View = Awaited<ReturnType<typeof mount>>;

/** Every read the section makes next answers with the given outcomes, in order (then the last one again). */
function script(...outcomes: unknown[]) {
  mockListFeed.mockReset();
  const last = outcomes[outcomes.length - 1];
  for (const o of outcomes) {
    if (o instanceof Promise) mockListFeed.mockReturnValueOnce(o);
    else if (isFailure(o)) mockListFeed.mockRejectedValueOnce(o);
    else mockListFeed.mockResolvedValueOnce(o);
  }
  if (isFailure(last)) mockListFeed.mockRejectedValue(last);
  else mockListFeed.mockResolvedValue(last);
}
const isFailure = (o: unknown) => !!o && typeof o === 'object' && !('voice_notes' in (o as object));

/** A re-read of the feed from outside the section (a ping, the catch-up, a write's refresh). */
async function reread(qc: QueryClient) {
  await act(async () => {
    await qc.refetchQueries({ queryKey: voiceKeys.feedRoot('ws-1') });
  });
}

const drawnNotes = (v: View) => v.queryAllByTestId(/^vn-note-/).map((n) => String(n.props.testID).replace('vn-note-', ''));
const players = (v: View) => v.queryAllByTestId(/^vn-player-/).map((n) => String(n.props.testID).replace('vn-player-', ''));
/** The notice's text, in reading order. */
function noticeLines(v: View): string[] {
  return v
    .getByTestId('vn-error')
    .queryAll((n) => n.type === 'Text')
    .map((t) => [t.props.children].flat().join(''));
}
function expectNoOldBlock(v: View) {
  for (const words of OLD_BLOCK) expect(v.queryByText(new RegExp(words))).toBeNull();
}

let alertSpy: jest.SpyInstance;
function pressAlertButton(text: string) {
  const call = alertSpy.mock.calls[alertSpy.mock.calls.length - 1];
  const b = ((call[2] ?? []) as AlertButton[]).find((x) => x.text === text);
  if (!b?.onPress) throw new Error(`no alert button ${text}`);
  return b.onPress();
}

const loads: string[] = [];
const failOnce = new Set<string>();
const realOS = Platform.OS;
beforeEach(() => {
  mockFlags.communityVoiceNotes = true;
  mockRole.current = 'client';
  resetVoiceOutbox();
  resetReportedVoiceNotes();
  (NetInfo as unknown as { __reset: () => void }).__reset();
  secure.__store.set('supabase_token', 'token-me');
  (captureError as jest.Mock).mockClear();
  mockRemove.mockReset().mockResolvedValue({ deleted: true });
  mockBlock.mockReset().mockResolvedValue(undefined);
  mockPublish.mockReset().mockResolvedValue({ id: 'vn-new' });
  script(A());
  loads.length = 0;
  failOnce.clear();
  registerVoicePlayback({
    isAvailable: true,
    load: jest.fn(async (url: string, _e: VoicePlaybackEvents) => {
      const id = url.split('/').pop() ?? url;
      loads.push(id);
      if (failOnce.delete(id)) throw new Error('the clip would not load');
      return {
        play: jest.fn().mockResolvedValue(undefined),
        pause: jest.fn().mockResolvedValue(undefined),
        seek: jest.fn().mockResolvedValue(undefined),
        unload: jest.fn().mockResolvedValue(undefined),
      } as jest.Mocked<VoicePlaybackHandle>;
    }),
  });
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  // SafetyMenu raises its follow-up Alerts at once on Android (as VoiceNotesSection.test.tsx drives it).
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' });
});
afterEach(() => {
  alertSpy.mockRestore();
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => realOS });
});
afterAll(() => registerVoicePlayback(null));

describe('a failed read is one short line with a working Try again (rules a, b, c)', () => {
  it('1. the first read answers 503: "Could not load voice notes." and one Try again that reads again', async () => {
    script(answered(503));
    const v = await mount(newClient());
    await v.findByTestId('vn-error');
    expect(noticeLines(v)).toEqual([SENTENCE, 'Try again']);
    expectNoOldBlock(v);
    expect(v.getByText('Voice notes')).toBeTruthy();
    expect(v.getByTestId('vn-record')).toBeTruthy();
    // rule b: the line is the copy table's own words for this list
    const table = describeCommunityFailure(answered(500), 'load_voice_notes').message.toLowerCase();
    expect(table).toContain(SENTENCE.replace(/\.$/, '').toLowerCase());
    const retry = within(v.getByTestId('vn-error')).getAllByRole('button');
    expect(retry).toHaveLength(1);
    expect(retry[0].props.accessibilityLabel).toBe('Try again');
    const before = mockListFeed.mock.calls.length;
    await fireEvent.press(v.getByTestId('vn-retry'));
    await waitFor(() => expect(mockListFeed.mock.calls.length).toBeGreaterThan(before));
  });

  it('2. the first read gets no answer, a 403, a 404: the same one line each time', async () => {
    for (const failure of [noAnswer(), answered(403), answered(404)]) {
      script(failure);
      const v = await mount(newClient());
      await v.findByTestId('vn-error');
      expect(noticeLines(v)).toEqual([SENTENCE, 'Try again']);
      expectNoOldBlock(v);
      await v.unmount();
    }
  });
});

describe('the notes already on screen stay through a passing failure (rule e)', () => {
  it('3. (the premise) three notes, then a re-read answers 503: all three still drawn with their players, the line once above them', async () => {
    const qc = newClient();
    const v = await mount(qc);
    await v.findByTestId('vn-note-vn-3');
    script(answered(503));
    await reread(qc);
    await v.findByTestId('vn-error');
    expect(drawnNotes(v)).toEqual(['vn-1', 'vn-2', 'vn-3']);
    expect(players(v)).toEqual(['vn-1', 'vn-2', 'vn-3']);
    expect(v.getAllByText(SENTENCE)).toHaveLength(1);
    // the line sits above the notes: it comes first in the section's reading order
    const order = v.getByTestId('vn').queryAll((n) => n.props.testID === 'vn-error' || n.props.testID === 'vn-note-vn-1');
    expect(order.map((n) => n.props.testID)).toEqual(['vn-error', 'vn-note-vn-1']);
  });

  it('4. kept on no answer and on 429; dropped on 401, 403, 404, 410, 400, a closed answer, the switch-off 503 and a failure that is not a request', async () => {
    for (const failure of [noAnswer(), answered(429), answered(500), answered(502)]) {
      const qc = newClient();
      script(A());
      const v = await mount(qc);
      await v.findByTestId('vn-note-vn-3');
      script(failure);
      await reread(qc);
      await v.findByTestId('vn-error');
      expect(players(v)).toEqual(['vn-1', 'vn-2', 'vn-3']);
      await v.unmount();
    }
    const dropping = [
      answered(401), answered(403), answered(404), answered(410), answered(400),
      answered(404, { code: 'community.workspace.no_access' }),
      answered(503, { disabled: true, retry_after: null, error: 'community.disabled' }),
      new Error('not a request'),
    ];
    for (const failure of dropping) {
      const qc = newClient();
      script(A());
      const v = await mount(qc);
      await v.findByTestId('vn-note-vn-3');
      script(failure);
      await reread(qc);
      await v.findByTestId('vn-error');
      expect(drawnNotes(v)).toEqual([]);
      expect(players(v)).toEqual([]);
      expect(noticeLines(v)).toEqual([SENTENCE, 'Try again']);
      expect(v.queryByTestId('vn-more')).toBeNull();
      await v.unmount();
    }
  });
});

describe('a note that will not play says so on that note (rule h)', () => {
  it('5. the second note fails to load and its URL refresh answers 503: only that note shows the player\'s line; Play again loads again', async () => {
    const qc = newClient();
    const v = await mount(qc);
    await v.findByTestId('vn-player-vn-2');
    failOnce.add('vn-2');
    script(answered(503));
    const toggle = (id: string) => within(v.getByTestId(`vn-player-${id}`)).getByTestId('voice-player-toggle');
    await fireEvent.press(toggle('vn-2'));
    await v.findByTestId('vn-error');
    await within(v.getByTestId('vn-player-vn-2')).findByText(PLAYER_LINE);
    expect(players(v)).toEqual(['vn-1', 'vn-2', 'vn-3']);
    expect(within(v.getByTestId('vn-player-vn-2')).getByText(PLAYER_LINE)).toBeTruthy();
    expect(within(v.getByTestId('vn-player-vn-1')).queryByText(PLAYER_LINE)).toBeNull();
    expect(within(v.getByTestId('vn-player-vn-3')).queryByText(PLAYER_LINE)).toBeNull();
    const before = loads.filter((id) => id === 'vn-2').length;
    await fireEvent.press(toggle('vn-2'));
    await waitFor(() => expect(loads.filter((id) => id === 'vn-2').length).toBe(before + 1));
  });
});

describe('dropped stays dropped (rule f)', () => {
  it('6. answer, then 403, then a Try again that answers 503: no note drawn after the 503', async () => {
    const qc = newClient();
    const v = await mount(qc);
    await v.findByTestId('vn-note-vn-3');
    script(answered(403));
    await reread(qc);
    await v.findByTestId('vn-error');
    script(answered(503));
    await fireEvent.press(v.getByTestId('vn-retry'));
    await waitFor(() => expect(mockListFeed).toHaveBeenCalled());
    await v.findByTestId('vn-error');
    expect(drawnNotes(v)).toEqual([]);
    expect(players(v)).toEqual([]);
  });

  it('7. the same with the section unmounted and mounted again between the 403 and the 503', async () => {
    const qc = newClient();
    const first = await mount(qc);
    await first.findByTestId('vn-note-vn-3');
    script(answered(403));
    await reread(qc);
    await first.findByTestId('vn-error');
    await first.unmount();
    script(answered(503));
    const again = await mount(qc);
    expect(drawnNotes(again)).toEqual([]);
    await again.findByTestId('vn-error');
    await waitFor(() => expect(mockListFeed).toHaveBeenCalled());
    await again.findByTestId('vn-error');
    expect(drawnNotes(again)).toEqual([]);
    expect(players(again)).toEqual([]);
    // a later passing failure brings nothing back either
    await reread(qc);
    expect(drawnNotes(again)).toEqual([]);
  });

  it('8. then a 200: the notes of the new answer and no line', async () => {
    const qc = newClient();
    const v = await mount(qc);
    await v.findByTestId('vn-note-vn-3');
    script(answered(403));
    await reread(qc);
    await v.findByTestId('vn-error');
    script(page([note('vn-9', 'u-alex')]));
    await fireEvent.press(v.getByTestId('vn-retry'));
    await v.findByTestId('vn-note-vn-9');
    expect(drawnNotes(v)).toEqual(['vn-9']);
    expect(v.queryByTestId('vn-error')).toBeNull();
  });

  it('19. sign-out: the next account never sees the first account\'s notes under a failure', async () => {
    const qc = newClient();
    const first = await mount(qc);
    await first.findByTestId('vn-note-vn-3');
    await first.unmount();
    await settleAndClearQueryCache(qc); // authActions.ts signOut: the in-memory cache is emptied before 'logout'
    script(answered(503));
    const next = await mount(qc);
    await next.findByTestId('vn-error');
    expect(drawnNotes(next)).toEqual([]);
    expect(players(next)).toEqual([]);
  });
});

describe('the viewer\'s own Block, Delete and Remove (rule g)', () => {
  async function blockSam(v: View) {
    await fireEvent.press(await v.findByTestId('vn-menu-vn-2'));
    await fireEvent.press(v.getByTestId('vn-menu-vn-2-block'));
    await act(async () => {
      await pressAlertButton('Block');
    });
  }

  it('9. Block the second note\'s author from its menu, the re-read answers 503: none of their notes drawn, the others kept', async () => {
    const qc = newClient();
    const v = await mount(qc);
    await v.findByTestId('vn-note-vn-3');
    script(answered(503));
    await blockSam(v);
    expect(mockBlock).toHaveBeenCalledWith('u-sam');
    await v.findByTestId('vn-error');
    await waitFor(() => expect(drawnNotes(v)).toEqual(['vn-1', 'vn-3']));
    expect(players(v)).toEqual(['vn-1', 'vn-3']);
  });

  it('10. the same with an unmount and mount before the 503', async () => {
    const qc = newClient();
    const first = await mount(qc);
    await first.findByTestId('vn-note-vn-3');
    script(answered(503));
    await blockSam(first);
    await first.findByTestId('vn-error');
    await first.unmount();
    const again = await mount(qc);
    expect(drawnNotes(again)).not.toContain('vn-2');
    await reread(qc);
    await again.findByTestId('vn-error');
    expect(drawnNotes(again)).toEqual(['vn-1', 'vn-3']);
    expect(players(again)).toEqual(['vn-1', 'vn-3']);
  });

  it('11. Delete your own note, then 503; the coach\'s Remove, then 503: that note is not drawn, the others are', async () => {
    let qc = newClient();
    script(page([note('vn-1', 'u-alex'), note('vn-mine', 'u-me'), note('vn-3', 'u-alex')]));
    let v = await mount(qc);
    await fireEvent.press(await v.findByTestId('vn-menu-vn-mine'));
    script(answered(503));
    await fireEvent.press(v.getByTestId('vn-menu-vn-mine-delete'));
    await act(async () => {
      await pressAlertButton('Delete');
    });
    expect(mockRemove).toHaveBeenCalledWith('vn-mine');
    await v.findByTestId('vn-error');
    await waitFor(() => expect(drawnNotes(v)).toEqual(['vn-1', 'vn-3']));
    await v.unmount();

    mockRole.current = 'coach';
    qc = newClient();
    script(A());
    v = await mount(qc);
    await fireEvent.press(await v.findByTestId('vn-menu-vn-2'));
    script(answered(503));
    await fireEvent.press(v.getByTestId('vn-menu-vn-2-remove'));
    await act(async () => {
      fireEvent.press(v.getByTestId('vn-menu-vn-2-remove-confirm'));
    });
    expect(mockRemove).toHaveBeenCalledWith('vn-2');
    await v.findByTestId('vn-error');
    await waitFor(() => expect(drawnNotes(v)).toEqual(['vn-1', 'vn-3']));
    expect(players(v)).toEqual(['vn-1', 'vn-3']);
  });

  it('12. your own note lands and the re-read answers 503: the unsent row is gone and the line is drawn', async () => {
    const qc = newClient();
    const v = await mount(qc);
    await v.findByTestId('vn-note-vn-3');
    script(answered(503));
    await fireEvent.press(v.getByTestId('vn-record'));
    await act(async () => {
      fireEvent.press(v.getByTestId('sheet-send'));
    });
    await waitFor(() => expect(mockPublish).toHaveBeenCalled());
    await waitFor(() => expect(v.queryAllByTestId(/^vn-pending-/)).toHaveLength(0));
    await v.findByTestId('vn-error');
    expect(noticeLines(v)).toEqual([SENTENCE, 'Try again']);
  });
});

describe('Show older, an empty list, recovery (rules d, i)', () => {
  it('13. Show older answers 503: page one stays; the line sits above Show older with no Try again; a 200 adds the older notes and clears it', async () => {
    const qc = newClient();
    script(page([note('vn-1', 'u-alex'), note('vn-2', 'u-sam')], 'cursor-2'));
    const v = await mount(qc);
    await v.findByTestId('vn-more');
    script(answered(503));
    await fireEvent.press(v.getByTestId('vn-more'));
    await v.findByTestId('vn-error');
    expect(players(v)).toEqual(['vn-1', 'vn-2']);
    expect(noticeLines(v)).toEqual([SENTENCE]);
    expect(v.queryByTestId('vn-retry')).toBeNull();
    const order = v.getByTestId('vn').queryAll((n) => ['vn-note-vn-2', 'vn-error', 'vn-more'].includes(n.props.testID));
    expect(order.map((n) => n.props.testID)).toEqual(['vn-note-vn-2', 'vn-error', 'vn-more']);
    expect(within(v.getByTestId('vn-more')).getByText('Show older voice notes')).toBeTruthy();
    script(page([note('vn-3', 'u-alex')]));
    await fireEvent.press(v.getByTestId('vn-more'));
    await v.findByTestId('vn-note-vn-3');
    expect(mockListFeed).toHaveBeenLastCalledWith('ws-1', expect.objectContaining({ cursor: 'cursor-2' }));
    expect(drawnNotes(v)).toEqual(['vn-1', 'vn-2', 'vn-3']);
    expect(v.queryByTestId('vn-error')).toBeNull();
  });

  it('14. an empty answer, then 503: the line, and no "No voice notes yet"', async () => {
    const qc = newClient();
    script(page([]));
    const v = await mount(qc);
    await v.findByText(EMPTY);
    script(answered(503));
    await reread(qc);
    await v.findByTestId('vn-error');
    expect(noticeLines(v)).toEqual([SENTENCE, 'Try again']);
    expect(v.queryByText(EMPTY)).toBeNull();
  });

  it('15. recovery: after a 503 over kept notes, an answer clears the line and draws the new answer\'s notes', async () => {
    const qc = newClient();
    const v = await mount(qc);
    await v.findByTestId('vn-note-vn-3');
    script(answered(503));
    await reread(qc);
    await v.findByTestId('vn-error');
    script(page([note('vn-4', 'u-alex'), note('vn-1', 'u-alex')]));
    await fireEvent.press(v.getByTestId('vn-retry'));
    await v.findByTestId('vn-note-vn-4');
    expect(drawnNotes(v)).toEqual(['vn-4', 'vn-1']);
    expect(v.queryByTestId('vn-error')).toBeNull();
  });
});

describe('described once, read once (rules a, c)', () => {
  it('16. one unexpected failure is reported once, however often the section draws', async () => {
    script(answered(503));
    const qc = newClient();
    const v = await mount(qc);
    await v.findByTestId('vn-error');
    await fireEvent.press(v.getByTestId('vn-record')); // opens the record sheet: the section draws again
    for (let i = 0; i < 3; i += 1) await v.rerender(tree(qc));
    expect(v.getByTestId('vn-error')).toBeTruthy();
    expect((captureError as jest.Mock).mock.calls.length).toBe(1);
  });

  it('17. the row reads the sentence then Try again; Try again is a 44 pt target; the alert role once', async () => {
    script(answered(503));
    const v = await mount(newClient());
    const row = await v.findByTestId('vn-error');
    expect(noticeLines(v)).toEqual([SENTENCE, 'Try again']);
    const style = StyleSheet.flatten(v.getByTestId('vn-retry').props.style) as { minHeight?: number };
    expect(style.minHeight).toBeGreaterThanOrEqual(44);
    expect(row.queryAll((n) => n.props.accessibilityRole === 'alert')).toHaveLength(1);
  });
});

describe('kept from round 1 (rule b; cases d to g)', () => {
  it('18. the copy table keeps its words; a healthy and an empty list draw no line; the switch off draws and reads nothing', async () => {
    const list = describeCommunityFailure(answered(500), 'load_voice_notes');
    expect(list.title).toBe('Voice notes not loaded');
    expect(list.message).toContain('The app could not load voice notes because of a server problem.');
    expect(list.reference).toMatch(/^[0-9A-F]{8}$/);
    const one = describeCommunityFailure(answered(500), 'load_voice');
    expect(one.title).toBe('Voice note not loaded');
    expect(one.message).toContain('The app could not load this voice note because of a server problem.');

    const healthy = await mount(newClient());
    await healthy.findByTestId('vn-note-vn-3');
    expect(healthy.queryByTestId('vn-error')).toBeNull();
    expect(healthy.queryByText(SENTENCE)).toBeNull();
    await healthy.unmount();

    script(page([]));
    const empty = await mount(newClient());
    expect(await empty.findByText(EMPTY)).toBeTruthy();
    expect(empty.queryByTestId('vn-error')).toBeNull();
    await empty.unmount();

    mockFlags.communityVoiceNotes = false;
    script(answered(503));
    const off = await mount(newClient());
    expect(off.toJSON()).toBeNull();
    expect(mockListFeed).not.toHaveBeenCalled();
  });
});
