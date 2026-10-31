/**
 * KT-2, the phone half: the composers of src/__tests__/memberContentAccess.test.tsx's REGISTRY, drawn. Read that file's
 * header first (planning/KNOWN_TRAPS.md KT-2: what a builder does when this goes red).
 *
 * Every registered composer host (HOSTS below, keyed by the REGISTRY file) is drawn with real React Query and the real
 * community hooks; only the wire (communityApi, removedRowsApi, communityChallengesApi, services/api), navigation, theme
 * and the signed-in user are stubbed, as the screens' own tests do. For each closed state that applies to it (I blocked
 * them, they blocked me, banned, removed or left the space, and for a post thread a post a coach removed) it must draw
 * nothing typeable and no way to send, and none of the other person's words; the open case proves the harness sees the
 * box at all. While the access read is still out it must draw nothing typeable and no way to send either (closed until
 * open), then open or close when the read answers.
 *
 * The wire is strict: a read or send the harness was not told about fails the case and names itself (unstubbed GET
 * <url>, unstubbed <api>.<method>), so a host that moves its reads to a new module goes red here instead of drawing an
 * empty screen that passes the closed cases.
 *
 * When a case goes red: the host stopped closing for that state. Make it close again (useConversationClosed and
 * ConversationClosedLine); never loosen the case. A KNOWN GAP case asserts the gap's own symptom (the box still drawn,
 * the words still there): when it goes red, either the gap is fixed (delete its GAPS row; the plain case takes over) or
 * the harness stopped reaching the screen (fix the harness). A new composer joins REGISTRY and HOSTS. Never add a GAPS
 * row yourself: ask the operator.
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
/** Wire calls the harness was not told about: each fails its case in afterEach, by name. */
const mockUnstubbed: string[] = [];
/** The only direct GETs these hosts make (my coach's name for the closed line). Anything else throws and is named. */
const mockGets: [RegExp, unknown][] = [[/^\/v1\/clients\/me\/coach$/, { name: 'Sam Rivera' }]];
jest.mock('../services/api', () => {
  const told = (verb: string) => async (url: string) => {
    mockUnstubbed.push(`unstubbed ${verb} ${url}`);
    throw new Error(`unstubbed ${verb} ${url}`);
  };
  return {
    __esModule: true,
    default: {
      get: async (url: string) => {
        const hit = mockGets.find(([re]) => re.test(url));
        if (!hit) {
          mockUnstubbed.push(`unstubbed GET ${url}`);
          throw new Error('unstubbed GET ' + url);
        }
        return { data: hit[1] };
      },
      post: told('POST'), put: told('PUT'), patch: told('PATCH'), delete: told('DELETE'),
    },
  };
});
/** A proxy over a wire object: a told method answers from `wire`; any other one fails the case and names itself. */
function mockStrict(name: string, wire: Record<string, jest.Mock>) {
  return new Proxy({}, {
    get: (_t, k) => (typeof k !== 'string' ? undefined : (...a: unknown[]) => {
      if (!(k in wire)) {
        mockUnstubbed.push(`unstubbed ${name}.${k}`);
        return Promise.reject(new Error(`unstubbed ${name}.${k}`));
      }
      return wire[k](...a);
    }),
  });
}
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
  getMe: jest.fn(), listDmMessages: jest.fn(),
  listDmThreads: jest.fn(), sendDm: jest.fn(), createPost: jest.fn(), addComment: jest.fn(), reactToPost: jest.fn(),
  unreactToPost: jest.fn(), deletePost: jest.fn(), getToday: jest.fn(), getCohorts: jest.fn(), getWorkspace: jest.fn(),
};
jest.mock('../api/communityApi', () => ({
  ...jest.requireActual('../api/communityApi'),
  communityApi: mockStrict('communityApi', mockWire),
}));
/** m#895: the Hall and space list, a post's page and its replies are read through removedRowsApi (opt-in header). */
const mockRemoved = { listPosts: jest.fn(), getPost: jest.fn(), listComments: jest.fn() };
jest.mock('../api/communityRemovedRows', () => ({
  ...jest.requireActual('../api/communityRemovedRows'),
  removedRowsApi: mockStrict('removedRowsApi', mockRemoved),
}));
const mockChallenges = {
  getChallenge: jest.fn(), listComments: jest.fn(), getLeaderboard: jest.fn(), join: jest.fn(), updateProgress: jest.fn(),
  setLeaderboardOptIn: jest.fn(), addComment: jest.fn(), reportComment: jest.fn(),
};
jest.mock('../api/communityChallengesApi', () => ({
  communityChallengesApi: mockStrict('communityChallengesApi', mockChallenges),
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

type State = 'open' | 'I blocked them' | 'they blocked me' | 'banned' | 'removed or left the space' | 'a coach removed the post';
const CLOSED: Exclude<State, 'open'>[] = ['I blocked them', 'they blocked me', 'banned', 'removed or left the space', 'a coach removed the post'];

const livePost = { id: POST, workspace_id: WS, cohort_id: null, author_user_id: THEM, title: 'Week 3', body: WORDS, scope: 'hall', type: 'text', pinned: false, created_at: at, updated_at: at, deleted: false };
function wireOpen() {
  Object.values(mockWire).forEach((m) => m.mockReset());
  Object.values(mockRemoved).forEach((m) => m.mockReset());
  Object.values(mockChallenges).forEach((m) => m.mockReset());
  mockWire.getMe.mockResolvedValue({ workspace_id: WS, unread: { cohort_messages: 0, dm_messages: 0, mentions: 0 } });
  mockRemoved.listPosts.mockResolvedValue({ posts: [livePost], next_before: null });
  mockRemoved.getPost.mockResolvedValue(livePost);
  mockRemoved.listComments.mockResolvedValue([]);
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
  /** the reads that decide whether it may open (held back in the pending cases) */
  access: () => jest.Mock[];
  /** the closed state the pending case resolves into (made by the access read's answer) */
  pendingCloses?: Exclude<State, 'open'>;
  /** why a pending case does not apply (a known gap row covers it) */
  pendingNotApplicable?: string;
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
const NOT_A_POST_NA = 'only a post\'s own page shows a post a coach removed; this host has no single post (the list rows are KT-2 list rules)';
/** A coach removed the post (backend #1176 placeholder): title and body null, removed_by the coach; its replies, even
 * ones the server still sent, must not draw, and neither may the reply box or reactions. */
const coachRemovedPost = () => {
  mockRemoved.getPost.mockResolvedValue({ ...livePost, title: null, body: null, removed_at: at, removed_by: { role: 'coach', user_id: '99999999-9999-4999-8999-999999999999', name: 'Sam Rivera' } });
  mockRemoved.listComments.mockResolvedValue([{ id: '66666666-6666-4666-8666-666666666666', post_id: POST, author_user_id: THEM, body: WORDS, created_at: at }]);
};

/** A DM (thread or first message): my block from the block store; theirs, a ban or a departure from the thread read. */
const DM_STATES: Host['states'] = {
  'I blocked them': block,
  'they blocked me': () => mockWire.listDmMessages.mockRejectedValue(refused(403, 'community.dm.blocked_by_them')),
  banned: () => mockWire.listDmMessages.mockRejectedValue(refused(403, 'community.workspace.no_access')),
  'removed or left the space': leave,
};

const HOSTS: Host[] = [
  {
    file: 'screens/community/CommunityDmThreadScreen.tsx', label: 'community DM',
    draw: () => { mockParams.current = { recipientId: THEM, participantLabel: 'Jordan Lee' }; return <CommunityDmThreadScreen />; },
    controls: ['community-dmthread-composer-field', 'community-dmthread-composer-send'], closedMarks: ['community-dmthread-closed'],
    access: () => [mockWire.listDmMessages], pendingCloses: 'they blocked me',
    states: DM_STATES,
    notApplicable: { 'a coach removed the post': NOT_A_POST_NA },
  },
  {
    file: 'screens/community/CommunityComposerScreen.tsx', label: 'New message',
    draw: () => { mockParams.current = { mode: 'dm', recipientId: THEM }; return <CommunityComposerScreen />; },
    controls: ['community-composer-body', 'community-composer-title', 'community-composer-submit'], closedMarks: ['community-composer-closed', 'community-composer-no-workspace'],
    access: () => [mockWire.listDmMessages], pendingCloses: 'they blocked me',
    states: DM_STATES,
    notApplicable: { 'a coach removed the post': NOT_A_POST_NA },
  },
  {
    file: 'screens/community/CommunityComposerScreen.tsx', label: 'New post',
    draw: () => { mockParams.current = { mode: 'post' }; return <CommunityComposerScreen />; },
    controls: ['community-composer-body', 'community-composer-title', 'community-composer-submit'], closedMarks: ['community-composer-closed', 'community-composer-no-workspace'],
    access: () => [mockRemoved.listPosts], pendingCloses: 'banned',
    states: {
      banned: () => mockRemoved.listPosts.mockRejectedValue(refused(403, 'community.workspace.no_access')),
      'removed or left the space': leave,
    },
    notApplicable: { 'I blocked them': ONE_TO_ONE_NA, 'they blocked me': ONE_TO_ONE_NA, 'a coach removed the post': NOT_A_POST_NA },
  },
  {
    file: 'screens/community/CommunityThreadScreen.tsx', label: 'post replies and reactions',
    draw: () => { mockParams.current = { postId: POST }; return <CommunityThreadScreen />; },
    controls: ['community-thread-composer-field', 'community-thread-composer-send', 'community-thread-reactions'], closedMarks: ['community-thread-closed', 'community-thread-post-removed'],
    access: () => [mockRemoved.getPost, mockRemoved.listComments], pendingCloses: 'banned',
    states: {
      'I blocked them': block,
      'they blocked me': () => mockRemoved.getPost.mockRejectedValue(refused(404, 'community.post.not_found')),
      banned: () => [mockRemoved.getPost, mockRemoved.listComments].forEach((m) => m.mockRejectedValue(refused(403, 'community.workspace.no_access'))),
      'removed or left the space': () => { leave(); mockRemoved.getPost.mockRejectedValue(refused(403, 'community.workspace.no_access')); },
      'a coach removed the post': coachRemovedPost,
    },
  },
  {
    file: 'screens/community/CommunitySpaceScreen.tsx', label: 'space: New post and voice entry',
    draw: () => { mockParams.current = {}; return <CommunitySpaceScreen space="hall" />; },
    controls: ['community-space-new-post', 'community-space-voice'], closedMarks: ['community-space-closed-line', 'community-space-no-workspace'],
    access: () => [mockRemoved.listPosts], pendingCloses: 'banned',
    states: {
      banned: () => mockRemoved.listPosts.mockRejectedValue(refused(403, 'community.workspace.no_access')),
      'removed or left the space': leave,
    },
    notApplicable: { 'I blocked them': ONE_TO_ONE_NA, 'they blocked me': ONE_TO_ONE_NA, 'a coach removed the post': NOT_A_POST_NA },
  },
  {
    file: 'screens/community/CommunityChallengeDetailScreen.tsx', label: 'challenge notes and progress',
    draw: () => { mockParams.current = { challengeId: 'ch-1' }; return <CommunityChallengeDetailScreen />; },
    controls: ['community-challenge-composer-field', 'community-challenge-composer-send', 'community-challenge-primary-action'], closedMarks: ['community-challenge-closed'],
    access: () => [mockChallenges.listComments],
    pendingNotApplicable: 'the primary action (Join / Log progress) is outside the notes gate, the same gap as the banned and departure GAPS rows (growth-project-mobile#872 AUDIT, Opus C4/C9)',
    states: {
      banned: () => mockChallenges.listComments.mockRejectedValue(challengeRefused(403, 'community.workspace.no_access')),
      'removed or left the space': () => { leave(); mockChallenges.listComments.mockRejectedValue(challengeRefused(404, 'community.challenge.not_found')); },
    },
    notApplicable: { 'I blocked them': ONE_TO_ONE_NA, 'they blocked me': ONE_TO_ONE_NA, 'a coach removed the post': NOT_A_POST_NA },
  },
];

type View = Awaited<ReturnType<typeof render>>;
/** The challenge gap's own symptom: the notes box closed, the primary action still drawn. */
const primaryActionStays = (view: View) => {
  expect(view.queryByTestId('community-challenge-closed')).not.toBeNull();
  expect(view.queryByTestId('community-challenge-composer-field')).toBeNull();
  expect(view.queryByTestId('community-challenge-primary-action')).not.toBeNull();
};
/**
 * KNOWN GAPS (operator-approved rows only). `${file} ${label} / ${state}` -> why, and the gap's own symptom. Each runs
 * as a plain case asserting that symptom (not it.failing, which also passes when the harness breaks): when it goes red
 * the gap is fixed (delete the row, the plain closed case takes over) or the harness stopped reaching the screen.
 */
const GAPS: Record<string, { why: string; symptom: (view: View) => void }> = {
  'screens/community/CommunityThreadScreen.tsx post replies and reactions / I blocked them': {
    why: 'CommunityThreadScreen asks useConversationClosed(null, ...): my block of the post\'s author (made here or on another screen) leaves the reply box and reactions open on the cached post until the server answers post.not_found on the next read',
    symptom: (view) => {
      expect(view.queryByTestId('community-thread-composer-field')).not.toBeNull();
      expect(view.queryByTestId('community-thread-reactions')).not.toBeNull();
      expect(view.queryByText(WORDS, { exact: false })).not.toBeNull();
    },
  },
  'screens/community/CommunityChallengeDetailScreen.tsx challenge notes and progress / banned': {
    why: 'CommunityChallengeDetailScreen closes only the notes box: the primary action (Join / Log progress, ChallengeProgressSheet) stays for a banned member (growth-project-mobile#872 AUDIT, Opus C4/C9)',
    symptom: primaryActionStays,
  },
  'screens/community/CommunityChallengeDetailScreen.tsx challenge notes and progress / removed or left the space': {
    why: 'CommunityChallengeDetailScreen closes only the notes box: the primary action (Join / Log progress) stays for a member who left (the departure case of the growth-project-mobile#872 AUDIT Opus C4/C9 gap)',
    symptom: primaryActionStays,
  },
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

/** Hold the access reads back until `release`; they then answer as the case set them up (open or refused). */
function holdAccess(host: Host) {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  host.access().forEach((m) => {
    const answer = m.getMockImplementation();
    m.mockImplementation((...a: unknown[]) => gate.then(() => answer?.(...a)));
  });
  return async () => {
    await act(async () => { release(); });
    await settle();
  };
}

/** Nothing typeable, no control drawn, no send started, none of their words. */
function nothingOpen(host: Host, view: View) {
  expect(typeable(view)).toHaveLength(0);
  expect(host.controls.filter((id) => view.queryByTestId(id))).toEqual([]);
  expect(view.queryByText(WORDS, { exact: false })).toBeNull();
  SENDS.forEach((send) => expect(send).not.toHaveBeenCalled());
}

type Node = { type: string; props: Record<string, unknown>; children: (Node | string)[] | null };
/** Every text box drawn that takes typing (the host tree, so no box can hide inside a component). */
function typeable(view: View): Node[] {
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
  mockUnstubbed.length = 0;
  wireOpen();
  useBlockedUsersStore.setState({ blocked: [] });
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  authEvents.emit('logout'); // clears remembered refusals and drafts between cases
  await settle();
});
afterEach(() => {
  jest.restoreAllMocks();
  // A read or send the harness was not told about (a host moved to a new module): named here, never an empty pass.
  expect(mockUnstubbed).toEqual([]);
});

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
    if (gap) {
      it(`KNOWN GAP ${state}: ${gap.why} (asserts the gap's symptom; red = gap fixed, delete its GAPS row, or harness broken)`, async () => {
        make();
        gap.symptom(await draw(host));
      });
      continue;
    }
    it(`${state}: nothing typeable, no way to send, none of their words`, async () => {
      make();
      const view = await draw(host);
      expect(host.closedMarks.filter((id) => view.queryByTestId(id)).length).toBeGreaterThan(0); // settled, not still loading
      nothingOpen(host, view);
    });
  }

  if (host.pendingNotApplicable) {
    it(`access read pending: does not apply (${host.pendingNotApplicable})`, () => {
      expect(Object.keys(GAPS).some((k) => k.startsWith(`${host.file} ${host.label} / `))).toBe(true);
    });
  } else {
    it('access read pending: nothing editable, no send, no reaction; then it opens when the read answers', async () => {
      const release = holdAccess(host);
      const view = await draw(host);
      nothingOpen(host, view);
      await release();
      expect(host.controls.filter((id) => view.queryByTestId(id)).length).toBeGreaterThan(0);
    });
    it(`access read pending: nothing editable, no send, no reaction; then it closes when the read answers ${host.pendingCloses}`, async () => {
      host.states[host.pendingCloses as Exclude<State, 'open'>]!();
      const release = holdAccess(host);
      const view = await draw(host);
      nothingOpen(host, view);
      await release();
      expect(host.closedMarks.filter((id) => view.queryByTestId(id)).length).toBeGreaterThan(0);
      nothingOpen(host, view);
    });
  }
});

it('every GAPS row names a host state that exists', () => {
  const keys = HOSTS.flatMap((h) => Object.keys(h.states).map((s) => `${h.file} ${h.label} / ${s}`));
  expect(Object.keys(GAPS).filter((k) => !keys.includes(k))).toEqual([]);
});
