/**
 * KT-2, the phone half: the composers of src/__tests__/memberContentAccess.test.tsx's REGISTRY, drawn. Read that file's
 * header first (planning/KNOWN_TRAPS.md KT-2: what a builder does when this goes red).
 *
 * Every registered composer host (HOSTS below, keyed by the REGISTRY file) is drawn with real React Query and the real
 * community hooks; only the wire (communityApi, communityChallengesApi), navigation, theme and the signed-in user are
 * stubbed, as the screens' own tests do. For each closed state that applies to it (I blocked them, they blocked me,
 * banned, removed or left the space) it must draw nothing typeable and no way to send, and none of the other person's words;
 * the open case proves the harness sees the box at all.
 *
 * When a case goes red: the host stopped closing for that state. Make it close again (useConversationClosed and
 * ConversationClosedLine); never loosen the case. A KNOWN GAP case (it.failing) that goes red means the gap is fixed:
 * delete it from GAPS. A new composer joins REGISTRY and HOSTS. Never add a GAPS row yourself: ask the operator.
 */
import React from 'react';
import { Alert } from 'react-native';
import { act, render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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
const mockParams: { current: Record<string, unknown> } = { current: {} };
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), canGoBack: () => true, setOptions: jest.fn(), addListener: () => () => undefined }),
  useRoute: () => ({ params: mockParams.current }),
  useFocusEffect: (cb: () => void | (() => void)) => require('react').useEffect(() => cb(), [cb]),
  useIsFocused: () => true,
}));
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: '22222222-2222-4222-8222-222222222222', firstName: 'Dana', coach_id: '99999999-9999-4999-8999-999999999999' }) }));
jest.mock('../services/api', () => ({ __esModule: true, default: { get: async () => ({ data: { name: 'Sam Rivera' } }), post: jest.fn(), delete: jest.fn() } }));
jest.mock('../components/community/SafetyMenu', () => () => null);
// The voice record entry stands in as a marker: the space draws it only while it is open.
jest.mock('../components/community/VoiceNotesSection', () => ({
  __esModule: true,
  default: ({ testID }: { testID?: string }) => require('react').createElement(require('react-native').Text, { testID }, 'Record a voice note'),
}));
jest.mock('../config/featureFlags', () => {
  const actual = jest.requireActual('../config/featureFlags');
  return { ...actual, featureFlags: { ...actual.featureFlags, communityChallenges: true, communityVoiceNotes: true } };
});
const mockWire = {
  getMe: jest.fn(), listPosts: jest.fn(), getPost: jest.fn(), listComments: jest.fn(), listDmMessages: jest.fn(),
  listDmThreads: jest.fn(), sendDm: jest.fn(), createPost: jest.fn(), addComment: jest.fn(), reactToPost: jest.fn(),
  unreactToPost: jest.fn(), deletePost: jest.fn(), getToday: jest.fn(), getCohorts: jest.fn(), getWorkspace: jest.fn(),
};
jest.mock('../api/communityApi', () => ({
  ...jest.requireActual('../api/communityApi'),
  communityApi: new Proxy({}, { get: (_t, k: string) => (...a: unknown[]) => (mockWire as Record<string, jest.Mock>)[k]?.(...a) }),
}));
const mockChallenges = {
  getChallenge: jest.fn(), listComments: jest.fn(), getLeaderboard: jest.fn(), join: jest.fn(), updateProgress: jest.fn(),
  setLeaderboardOptIn: jest.fn(), addComment: jest.fn(), reportComment: jest.fn(),
};
jest.mock('../api/communityChallengesApi', () => ({
  communityChallengesApi: new Proxy({}, { get: (_t, k: string) => (...a: unknown[]) => (mockChallenges as Record<string, jest.Mock>)[k]?.(...a) }),
  CHALLENGE_COMMENTS_PAGE_LIMIT: 20,
  CHALLENGE_LEADERBOARD_PAGE_LIMIT: 20,
}));

/* eslint-disable @typescript-eslint/no-var-requires */
const { CommunityApiError } = jest.requireActual('../api/apiCall');
const { useBlockedUsersStore } = require('../store/blockedUsersStore');
const { authEvents } = require('../utils/authEvents');
const CommunityDmThreadScreen = require('../screens/community/CommunityDmThreadScreen').default;
const CommunityComposerScreen = require('../screens/community/CommunityComposerScreen').default;
const CommunityThreadScreen = require('../screens/community/CommunityThreadScreen').default;
const CommunitySpaceScreen = require('../screens/community/CommunitySpaceScreen').default;
const CommunityChallengeDetailScreen = require('../screens/community/CommunityChallengeDetailScreen').default;
/* eslint-enable @typescript-eslint/no-var-requires */

const WS = '11111111-1111-4111-8111-111111111111';
const ME = '22222222-2222-4222-8222-222222222222';
const THEM = '44444444-4444-4444-4444-444444444444';
const POST = '33333333-3333-4333-8333-333333333333';
const WORDS = 'words of the other person';
const at = '2026-10-29T10:00:00.000Z';

const refused = (status: number, code: string) =>
  new CommunityApiError('unknown', status, 'community request failed', { isAxiosError: true, response: { status, data: { code } } });
const challengeRefused = (status: number, code: string) => ({ isAxiosError: true, response: { status, data: { code } } });

type State = 'open' | 'I blocked them' | 'they blocked me' | 'banned' | 'removed or left the space';
const CLOSED: Exclude<State, 'open'>[] = ['I blocked them', 'they blocked me', 'banned', 'removed or left the space'];

function wireOpen() {
  Object.values(mockWire).forEach((m) => m.mockReset());
  Object.values(mockChallenges).forEach((m) => m.mockReset());
  mockWire.getMe.mockResolvedValue({ workspace_id: WS, unread: { cohort_messages: 0, dm_messages: 0, mentions: 0 } });
  mockWire.listPosts.mockResolvedValue({ posts: [{ id: POST, workspace_id: WS, cohort_id: null, author_user_id: THEM, title: 'Week 3', body: WORDS, scope: 'hall', type: 'text', pinned: false, created_at: at, updated_at: at, deleted: false }], next_before: null });
  mockWire.getPost.mockResolvedValue({ id: POST, workspace_id: WS, cohort_id: null, author_user_id: THEM, title: 'Week 3', body: WORDS, scope: 'hall', type: 'text', pinned: false, created_at: at, updated_at: at, deleted: false });
  mockWire.listComments.mockResolvedValue([]);
  mockWire.listDmMessages.mockResolvedValue([{ id: '55555555-5555-4555-8555-555555555555', thread_id: 't-1', sender_user_id: THEM, recipient_user_id: ME, body: WORDS, created_at: at, read_at: null }]);
  mockWire.listDmThreads.mockResolvedValue([]);
  mockWire.getToday.mockResolvedValue({ feature_flag_state: 'enabled', cohort: null, event: null, pinned_post: null, challenge: null, empty_reason: null });
  mockWire.getCohorts.mockResolvedValue({ cohorts: [] });
  mockChallenges.getChallenge.mockResolvedValue({
    challenge: { id: 'ch-1', workspace_id: WS, cohort_id: null, created_by_user_id: THEM, title: 'March steps', description: 'Walk', status: 'active', starts_at: null, ends_at: null, metric_key: 'steps', target_value: 100000, unit: 'steps', leaderboard_enabled: false, created_at: at, updated_at: at, archived: false },
    participation: { challenge_id: 'ch-1', user_id: ME, progress_value: 1, target_value: 100000, progress_fraction: 0, completed: false, completed_at: null, last_logged_at: at, leaderboard_opted_in: false },
  });
  mockChallenges.listComments.mockResolvedValue({ comments: [{ id: 'cm-1', challenge_id: 'ch-1', author_user_id: THEM, body: WORDS, created_at: at }], next_cursor: null });
  mockChallenges.getLeaderboard.mockResolvedValue({ available: true, opted_in: false, rows: [], next_cursor: null });
}

/** Every way a send could start from these screens. */
const SENDS = [mockWire.sendDm, mockWire.createPost, mockWire.addComment, mockWire.reactToPost, mockChallenges.addComment, mockChallenges.join, mockChallenges.updateProgress];

type Host = {
  /** the REGISTRY file */
  file: string;
  label: string;
  draw: () => React.ReactElement;
  /** testIDs of everything that types or sends */
  controls: string[];
  /** what a settled closed screen draws instead (the closed line, or "no space" for a member with none) */
  closedMarks: string[];
  /** which closed states apply, and how each is produced on the wire */
  states: Partial<Record<Exclude<State, 'open'>, () => void>>;
  /** why a state does not apply */
  notApplicable?: Partial<Record<Exclude<State, 'open'>, string>>;
};

const block = () => useBlockedUsersStore.setState({ blocked: [{ id: THEM, displayName: 'Jordan', blockedAt: at }] });
/** A coach's removal and my own departure read the same on the phone: no space on /me, and the space reads answer
 * community.workspace.no_access ("banned, or no longer a member", closedRefusal.ts). */
const leave = () => {
  mockWire.getMe.mockResolvedValue({ workspace_id: null, unread: { cohort_messages: 0, dm_messages: 0, mentions: 0 } });
};
const ONE_TO_ONE_NA = 'a block is one to one: it closes a DM, not a space (a blocked author\'s rows are a list rule)';

const HOSTS: Host[] = [
  {
    file: 'screens/community/CommunityDmThreadScreen.tsx', label: 'community DM',
    draw: () => { mockParams.current = { recipientId: THEM, participantLabel: 'Jordan Lee' }; return <CommunityDmThreadScreen />; },
    controls: ['community-dmthread-composer-field', 'community-dmthread-composer-send'],
    closedMarks: ['community-dmthread-closed'],
    states: {
      'I blocked them': block,
      'they blocked me': () => mockWire.listDmMessages.mockRejectedValue(refused(403, 'community.dm.blocked_by_them')),
      banned: () => mockWire.listDmMessages.mockRejectedValue(refused(403, 'community.workspace.no_access')),
      'removed or left the space': leave,
    },
  },
  {
    file: 'screens/community/CommunityComposerScreen.tsx', label: 'New message',
    draw: () => { mockParams.current = { mode: 'dm', recipientId: THEM }; return <CommunityComposerScreen />; },
    controls: ['community-composer-body', 'community-composer-title', 'community-composer-submit'],
    closedMarks: ['community-composer-closed', 'community-composer-no-workspace'],
    states: {
      'I blocked them': block,
      'they blocked me': () => mockWire.listDmMessages.mockRejectedValue(refused(403, 'community.dm.blocked_by_them')),
      banned: () => mockWire.listDmMessages.mockRejectedValue(refused(403, 'community.workspace.no_access')),
      'removed or left the space': leave,
    },
  },
  {
    file: 'screens/community/CommunityComposerScreen.tsx', label: 'New post',
    draw: () => { mockParams.current = { mode: 'post' }; return <CommunityComposerScreen />; },
    controls: ['community-composer-body', 'community-composer-title', 'community-composer-submit'],
    closedMarks: ['community-composer-closed', 'community-composer-no-workspace'],
    states: {
      banned: () => mockWire.listPosts.mockRejectedValue(refused(403, 'community.workspace.no_access')),
      'removed or left the space': leave,
    },
    notApplicable: { 'I blocked them': ONE_TO_ONE_NA, 'they blocked me': ONE_TO_ONE_NA },
  },
  {
    file: 'screens/community/CommunityThreadScreen.tsx', label: 'post replies and reactions',
    draw: () => { mockParams.current = { postId: POST }; return <CommunityThreadScreen />; },
    controls: ['community-thread-composer-field', 'community-thread-composer-send', 'community-thread-reactions'],
    closedMarks: ['community-thread-closed'],
    states: {
      'I blocked them': block,
      'they blocked me': () => mockWire.getPost.mockRejectedValue(refused(404, 'community.post.not_found')),
      banned: () => {
        mockWire.getPost.mockRejectedValue(refused(403, 'community.workspace.no_access'));
        mockWire.listComments.mockRejectedValue(refused(403, 'community.workspace.no_access'));
      },
      'removed or left the space': () => {
        leave();
        mockWire.getPost.mockRejectedValue(refused(403, 'community.workspace.no_access'));
      },
    },
  },
  {
    file: 'screens/community/CommunitySpaceScreen.tsx', label: 'space: New post and voice entry',
    draw: () => { mockParams.current = {}; return <CommunitySpaceScreen space="hall" />; },
    controls: ['community-space-new-post', 'community-space-voice'],
    closedMarks: ['community-space-closed-line', 'community-space-no-workspace'],
    states: {
      banned: () => mockWire.listPosts.mockRejectedValue(refused(403, 'community.workspace.no_access')),
      'removed or left the space': leave,
    },
    notApplicable: { 'I blocked them': ONE_TO_ONE_NA, 'they blocked me': ONE_TO_ONE_NA },
  },
  {
    file: 'screens/community/CommunityChallengeDetailScreen.tsx', label: 'challenge notes and progress',
    draw: () => { mockParams.current = { challengeId: 'ch-1' }; return <CommunityChallengeDetailScreen />; },
    controls: ['community-challenge-composer-field', 'community-challenge-composer-send', 'community-challenge-primary-action'],
    closedMarks: ['community-challenge-closed'],
    states: {
      banned: () => mockChallenges.listComments.mockRejectedValue(challengeRefused(403, 'community.workspace.no_access')),
      'removed or left the space': () => {
        leave();
        mockChallenges.listComments.mockRejectedValue(challengeRefused(404, 'community.challenge.not_found'));
      },
    },
    notApplicable: { 'I blocked them': ONE_TO_ONE_NA, 'they blocked me': ONE_TO_ONE_NA },
  },
];

/**
 * KNOWN GAPS (operator-approved rows only). `${file} ${label} / ${state}` -> why. Each runs as it.failing: when it
 * starts to pass, the gap is fixed and the row must go.
 */
const GAPS: Record<string, string> = {
  'screens/community/CommunityThreadScreen.tsx post replies and reactions / I blocked them':
    'CommunityThreadScreen asks useConversationClosed(null, ...): my block of the post\'s author (made here or on another screen) leaves the reply box and reactions open on the cached post until the server answers post.not_found on the next read',
  'screens/community/CommunityChallengeDetailScreen.tsx challenge notes and progress / banned':
    'CommunityChallengeDetailScreen closes only the notes box: the primary action (Join / Log progress, ChallengeProgressSheet) stays for a banned member (growth-project-mobile#872 AUDIT, Opus C4/C9)',
  'screens/community/CommunityChallengeDetailScreen.tsx challenge notes and progress / removed or left the space':
    'CommunityChallengeDetailScreen closes only the notes box: the primary action (Join / Log progress) stays for a member who left (the departure case of the growth-project-mobile#872 AUDIT Opus C4/C9 gap)',
};

async function settle() {
  for (let i = 0; i < 6; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
}

async function draw(host: Host) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } });
  const view = await render(<QueryClientProvider client={qc}>{host.draw()}</QueryClientProvider>);
  await settle();
  return view;
}

type Node = { type: string; props: Record<string, unknown>; children: (Node | string)[] | null };
/** Every text box drawn that takes typing (the host tree, so no box can hide inside a component). */
function typeable(view: Awaited<ReturnType<typeof render>>): Node[] {
  const out: Node[] = [];
  const walk = (n: Node | Node[] | string | null) => {
    if (!n || typeof n === 'string') return;
    if (Array.isArray(n)) return n.forEach(walk);
    if (n.type === 'TextInput' && n.props.editable !== false) out.push(n);
    (n.children ?? []).forEach(walk);
  };
  walk(view.toJSON() as unknown as Node | Node[] | null);
  return out;
}

beforeEach(async () => {
  wireOpen();
  useBlockedUsersStore.setState({ blocked: [] });
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  authEvents.emit('logout'); // clears remembered refusals and drafts between cases
  await settle();
});
afterEach(() => jest.restoreAllMocks());

describe.each(HOSTS.map((h) => [`${h.file} (${h.label})`, h] as const))('KT-2 composer %s', (_name, host) => {
  it('open: the harness sees its box and its send (so the closed cases below are not empty)', async () => {
    const view = await draw(host);
    const seen = host.controls.filter((id) => view.queryByTestId(id));
    expect(seen.length).toBeGreaterThan(0);
    if (host.controls.some((id) => /-(field|body)$/.test(id))) expect(typeable(view).length).toBeGreaterThan(0);
  });

  for (const state of CLOSED) {
    const make = host.states[state];
    if (!make) {
      it(`${state}: does not apply (${host.notApplicable?.[state] ?? 'no reason given'})`, () => {
        expect(host.notApplicable?.[state]).toBeTruthy();
      });
      continue;
    }
    const gap = GAPS[`${host.file} ${host.label} / ${state}`];
    const title = gap
      ? `KNOWN GAP ${state}: ${gap} (when this fails, the gap is fixed: delete its GAPS row)`
      : `${state}: nothing typeable, no way to send, none of their words`;
    (gap ? it.failing : it)(title, async () => {
      make();
      const view = await draw(host);
      expect(host.closedMarks.filter((id) => view.queryByTestId(id)).length).toBeGreaterThan(0); // settled, not still loading
      expect(typeable(view)).toHaveLength(0);
      expect(host.controls.filter((id) => view.queryByTestId(id))).toEqual([]);
      expect(view.queryByText(WORDS, { exact: false })).toBeNull();
      SENDS.forEach((send) => expect(send).not.toHaveBeenCalled());
    });
  }
});

it('every GAPS row names a host state that exists', () => {
  const keys = HOSTS.flatMap((h) => Object.keys(h.states).map((s) => `${h.file} ${h.label} / ${s}`));
  expect(Object.keys(GAPS).filter((k) => !keys.includes(k))).toEqual([]);
});
