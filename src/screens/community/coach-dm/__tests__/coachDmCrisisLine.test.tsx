/**
 * COACH-DM-CRISIS-TEST-M (LS-962R1 C2 = LO-962R1 C3; operator ruling 10:5x, folded into REFINE-962): the coach's own
 * community DM thread shows m#964's 911 / 988 line when the server's crisis check matched the coach's text, exactly as
 * the client's thread does. The real CoachDmThreadScreen is mounted; only the wire (`services/api`), the roster read,
 * the theme-free natives and the signed-in person are stubbed, with m#964's method (crisisTextM.table.test.tsx: the
 * Alert spy, `lineAlerts`, the user cache as the account check). Every body here is ordinary words ([R22]): the phone
 * never reads the text, the flag comes only from the server's answer. m#964's six-row table is not touched.
 */
import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockDisk = new Map<string, string>();
jest.mock('../../../../storage/mmkv', () => ({
  ...jest.requireActual('../../../../storage/mmkv'),
  cacheStorage: {
    getString: () => undefined,
    getStringAsync: async (k: string) => mockDisk.get(k),
    set: async (k: string, v: string) => { mockDisk.set(k, v); },
    delete: async (k: string) => { mockDisk.delete(k); },
    getAllKeys: async () => [...mockDisk.keys()],
  },
}));
const mockPost = jest.fn();
const mockGet = jest.fn();
const mockGetClients = jest.fn();
jest.mock('../../../../services/api', () => ({
  __esModule: true,
  default: { post: (...a: unknown[]) => mockPost(...a), get: (...a: unknown[]) => mockGet(...a) },
  coachApi: { getClients: (...a: unknown[]) => mockGetClients(...a) },
}));
jest.mock('../../../../services/secureStorage', () => ({ secureStorage: { getItem: jest.fn(async () => 'test-token') } }));
jest.mock('../../../../utils/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('../../../../services/sentry', () => ({ captureError: jest.fn(), setSentryUser: jest.fn() }));
jest.mock('../../../../lib/analytics', () => ({ ...jest.requireActual('../../../../lib/analytics'), track: jest.fn(), capture: jest.fn() }));
const COACH = '20000000-0000-4000-8000-000000000000';
const CLIENT = '30000000-0000-4000-8000-000000000000';
const WS = '10000000-0000-4000-8000-000000000000';
jest.mock('../../../../hooks/useCurrentUser', () => ({
  ...jest.requireActual('../../../../hooks/useCurrentUser'),
  useCurrentUser: () => ({ id: '20000000-0000-4000-8000-000000000000', role: 'coach', name: 'Sam Rivera', firstName: 'Sam', coach_id: null }),
}));
jest.mock('@react-navigation/native', () => ({
  NavigationContext: jest.requireActual('react').createContext({ goBack: jest.fn(), navigate: jest.fn() }),
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), dispatch: jest.fn() }),
  useRoute: () => ({ params: { recipientId: '30000000-0000-4000-8000-000000000000', name: 'Jordan Lee' } }),
  useFocusEffect: () => undefined,
}));
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../../../components/community/SafetyMenu', () => () => null);

const { communityApi } = require('../../../../api/communityApi');
const { authEvents } = require('../../../../utils/authEvents');
const { setUserCache, clearUserCache } = require('../../../../lib/userCache');
const { CRISIS_LINE_911_988 } = require('../../../../constants/crisisLines');
const CoachDmThreadScreen = require('../CoachDmThreadScreen').default;

/** CONTENT_REJECTED.message (backend community-safety.service.ts:33-38), as m#964's table copies it. */
const REFUSED = 'This message was not posted because it appears to contain abusive or explicit language. Please rephrase it.';
const NOW = '2026-11-12T12:00:00.000Z';
const WORDS = 'See you at the Saturday session'; // ordinary words ([R22])
const PATH = `/community/workspaces/${WS}/dms/${CLIENT}/messages`;
const NO_ANSWER = { isAxiosError: true, message: 'Network Error' };
const FIELD = 'coach-dm-thread-composer-field';
const SEND = 'coach-dm-thread-composer-send';

/** The send answer (community-dms.service.ts:191-244: `{ message, ...crisisField }`). */
const answer = (flag: Record<string, unknown>) => ({
  message: {
    id: '77777777-7777-4777-8777-777777777777', thread_id: `${WS}:${[COACH, CLIENT].sort().join(':')}`, sender_user_id: COACH,
    recipient_user_id: CLIENT, body: WORDS, created_at: NOW, deleted: false,
  },
  ...flag,
});
/** The 422 for refused words, with the flag beside the envelope (m#964's `refusal`, same server lines). */
const refusal = (flag: Record<string, unknown>) => ({
  isAxiosError: true,
  message: 'Request failed with status code 422',
  response: {
    status: 422, headers: {},
    data: { statusCode: 422, code: 'community.content.rejected', message: REFUSED, error: 'content_rejected', timestamp: NOW, path: PATH, ...flag },
  },
});

let client: QueryClient;
type View = Awaited<ReturnType<typeof render>>;
const alerts = () => (Alert.alert as unknown as jest.Mock).mock.calls;
const lineAlerts = () => alerts().filter((c) => String(c[1] ?? '').includes(CRISIS_LINE_911_988) || String(c[0] ?? '').includes(CRISIS_LINE_911_988));
const sends = () => mockPost.mock.calls.filter(([url]) => String(url) === PATH);
const fieldValue = (v: View) => v.getByTestId(FIELD).props.value as string;

async function openAndSend(): Promise<View> {
  const v = await render(<QueryClientProvider client={client}><CoachDmThreadScreen /></QueryClientProvider>);
  await waitFor(() => expect(v.getByTestId(FIELD)).toBeTruthy());
  await fireEvent.changeText(v.getByTestId(FIELD), WORDS);
  await act(async () => { fireEvent.press(v.getByTestId(SEND)); });
  return v;
}

beforeEach(async () => {
  jest.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  mockPost.mockReset().mockRejectedValue(NO_ANSWER);
  mockGet.mockReset().mockRejectedValue(NO_ANSWER);
  mockGetClients.mockReset().mockResolvedValue({ data: [{ id: CLIENT, name: 'Jordan Lee', archived_at: null }] });
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  jest.spyOn(communityApi, 'getMe').mockResolvedValue({
    feature_flag_state: 'enabled', workspace_id: WS, membership: null, unread: { cohort_messages: 0, dm_messages: 0, mentions: 0 },
    flags: { community_api: true, community_dm: true, community_realtime: false, community_push: true, community_telemetry: false },
  });
  jest.spyOn(communityApi, 'listDmMessages').mockResolvedValue([]);
  authEvents.emit('logout'); // no draft or key left from the case before
  await waitFor(() => expect([...mockDisk.keys()]).toEqual([]));
  await setUserCache({ id: COACH, role: 'coach', firstName: 'Sam', coach_id: null });
});
afterEach(async () => {
  jest.restoreAllMocks();
  await clearUserCache();
});

describe('COACH-DM-CRISIS-TEST-M: the coach\'s DM thread shows the 911 / 988 line on a flagged send', () => {
  it('1. a send answered with crisis_flag true: one alert, no title, the approved line; the message posts and the box empties', async () => {
    mockPost.mockImplementation((url: unknown) => (String(url) === PATH ? Promise.resolve({ data: answer({ crisis_flag: true }) }) : Promise.reject(NO_ANSWER)));
    const v = await openAndSend();
    await waitFor(() => expect(lineAlerts()).toHaveLength(1));
    expect(lineAlerts()[0]).toEqual(['', CRISIS_LINE_911_988]);
    await waitFor(() => expect(fieldValue(v)).toBe(''));
    expect(sends()).toHaveLength(1);
    expect(sends()[0][1]).toEqual({ body: WORDS });
    expect(alerts()).toHaveLength(1); // nothing else is said
    await v.unmount();
  });

  it('2. a 422 carrying the flag: one alert, the line first and then the refusal; the draft stays', async () => {
    mockPost.mockImplementation((url: unknown) => (String(url) === PATH ? Promise.reject(refusal({ crisis_flag: true })) : Promise.reject(NO_ANSWER)));
    const v = await openAndSend();
    await waitFor(() => expect(lineAlerts()).toHaveLength(1));
    const [title, message] = lineAlerts()[0];
    expect(title).toBe('Please rephrase');
    expect(message).toBe(`${CRISIS_LINE_911_988}\n\n${REFUSED}`);
    expect(alerts()).toHaveLength(1);
    await waitFor(() => expect(fieldValue(v)).toBe(WORDS));
    await v.unmount();
  });

  it.each([
    ['no field', {}],
    ['crisis_flag false', { crisis_flag: false }],
    ['crisis_flag "true"', { crisis_flag: 'true' }],
  ])('3. %s: no line, and the send is as it was', async (_label, flag) => {
    mockPost.mockImplementation((url: unknown) => (String(url) === PATH ? Promise.resolve({ data: answer(flag) }) : Promise.reject(NO_ANSWER)));
    const v = await openAndSend();
    await waitFor(() => expect(fieldValue(v)).toBe(''));
    await waitFor(() => expect(sends()).toHaveLength(1));
    expect(lineAlerts()).toHaveLength(0);
    expect(alerts()).toHaveLength(0);
    await v.unmount();
  });

  it('4. the account changes between the send and its answer: no line (communityCrisisLine.ts:56-58)', async () => {
    let land!: (data: unknown) => void;
    const held = new Promise((resolve) => { land = (data) => resolve({ data }); });
    mockPost.mockImplementation((url: unknown) => (String(url) === PATH ? held : Promise.reject(NO_ANSWER)));
    const v = await openAndSend();
    await waitFor(() => expect(sends()).toHaveLength(1));
    await setUserCache({ id: '12121212-1212-4212-8212-121212121212', role: 'coach' });
    await act(async () => { land(answer({ crisis_flag: true })); await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)); });
    await v.unmount();
    expect(lineAlerts()).toHaveLength(0);
  });
});
