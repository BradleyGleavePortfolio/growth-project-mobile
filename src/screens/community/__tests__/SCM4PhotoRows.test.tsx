/**
 * SC-M4 (agent 203), cases T10 and T11 on the screen: her photo as one more row of the stream (SpaceChatRow with today's
 * props, no edit): on its way, not sent (Try again, Delete), posted (the local row gone once the list has the id), another
 * space, back in the space, the spoken label, the New messages line; the + puts the keyboard away and the pick starts
 * only once the sheet has gone (iOS); trap 10: the field starts at the same place with the + and with a reply's empty
 * slot. The real screen, hook, outbox, photo module and rows; the picker and the file system stand in as
 * src/utils/log/__tests__/mealPhotoAttach.test.ts has them; the server answers by space. Made-up files and links only.
 */
import React from 'react';
import { Alert, Keyboard, Platform, StyleSheet, type ViewStyle } from 'react-native';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { authEvents } from '../../../utils/authEvents';

const mockLibrary = jest.fn();
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: (...a: unknown[]) => mockLibrary(...a),
  UIImagePickerPreferredAssetRepresentationMode: { Automatic: 'automatic', Compatible: 'compatible', Current: 'current' },
}));
const mockInfo = jest.fn();
const mockDelete = jest.fn();
const mockUpload = jest.fn();
jest.mock('expo-file-system/legacy', () => ({
  FileSystemUploadType: { BINARY_CONTENT: 0, MULTIPART: 1 },
  getInfoAsync: (...a: unknown[]) => mockInfo(...a),
  deleteAsync: (...a: unknown[]) => mockDelete(...a),
  uploadAsync: (...a: unknown[]) => mockUpload(...a),
}));
jest.mock('../../../store/clientStore', () => ({ useClientStore: { getState: () => ({}) } }));
// CRISIS-TEXT-M's reader asks who is signed in (lib/userCache, read from prefsStorage, which the stand-in store lacks).
jest.mock('../../../lib/userCache', () => ({ readUserCacheSync: () => ({ id: 'me-1' }) }));
const mockDisk = new Map<string, string>();
jest.mock('../../../storage/mmkv', () => ({
  cacheStorage: {
    getString: () => undefined,
    getStringAsync: async (k: string) => mockDisk.get(k),
    set: async (k: string, v: string) => { mockDisk.set(k, v); },
    delete: async (k: string) => { mockDisk.delete(k); },
    getAllKeys: async () => [...mockDisk.keys()],
  },
}));
jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return { useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }) };
});
const mockFlags = { communitySpaceChat: true, communityVoiceNotes: true };
jest.mock('../../../config/featureFlags', () => ({ featureFlags: mockFlags }));
const mockParams: { current: { cohortId: string } } = { current: { cohortId: 'c-a' } };
const mockStack = { routes: ['CommunityTab', 'CommunitySpaceChat'] };
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), getState: () => ({ routeNames: mockStack.routes }) }),
  useRoute: () => ({ params: mockParams.current }),
  useIsFocused: () => true,
}));
jest.mock('../../../components/community/SpaceDrawer', () => {
  const { Text } = jest.requireActual('react-native');
  return { SpaceListButton: ({ label, testID = 'space-list-open' }: { label?: string; testID?: string }) => <Text testID={testID} accessibilityLabel={label ?? 'Open space list'}>{label ?? 'list'}</Text> };
});
let mockUser = { id: 'me-1', name: 'Dana Reyes', coach_id: 'coach-1' };
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
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
jest.mock('../../../hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => ({ isOnline: true, isInternetReachable: null }),
  isEffectivelyOnline: jest.requireActual('../../../hooks/useNetworkStatus').isEffectivelyOnline,
}));
let mockRole = 'client';
jest.mock('../../../hooks/useCommunity', () => ({
  useCommunityCohorts: () => ({
    data: { feature_flag_state: 'on', cohorts: [
      { id: 'c-a', workspace_id: 'ws', name: 'Running', is_default: true, kind: 'default', member_count: 12, my_role: mockRole },
      { id: 'c-ann', workspace_id: 'ws', name: 'Announcements', is_default: false, kind: 'announcement', posting_policy: 'coach', member_count: 24, my_role: mockRole },
    ] },
    isLoading: false, isError: false, refetch: jest.fn(),
  }),
  useCommunityMe: () => ({ dataUpdatedAt: 0 }),
  communityKeys: { cohorts: () => ['community', 'cohorts'], me: () => ['community', 'me'] },
}));
jest.mock('../../../components/community/VoiceNotePlayer', () => {
  const { Text } = jest.requireActual('react-native');
  return (p: { testID: string }) => <Text testID={p.testID}>player</Text>;
});
jest.mock('../../../api/communityVoiceApi', () => ({ communityVoiceApi: { getOne: jest.fn(async () => ({ url: 'https://x/v.m4a' })), remove: jest.fn() } }));
const mockVoice = { items: [] as unknown[], online: true, send: jest.fn(), retry: jest.fn(), discard: jest.fn() };
jest.mock('../../../hooks/useVoiceOutbox', () => ({ useVoiceOutbox: () => mockVoice }));
jest.mock('../../../components/community/VoiceRecordSheet', () => {
  const { Text } = jest.requireActual('react-native');
  return { __esModule: true, default: (p: { visible: boolean; target: { cohortName: string } }) => (p.visible ? <Text testID="voice-sheet">{p.target.cohortName}</Text> : null) };
});
jest.mock('../../../components/community/SafetyMenu', () => {
  const { Text } = jest.requireActual('react-native');
  return (p: { testID: string }) => <Text testID={p.testID}>menu</Text>;
});
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));
const mockApi = { get: jest.fn(), post: jest.fn(), delete: jest.fn() };
jest.mock('../../../services/api', () => ({ __esModule: true, default: mockApi }));


const Screen = require('../CommunitySpaceChatScreen').default;

type Who = { id: string; name: string; is_coach?: boolean };
const COACH: Who = { id: 'coach-1', name: 'Sam Okafor', is_coach: true };
const JO: Who = { id: 'u-2', name: 'jo b.' };
const ME: Who = { id: 'me-1', name: 'Dana Reyes' };
const FILE = 'file:///cache/ImagePicker/made-up-photo-1.jpg';
const msg = (id: string, at: string, who: Who, cohort: string, extra: Record<string, unknown> = {}) => ({
  id, cohort_id: cohort, sender_user_id: who.id, body: `body ${id}`, kind: 'text', created_at: at, updated_at: at,
  edited: false, deleted: false, parent_message_id: null, voice_note: null,
  sender: { id: who.id, name: who.name, avatar_url: null, is_coach: !!who.is_coach }, ...extra,
});
const photoMsg = (id: string, who: Who, cohort = 'c-a') => msg(id, new Date().toISOString(), who, cohort,
  { kind: 'image', body: null, image: { url: 'https://signed.example.test/p.jpg', width: 1200, height: 900 } });
const fail = (status: number, data: Record<string, unknown> = {}) =>
  Object.assign(new Error(`HTTP ${status}`), { isAxiosError: true, response: { status, data } });

type Space = { page: unknown[]; refuse?: number };
let spaces: Record<string, Space> = {};
let readAnswer: unknown;
let linkAnswer: (() => unknown) | null;
let photoAnswers: Array<() => unknown> = [];
const realOS = Platform.OS;
const setOS = (os: string) => Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
const hold = () => {
  let release: (v: unknown) => void = () => undefined;
  const p = new Promise((res) => { release = res; });
  return { answer: () => p, release: (v: unknown) => release(v) };
};

beforeEach(() => {
  authEvents.emit('logout');
  mockDisk.clear();
  (jest.requireMock('expo-secure-store') as { __store: Map<string, string> }).__store.set('supabase_token', 'tok-me-1');
  mockStack.routes = ['CommunityTab', 'CommunitySpaceChat'];
  mockRole = 'client';
  mockUser = { id: 'me-1', name: 'Dana Reyes', coach_id: 'coach-1' };
  mockParams.current = { cohortId: 'c-a' };
  mockFlags.communityVoiceNotes = true;
  readAnswer = { last_read_at: null, last_read_message_id: null };
  linkAnswer = null;
  photoAnswers = [];
  spaces = {
    'c-a': { page: [msg('a2', '2026-10-22T09:30:00.000Z', JO, 'c-a'), msg('a1', '2026-10-22T08:00:00.000Z', COACH, 'c-a')] },
    'c-b': { page: [msg('b1', '2026-10-01T09:00:00.000Z', COACH, 'c-b')] },
    'c-ann': { page: [msg('n1', '2026-10-22T08:00:00.000Z', COACH, 'c-ann')] },
  };
  [mockLibrary, mockInfo, mockUpload, mockDelete].forEach((m) => m.mockReset());
  mockLibrary.mockResolvedValue({ canceled: false, assets: [{ uri: FILE, width: 1200, height: 900, mimeType: 'image/jpeg' }] });
  mockInfo.mockResolvedValue({ exists: true, size: 2_000_000, uri: FILE, isDirectory: false, modificationTime: 1 });
  mockUpload.mockResolvedValue({ status: 200, headers: {}, body: '' });
  mockDelete.mockResolvedValue(undefined);
  mockApi.get.mockReset().mockImplementation(async (url: string) => {
    const [, id, what] = /^\/community\/cohorts\/([^/]+)\/(messages|read|members)$/.exec(url) ?? [];
    const space = spaces[id];
    if (!space) throw fail(404);
    if (what === 'members') return { data: { members: [], next_cursor: null } };
    if (what === 'read') return { data: readAnswer };
    if (space.refuse) throw fail(space.refuse);
    return { data: { messages: space.page, next_before: null } };
  });
  mockApi.post.mockReset().mockImplementation(async (url: string, body: { kind?: string }) => {
    if (url.endsWith('/read')) return { data: { ok: true } };
    if (url.endsWith('/images/upload-url')) {
      if (linkAnswer) return linkAnswer();
      return { status: 201, data: { upload_url: 'https://storage.example.test/upload/k1.jpg?token=made-up', key: 'made-up-user/c-a-k1.jpg', expires_at: new Date(Date.now() + 600_000).toISOString() } };
    }
    if (body?.kind === 'image') return (photoAnswers.shift() ?? (() => ({ status: 201, data: { message: photoMsg('srv-p1', ME) } })))();
    return { data: { message: msg('sent-1', new Date().toISOString(), ME, 'c-a') } };
  });
  mockApi.delete.mockReset().mockResolvedValue({ data: {} });
});

let client: QueryClient;
let alert: jest.SpyInstance;
beforeEach(() => { alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined); });
afterEach(async () => {
  await act(async () => { authEvents.emit('logout'); });
  client?.clear();
  alert.mockRestore();
  setOS(realOS);
});
const tree = () => <QueryClientProvider client={client}><Screen /></QueryClientProvider>;
const open = async () => {
  client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
  const r = await render(tree());
  await r.findByTestId('space-chat-composer-field');
  return r;
};
type R = Awaited<ReturnType<typeof open>>;
const settle = () => act(async () => { for (let i = 0; i < 15; i += 1) await new Promise((res) => setTimeout(res, 0)); });
const keys = (r: R) => (r.getByTestId('space-chat-list').props.data as Array<{ key: string; type: string }>);
const photoKeys = (r: R) => keys(r).filter((i) => i.type === 'photo').map((i) => i.key);
const modalOf = (r: R, id: string) => {
  let node = r.getByTestId(id) as unknown as { props: Record<string, unknown>; parent: unknown } | null;
  while (node && typeof node.props.onDismiss !== 'function') node = node.parent as typeof node;
  return node;
};
/** +, then Photo library; on iOS the Modal's onDismiss starts the pick (the sheet has gone). */
const pickPhoto = async (r: R) => {
  await fireEvent.press(r.getByTestId('space-chat-plus'));
  const modal = modalOf(r, 'space-chat-add-sheet');
  await fireEvent.press(r.getByTestId('space-chat-add-library'));
  expect(mockLibrary).not.toHaveBeenCalled();
  await act(async () => { (modal?.props.onDismiss as () => void)(); });
  await settle();
};
const label = (r: R, id: string) => {
  const row = r.getByTestId(`space-chat-row-${id}`);
  return within(row).getAllByLabelText(/, (Sending…|Not sent|\d)/)[0].props.accessibilityLabel as string;
};

describe('SCM4 T10: her photo on the screen', () => {
  it('SCM4 T10: on its way: "Sending…", the tile at its own shape from the local file, no menu; spoken "{name}, Sending…. Photo"', async () => {
    const send = hold();
    photoAnswers.push(send.answer);
    const r = await open();
    await pickPhoto(r);
    const [id] = photoKeys(r);
    expect(id).toBeTruthy();
    expect(r.getByTestId(`space-chat-sending-${id}`).props.children).toBe('Sending…');
    expect(StyleSheet.flatten(r.getByTestId(`space-chat-photo-${id}`, { includeHiddenElements: true }).props.style).aspectRatio).toBeCloseTo(1200 / 900);
    expect(r.getByTestId(`space-chat-photo-image-${id}`, { includeHiddenElements: true }).props.source).toEqual({ uri: FILE });
    expect(r.getByTestId(`space-chat-local-busy-${id}`)).toBeTruthy();
    expect(r.queryByTestId(`space-chat-local-menu-${id}`)).toBeNull();
    expect(r.queryByTestId(`space-chat-retry-${id}`)).toBeNull();
    expect(label(r, id)).toBe('Dana Reyes, Sending…. Photo');
    await act(async () => { send.release({ status: 201, data: { message: photoMsg('srv-p1', ME) } }); });
    await settle();
  });

  it('SCM4 T10: not sent: "Not sent", Try again and Delete; Try again posts it once and the local row goes when the list has the id', async () => {
    photoAnswers.push(() => { throw fail(500); });
    const r = await open();
    await pickPhoto(r);
    const [id] = photoKeys(r);
    expect(r.getByTestId(`space-chat-failed-${id}`).props.children).toBe('Not sent');
    expect(r.getByTestId(`space-chat-retry-${id}`)).toBeTruthy();
    expect(r.getByTestId(`space-chat-discard-${id}`)).toBeTruthy();
    expect(label(r, id)).toBe('Dana Reyes, Not sent. Photo');
    spaces['c-a'].page = [photoMsg('srv-p1', ME), ...spaces['c-a'].page];
    await fireEvent.press(r.getByTestId(`space-chat-retry-${id}`));
    await settle();
    await waitFor(() => expect(r.getByTestId('space-chat-row-srv-p1')).toBeTruthy());
    expect(photoKeys(r)).toEqual([]);
    expect(r.queryByTestId(`space-chat-row-${id}`)).toBeNull();
    expect(r.getAllByTestId(/^space-chat-photo-(?!image)/, { includeHiddenElements: true })).toHaveLength(1);
    expect(mockDelete).toHaveBeenCalledWith(FILE, { idempotent: true });
  });

  it('SCM4 T10: Delete drops a Not sent photo and its file', async () => {
    photoAnswers.push(() => { throw fail(503, { code: 'PHOTO_CHECK_UNAVAILABLE' }); });
    const r = await open();
    await pickPhoto(r);
    const [id] = photoKeys(r);
    await fireEvent.press(r.getByTestId(`space-chat-discard-${id}`));
    expect(photoKeys(r)).toEqual([]);
    expect(mockDelete).toHaveBeenCalledWith(FILE, { idempotent: true });
  });

  it('SCM4 T10: the coach\'s photo reads with the Coach mark', async () => {
    mockRole = 'owner';
    mockUser = { id: 'coach-1', name: 'Sam Okafor', coach_id: '' };
    mockStack.routes = ['CoachCommunityCohorts', 'CoachCommunityCohortDetail', 'CommunitySpaceChat'];
    const send = hold();
    photoAnswers.push(send.answer);
    const r = await open();
    await pickPhoto(r);
    const [id] = photoKeys(r);
    expect(label(r, id)).toBe('Sam Okafor, Coach, Sending…. Photo');
    await act(async () => { send.release({ status: 201, data: { message: photoMsg('srv-p1', COACH) } }); });
    await settle();
  });

  it('SCM4 T10: another space shows none of her photos; back in the space they show again', async () => {
    photoAnswers.push(() => { throw fail(500); });
    const r = await open();
    await pickPhoto(r);
    const [id] = photoKeys(r);
    mockParams.current = { cohortId: 'c-b' };
    await r.rerender(tree());
    await r.findByTestId('space-chat-row-b1');
    expect(photoKeys(r)).toEqual([]);
    mockParams.current = { cohortId: 'c-a' };
    await r.rerender(tree());
    await r.findByTestId('space-chat-row-a2');
    expect(photoKeys(r)).toEqual([id]);
    expect(r.getByTestId(`space-chat-failed-${id}`)).toBeTruthy();
  });

  it('SCM4 T10: a photo counts as hers for the New messages line (no line above it)', async () => {
    readAnswer = { last_read_at: '2026-10-22T10:00:00.000Z', last_read_message_id: 'a2' };
    const send = hold();
    photoAnswers.push(send.answer);
    const r = await open();
    await pickPhoto(r);
    expect(photoKeys(r)).toHaveLength(1);
    expect(keys(r).some((i) => i.type === 'new')).toBe(false);
    await act(async () => { send.release({ status: 201, data: { message: photoMsg('srv-p1', ME) } }); });
    await settle();
  });

  it('SCM4 T10: photos off on the server (call 1\'s plain 404) reads Not sent and never closes the space', async () => {
    linkAnswer = () => { throw fail(404, { message: 'Not Found', statusCode: 404 }); };
    const r = await open();
    await pickPhoto(r);
    const [id] = photoKeys(r);
    expect(r.getByTestId(`space-chat-failed-${id}`)).toBeTruthy();
    expect(r.queryByTestId('space-chat-no-access')).toBeNull();
    expect(r.getByTestId('space-chat-composer-field')).toBeTruthy();
  });

  it('SCM4 T10: no longer let in (call 1\'s 404 community.cohort.not_found): the row goes, the list is read again, and the page closes by its own rule', async () => {
    linkAnswer = () => { throw fail(404, { error: 'not_found', code: 'community.cohort.not_found' }); };
    const r = await open();
    spaces['c-a'].refuse = 404;
    await pickPhoto(r);
    expect(await r.findByTestId('space-chat-no-access')).toBeTruthy();
    expect(r.queryByTestId('space-chat-list')).toBeNull();
    expect(alert).not.toHaveBeenCalled();
    expect(mockDelete).toHaveBeenCalledWith(FILE, { idempotent: true });
  });
});

describe('SCM4 T11 (screen) and trap 10: the + in the box', () => {
  it('SCM4 T11: a tap puts the keyboard away first, then opens the pop-up; the pick waits for the sheet to go (iOS)', async () => {
    const dismiss = jest.spyOn(Keyboard, 'dismiss');
    try {
      const r = await open();
      dismiss.mockClear();
      await fireEvent.press(r.getByTestId('space-chat-plus'));
      expect(dismiss).toHaveBeenCalledTimes(1);
      expect(r.getByTestId('space-chat-add-sheet')).toBeTruthy();
      const modal = modalOf(r, 'space-chat-add-sheet');
      await fireEvent.press(r.getByTestId('space-chat-add-library'));
      await settle();
      expect(mockLibrary).not.toHaveBeenCalled();
      await act(async () => { (modal?.props.onDismiss as () => void)(); });
      await settle();
      expect(mockLibrary).toHaveBeenCalledTimes(1);
    } finally {
      dismiss.mockRestore();
    }
  });

  it('SCM4 trap 10: the field starts at the same place with the + and with a reply\'s empty slot (6 + 44 + 6 pt)', async () => {
    const r = await open();
    const barOf = () => r.getByTestId('space-chat-composer');
    const lead = () => {
      const bar = barOf();
      const first = bar.children[0] as unknown as { props: { style: ViewStyle } };
      return { pad: StyleSheet.flatten(bar.props.style).paddingLeft, gap: StyleSheet.flatten(bar.props.style).gap, slot: StyleSheet.flatten(first.props.style).width };
    };
    const withPlus = lead();
    expect(within(barOf()).getByTestId('space-chat-plus')).toBeTruthy();
    await fireEvent(await r.findByTestId('space-chat-row-a2'), 'longPress');
    const modal = modalOf(r, 'space-chat-sheet');
    await fireEvent.press(r.getByTestId('space-chat-sheet-reply'));
    await act(async () => { (modal?.props.onDismiss as () => void)(); });
    await r.findByLabelText(/^Replying to /);
    expect(r.queryByTestId('space-chat-plus')).toBeNull();
    const withReply = lead();
    expect(withPlus).toEqual({ pad: 6, gap: 6, slot: 44 });
    expect(withReply).toEqual(withPlus);
  });

  it('SCM4 P3: while she types the + stays and Send takes the mic\'s place', async () => {
    const r = await open();
    await fireEvent.changeText(r.getByTestId('space-chat-composer-field'), 'Morning all');
    expect(r.getByTestId('space-chat-plus')).toBeTruthy();
    expect(r.getByTestId('space-chat-composer-send')).toBeTruthy();
    expect(r.queryByTestId('space-chat-mic')).toBeNull();
  });
});
