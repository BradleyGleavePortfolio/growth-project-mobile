/**
 * LEAVE-MUTE-M (agent 203; owner D2e; LEAVE-MUTE-MOCK Style 1 L5 and L5d, #203-E120): one space-list read with
 * include_left feeds the tree on Home and in the drawer. "Spaces" holds the spaces she is in; "Spaces you left" (LM-13),
 * after Direct messages, holds the ones she left, each with Join, and no count. Case L9 of the job text, and Join from
 * the tree (class b). The server answers are made up.
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, replace: jest.fn(), goBack: jest.fn() }),
  useRoute: () => ({ params: {} }),
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaInsetsContext: require('react').createContext(null),
}));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'me-1', coach_id: 'coach-1' }) }));
jest.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('../../../config/featureFlags', () => ({ featureFlags: { communityChallenges: false, communitySearch: false, communityClassroom: false, communitySpaceChat: true } }));
jest.mock('../../../ui/haptics/haptics.service', () => ({ HapticService: { selection: jest.fn(), error: jest.fn(), softImpact: jest.fn(), success: jest.fn() } }));
const mockApi = { get: jest.fn(), post: jest.fn() };
jest.mock('../../../services/api', () => ({ __esModule: true, default: mockApi }));
jest.mock('../../../screens/community/CommunityChallengesScreen', () => () => null);

let mockRows: Array<Record<string, unknown>> = [];
jest.mock('../../../hooks/useCommunity', () => {
  const { useQuery } = jest.requireActual('@tanstack/react-query');
  return {
    useCommunityMe: () => ({ data: { feature_flag_state: 'enabled', workspace_id: 'ws-1', unread: { cohort_messages: 4, dm_messages: 0, mentions: 0 } }, isLoading: false, isError: false }),
    useCommunityCohorts: () => useQuery({ queryKey: ['community', 'cohorts'], queryFn: async () => ({ feature_flag_state: 'enabled', cohorts: mockRows.map((r) => ({ ...r })) }) }),
    useCommunityWorkspace: (id: string | null) => ({ data: id ? { name: "Sam's Strength Club" } : undefined }),
    communityKeys: { cohorts: () => ['community', 'cohorts'], me: () => ['community', 'me'] },
  };
});

// Required here, after the stand-ins above exist (an import would load them before mockApi is set).
const CommunityHomeScreen = require('../../../screens/community/CommunityHomeScreen').default as React.ComponentType;
const { SpaceTree, useSpaceTree } = require('../SpaceTree') as typeof import('../SpaceTree');

const row = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, workspace_id: 'ws-1', name, is_default: false, kind: 'chat', member_count: 14, my_role: 'client', left_at: null, ...extra });
const offline = () => Object.assign(new Error('Network Error'), { isAxiosError: true });
const deferred = <T,>() => { let resolve!: (v: T) => void; const promise = new Promise<T>((a) => { resolve = a; }); return { promise, resolve }; };
let client: QueryClient;
const mount = async (ui: React.ReactElement) => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const r = await render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  await waitFor(() => expect(r.queryByTestId('community-home-loading')).toBeNull());
  return r;
};
const sectionKeys = () => screen.queryAllByTestId(/^space-section-/).map((n) => n.props.testID);
const rowKeys = () => screen.queryAllByTestId(/^space-row-/).map((n) => String(n.props.testID)).filter((k) => !/-(badge|join|failed)$/.test(k));

beforeEach(() => {
  jest.clearAllMocks();
  mockRows = [
    row('c-ann', 'Announcements', { kind: 'announcement', unread_count: 1 }),
    row('c-every', 'Everyone', { unread_count: 3 }),
    row('c-food', 'Food questions'),
  ];
  mockApi.get.mockImplementation(async (url: string) => {
    if (url === '/messages/unread-count') return { data: { total: 0 } };
    if (url === '/messages?limit=1') return { data: [], headers: {} };
    return { data: { name: 'Sam Carter' } };
  });
  mockApi.post.mockImplementation(async (url: string) => {
    const id = String(url).split('/')[3];
    mockRows = mockRows.map((r) => (r.id === id ? { ...r, left_at: null } : r));
    return { data: { cohort_id: id, left_at: null } };
  });
});
afterEach(() => client?.clear());

describe('LEAVE-MUTE-M Spaces you left in the tree (L9)', () => {
  it('L9 (green at both): a list with no left rows draws Spaces as before and no Spaces you left', async () => {
    await mount(<CommunityHomeScreen />);
    await screen.findByLabelText('Everyone, 3 new');
    expect(screen.getByLabelText('Announcements, 1 new')).toBeTruthy();
    expect(screen.getByLabelText('Food questions')).toBeTruthy();
    expect(screen.queryByText('Spaces you left')).toBeNull();
  });

  it('L9: Spaces you left lists exactly the rows with left_at, after Direct messages, with Join and no count; Spaces lists the rest', async () => {
    mockRows = [...mockRows, row('c-morning', 'Morning crew', { left_at: '2026-11-27T16:00:00.000Z', unread_count: 5 }), row('c-run', 'Run club', { left_at: '2026-11-26T10:00:00.000Z' })];
    await mount(<CommunityHomeScreen />);
    await screen.findByText('Spaces you left');
    await waitFor(() => expect(sectionKeys()).toEqual(['space-section-spaces', 'space-section-dms', 'space-section-left']));
    const spaces = ['space-row-c-ann', 'space-row-c-every', 'space-row-c-food'];
    expect(rowKeys().filter((k) => spaces.includes(k))).toEqual(spaces);
    expect(screen.getByTestId('space-row-c-morning')).toBeTruthy();
    expect(screen.getByTestId('space-row-c-run')).toBeTruthy();
    expect(rowKeys().indexOf('space-row-c-morning')).toBeGreaterThan(rowKeys().indexOf('space-row-coach'));
    expect(screen.queryByTestId('space-row-c-morning-badge')).toBeNull(); // a left space adds no count
    expect(screen.getByLabelText('Join Morning crew')).toBeTruthy();
    expect(within(screen.getByTestId('space-row-c-morning-join')).getByText('Join')).toBeTruthy();
    // Tapping the row opens the left space (readable, with Join again there).
    await fireEvent.press(screen.getByTestId('space-row-c-morning'));
    expect(mockNavigate).toHaveBeenCalledWith('CommunitySpaceChat', { cohortId: 'c-morning' });
  });

  it('L9: Join calls POST .../join once, shows it is working, and moves the space under Spaces only after the answer', async () => {
    mockRows = [...mockRows, row('c-morning', 'Morning crew', { left_at: '2026-11-27T16:00:00.000Z' })];
    await mount(<CommunityHomeScreen />);
    const join = await screen.findByTestId('space-row-c-morning-join');
    const answer = deferred<{ data: unknown }>();
    mockApi.post.mockImplementationOnce(() => answer.promise);
    await fireEvent.press(join);
    await fireEvent.press(screen.getByTestId('space-row-c-morning-join'));
    expect(mockApi.post).toHaveBeenCalledTimes(1);
    expect(mockApi.post).toHaveBeenCalledWith('/community/cohorts/c-morning/join', {});
    expect(screen.getByTestId('space-row-c-morning-join').props.accessibilityState).toEqual(expect.objectContaining({ busy: true }));
    expect(screen.getByText('Spaces you left')).toBeTruthy();
    mockRows = mockRows.map((r) => (r.id === 'c-morning' ? { ...r, left_at: null } : r));
    await act(async () => { answer.resolve({ data: { cohort_id: 'c-morning', left_at: null } }); });
    await waitFor(() => expect(screen.queryByText('Spaces you left')).toBeNull());
    expect(screen.getByLabelText('Morning crew')).toBeTruthy();
  });

  it('L9: a Join that fails (offline) keeps the row and says so under it', async () => {
    mockRows = [...mockRows, row('c-morning', 'Morning crew', { left_at: '2026-11-27T16:00:00.000Z' })];
    await mount(<CommunityHomeScreen />);
    mockApi.post.mockImplementationOnce(async () => { throw offline(); });
    await fireEvent.press(await screen.findByTestId('space-row-c-morning-join'));
    const line = await screen.findByTestId('space-row-c-morning-failed');
    expect(within(line).getByText('You appear to be offline. Check your connection, then try again.')).toBeTruthy();
    expect(screen.getByText('Spaces you left')).toBeTruthy();
  });

  it('L9: the one space-list read asks the server for the spaces she left (?include_left=1), under the one key', async () => {
    const real = jest.requireActual('../../../hooks/useCommunity') as typeof import('../../../hooks/useCommunity');
    // The wire schema checks ids (UUIDs) and the role, as the server sends them.
    const id = '00000002-0000-4000-8000-000000000000';
    mockApi.get.mockImplementation(async () => ({ data: { feature_flag_state: 'enabled', cohorts: [row(id, 'Morning crew', { workspace_id: '00000001-0000-4000-8000-000000000000', left_at: '2026-11-27T16:00:00.000Z' })] } }));
    let seen: unknown = null;
    const Reader = () => { seen = real.useCommunityCohorts().data; return null; };
    await mount(<Reader />);
    await waitFor(() => expect(seen).toBeTruthy());
    const reads = mockApi.get.mock.calls.filter(([u]) => u === '/community/cohorts');
    expect(reads).toHaveLength(1);
    expect(reads[0][1]).toEqual({ params: { include_left: 1 } });
    expect((seen as { cohorts: Array<{ left_at?: string | null }> }).cohorts[0].left_at).toBe('2026-11-27T16:00:00.000Z');
    expect(client.getQueryCache().findAll({ queryKey: ['community', 'cohorts'] })).toHaveLength(1);
  });

  it('L9: the drawer (deep) draws the same section from the same read', async () => {
    mockRows = [...mockRows, row('c-morning', 'Morning crew', { left_at: '2026-11-27T16:00:00.000Z' })];
    const Drawer = () => {
      const tree = useSpaceTree();
      return <SpaceTree sections={tree.sections} deep onOpen={() => undefined} />;
    };
    await mount(<Drawer />);
    await screen.findByText('Spaces you left');
    expect(screen.getByTestId('space-row-c-morning-join')).toBeTruthy();
    expect(screen.getByLabelText('Everyone, 3 new')).toBeTruthy();
    expect(client.getQueryCache().findAll({ queryKey: ['community', 'cohorts'] })).toHaveLength(1);
  });
});

// LEAVE-MUTE-M r2, from the renders (GOAL vs BUILT, s1_L5 and s1_L5d): the name takes the row's free width, so Join sits
// at the row's end (and a long name wraps before it instead of pushing Join off the row).
type JsonNode = { type: string; props: Record<string, unknown>; children: Array<JsonNode | string> | null };
const rowOf = (n: JsonNode | string | null | undefined, joinId: string): JsonNode | null => {
  if (!n || typeof n === 'string') return null;
  if ((n.children ?? []).some((c) => typeof c !== 'string' && c.props?.testID === joinId)) return n;
  for (const c of n.children ?? []) { const f = rowOf(c, joinId); if (f) return f; }
  return null;
};
describe('LEAVE-MUTE-M renders r2: a left row as Style 1 draws it', () => {
  it.each([['Home', false], ['the drawer', true]])('s1_L5 / s1_L5d (%s): the name\'s area takes the free width and Join sits at the end', async (_where, deep) => {
    mockRows = [...mockRows, row('c-morning', 'Morning crew', { left_at: '2026-11-27T16:00:00.000Z' })];
    const Tree = () => { const t = useSpaceTree(); return <SpaceTree sections={t.sections} deep={deep} onOpen={() => undefined} />; };
    await mount(deep ? <Tree /> : <CommunityHomeScreen />);
    await screen.findByTestId('space-row-c-morning-join');
    const { StyleSheet } = jest.requireActual('react-native') as typeof import('react-native');
    const json = screen.toJSON() as JsonNode | JsonNode[];
    const found = (Array.isArray(json) ? json : [json]).map((j) => rowOf(j, 'space-row-c-morning-join')).find(Boolean);
    const kids = (found?.children ?? []).filter((c): c is JsonNode => typeof c !== 'string');
    expect(kids).toHaveLength(2);
    expect(kids[1].props.testID).toBe('space-row-c-morning-join');
    expect(StyleSheet.flatten(kids[0].props.style as never)).toEqual(expect.objectContaining({ flex: 1 }));
  });
});
