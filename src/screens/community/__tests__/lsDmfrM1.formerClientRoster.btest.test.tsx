/**
 * LS-DMFR-M-1 B1 (B-TEST, fails at a5a3d96f): the coach's Direct messages list calls a row "Former client" whenever the
 * person is not on the roster the phone holds (CoachDmListScreen.tsx:75-85). That roster is saved on the phone and read
 * again only when it is stale and a screen mounts (coachDm.tsx:50-73), never because the thread list changed. So a client
 * who joined after the roster was read, and sends her first message, is drawn as "Former client" on a coach she has just
 * joined: for as long as the roster's own re-read is out when the list opens, and for as long as the list stays open
 * when the message arrives while it is on screen.
 * The real CoachDmListScreen, DmRow, coachDm, communityApi and react-query; only the HTTP edge, theme, icons, storage,
 * realtime, navigation and the signed-in person are stood in. Names and ids are fictional.
 */
import React from 'react';
import { act, render, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockGet = jest.fn();
const mockGetClients = jest.fn();
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => mockGet(...a), post: jest.fn(), patch: jest.fn(), put: jest.fn(), delete: jest.fn() },
  coachApi: { getClients: (...a: unknown[]) => mockGetClients(...a) },
}));
const mockTheme = () => {
  const tokens = jest.requireActual('../../../theme/tokens');
  return { colors: jest.requireActual('../../../constants/colors').default, tokens: tokens.default, semanticColors: tokens.lightTokens, colorScheme: 'light', isDark: false };
};
jest.mock('../../../theme/useTheme', () => ({ useTheme: () => mockTheme() }));
jest.mock('../../../theme/ThemeProvider', () => ({ useTheme: () => mockTheme(), LightTheme: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('@expo/vector-icons', () => {
  const R = require('react');
  const { Text: T } = require('react-native');
  const Icon = (p: { name: string }) => R.createElement(T, { testID: `icon-${p.name}` }, '');
  return { Ionicons: Icon, MaterialIcons: Icon, Feather: Icon };
});
jest.mock('../../../storage/mmkv', () => ({
  cacheStorage: { getString: () => undefined, getStringAsync: async () => undefined, set: async () => undefined, delete: async () => undefined, getAllKeys: async () => [] },
  prefsStorage: { getString: () => undefined, set: () => undefined },
}));
jest.mock('../../../api/communityRealtime', () => new Proxy({ __esModule: true }, {
  get: (target, key) => (key in target ? target[key as keyof typeof target] : () => () => undefined),
}));
let mockUser: { id: string; role: string; name: string; firstName: string } | null = null;
jest.mock('../../../hooks/useCurrentUser', () => ({ ...jest.requireActual('../../../hooks/useCurrentUser'), useCurrentUser: () => mockUser }));
const mockNav = { navigate: jest.fn(), goBack: jest.fn(), addListener: () => () => undefined, setOptions: () => undefined };
jest.mock('@react-navigation/native', () => {
  const R = require('react');
  return {
    NavigationContext: R.createContext(undefined),
    useNavigation: () => mockNav,
    useRoute: () => ({ params: {} }),
    useFocusEffect: (cb: () => void | (() => void)) => R.useEffect(() => cb(), [cb]),
    useIsFocused: () => true,
  };
});

const CoachDmListScreen = require('../coach-dm/CoachDmListScreen').default;
const { refreshDmReadsIn } = require('../../../services/dmReads');

const uuid = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const WS = uuid(2); // Maya's community
const MAYA = uuid(30); // the coach
const SAM = uuid(40); // joined Maya today: her client now
const JORDAN = uuid(41); // her client all along
const PRIYA = uuid(42); // left Maya: a former client who keeps her thread
const NOW = Date.now();
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const ME = {
  feature_flag_state: 'enabled', workspace_id: WS, membership: null,
  unread: { cohort_messages: 0, dm_messages: 0, mentions: 0 },
  flags: { community_api: true, community_dm: true, community_realtime: false, community_push: true, community_telemetry: false },
  former_coach_dms: [],
};
const thread = (other: string, at: string, name: string) => ({
  thread_id: `${WS}:${other}`, workspace_id: WS, other_user_id: other, created_at: null, last_message_at: at, other_display_name: name,
});
const client = (id: string, name: string) => ({ id, name, archived_at: null });
const ROSTER_KEY = ['coach', 'dm-roster', MAYA];

let threads: unknown[] = [];
let qc: QueryClient;
const open = () => render(<QueryClientProvider client={qc}><CoachDmListScreen /></QueryClientProvider>);

beforeEach(() => {
  mockGet.mockReset();
  mockGetClients.mockReset();
  mockUser = { id: MAYA, role: 'coach', name: 'Maya Brooks', firstName: 'Maya' };
  mockGet.mockImplementation(async (url: string) => {
    const key = url.split('?')[0];
    if (key === '/community/me') return { data: ME, headers: {} };
    if (key === `/community/workspaces/${WS}/dms`) return { data: { threads }, headers: {} };
    throw Object.assign(new Error('HTTP 404'), { isAxiosError: true, response: { status: 404, data: {} } });
  });
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
});

describe('LS-DMFR-M-1 B1: "Former client" is said only of a client who left', () => {
  it('a client who joined after the saved roster was read is not called "Former client" while the roster is read again', async () => {
    // The roster the phone saved ten minutes ago: Sam had not joined yet. It is stale, so opening the list reads it again.
    qc.setQueryData(ROSTER_KEY, { [JORDAN]: { name: 'Jordan Lee', archived: false } }, { updatedAt: NOW - 10 * 60_000 });
    let answerRoster: (v: { data: unknown[] }) => void = () => undefined;
    mockGetClients.mockImplementation(() => new Promise((resolve) => { answerRoster = resolve; }));
    threads = [thread(SAM, ago(1), 'Sam Rivera'), thread(JORDAN, ago(60), 'Jordan Lee'), thread(PRIYA, ago(90), 'Priya Shah')];
    const view = await open();
    const sam = await waitFor(() => view.getByTestId(`coach-dm-row-${SAM}`));
    await waitFor(() => expect(mockGetClients).toHaveBeenCalled()); // the roster's own re-read is out
    // Sam is her client now. Until the roster read answers, the phone does not know she left: it must not say so.
    expect(within(sam).queryByText('Former client')).toBeNull();
    expect(sam.props.accessibilityLabel).not.toMatch(/former client/i);

    await act(async () => { answerRoster({ data: [client(SAM, 'Sam Rivera'), client(JORDAN, 'Jordan Lee')] }); });
    await waitFor(() => expect(within(view.getByTestId(`coach-dm-row-${SAM}`)).getByText('Sam Rivera')).toBeTruthy());
    expect(within(view.getByTestId(`coach-dm-row-${SAM}`)).queryByText('Former client')).toBeNull();
    // The roster answered without Priya: she did leave, and her row says so (S3_coach).
    await waitFor(() => expect(within(view.getByTestId(`coach-dm-row-${PRIYA}`)).getByText('Former client')).toBeTruthy());
  });

  it('a new client\'s first message arriving while the list is open is not left as "Former client"', async () => {
    // The list opens with a fresh roster: Jordan only. Sam joins Maya a little later.
    mockGetClients.mockResolvedValue({ data: [client(JORDAN, 'Jordan Lee')] });
    threads = [thread(JORDAN, ago(60), 'Jordan Lee')];
    const view = await open();
    await waitFor(() => expect(view.getByTestId(`coach-dm-row-${JORDAN}`)).toBeTruthy());

    // Sam joins (she is on the server's roster now) and sends her first message: the ping re-reads the DM lists.
    mockGetClients.mockResolvedValue({ data: [client(SAM, 'Sam Rivera'), client(JORDAN, 'Jordan Lee')] });
    threads = [thread(SAM, ago(0), 'Sam Rivera'), thread(JORDAN, ago(60), 'Jordan Lee')];
    await act(async () => { refreshDmReadsIn(qc); });
    await waitFor(() => expect(view.getByTestId(`coach-dm-row-${SAM}`)).toBeTruthy());
    // A listed person who is not on the held roster is asked about before she is called former.
    await waitFor(() => expect(within(view.getByTestId(`coach-dm-row-${SAM}`)).queryByText('Former client')).toBeNull());
  });
});
