/**
 * ROUND-989 (owner #203-E74 "another round towards the goal"; #203-E13 "roman drafts list - approved as displayed"):
 * Roman's drafts list draws the B-list frame's head (ctx#503 planning/MOCKUP3/CHECKIN-DRAFT/png/B-list-390-100.png and
 * B-list-390-130.png): a deep head with rounded bottom corners, a light Back, Roman's mark, "Roman" (CD-68), "Your drafts,
 * ready when you are." (CD-69), the small queue line "1 draft to review" (CD-72) from the one count, and the white
 * check-in card. Round 1's rulings stand: one drafts list, no chip; the Chat and Drafts tabs (CD-70, CD-71) are not drawn.
 * The real PendingAiDraftsScreen with checkInDraftM.list.test.tsx's mocks (services/api and the drafts queue at its edge).
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000000' }), semanticColors: jest.requireActual('../../../theme/tokens').lightTokens, colorScheme: 'light' }),
}));
// Every icon draws a host element named Icon with its props (name, size, color), as coachDmStudio962.test.tsx reads them.
jest.mock('@expo/vector-icons', () => {
  const R = jest.requireActual('react');
  const Icon = (p: Record<string, unknown>) => R.createElement('Icon', p);
  return new Proxy({}, { get: (_t, k) => (k === '__esModule' ? true : Icon) });
});
const mockUser: { id: string; role: string } = { id: 'coach-1', role: 'coach' };
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
const mockRoster = { clients: [{ id: 'client-1', firstName: 'Jordan', lastName: 'Reyes', email: 'j@example.test', status: 'active' }] as unknown[] };
jest.mock('../../../store/coachStore', () => {
  const state = { get clients() { return mockRoster.clients; }, filterStatus: 'active', loadError: null, loadClients: async () => undefined };
  const useCoachStore = (sel?: (s: typeof state) => unknown) => (sel ? sel(state) : state);
  useCoachStore.getState = () => state;
  return { useCoachStore };
});
const mockPatch = jest.fn();
const mockPost = jest.fn();
const mockCheckIns = jest.fn();
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { patch: (...a: unknown[]) => mockPatch(...a), post: (...a: unknown[]) => mockPost(...a), get: jest.fn() },
  coachApi: {
    getUnreadCounts: async () => ({ data: { total: 0, by_client: {} } }),
    getClientCheckIns: (...a: unknown[]) => mockCheckIns(...a),
  },
}));
jest.mock('../../../services/realtime', () => ({ subscribeToMessages: () => () => undefined }));
jest.mock('../../../hooks/useClientUnreadCount', () => ({ useClientUnreadCount: () => 0 }));
jest.mock('../home-v11/blockList', () => ({
  ...jest.requireActual('../home-v11/blockList'),
  useCoachBlockList: () => ({ known: true, blockedIds: [] }),
}));
jest.mock('../../../hooks/useFeatureFlags', () => ({ useFeatureFlags: () => ({ flags: { messaging_core_v2: true } }) }));
jest.mock('../../../ui/layout/Screen', () => ({
  ...jest.requireActual('../../../ui/layout/Screen'),
  useScreenInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));
const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockNav = { canGoBack: true };
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate, canGoBack: () => mockNav.canGoBack, goBack: mockGoBack }),
  useIsFocused: () => true,
  useFocusEffect: (cb: () => void | (() => void)) => jest.requireActual('react').useEffect(() => cb(), [cb]),
}));
const mockListPending = jest.fn();
jest.mock('../../../api/coachAiExecutionApi', () => {
  const actual = jest.requireActual('../../../api/coachAiExecutionApi');
  return { ...actual, coachAiExecutionApi: { ...actual.coachAiExecutionApi, listPending: () => mockListPending() } };
});
const mockPath = jest.fn();
jest.mock('../../../api/copilotApi', () => {
  const actual = jest.requireActual('../../../api/copilotApi');
  return { ...actual, copilotApi: { ...actual.copilotApi, pathChangeDrafts: () => mockPath() } };
});
jest.mock('../../../api/programsApi', () => ({ programsApi: { assignableClients: async () => [] } }));

import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import PendingAiDraftsScreen from '../PendingAiDraftsScreen';
import { StatusBarBand, STATUS_BAR_BONE } from '../../../components/StatusBarBand';
import { romanDraftsCount } from '../romanDraftsCount';
import { coachInboxB, forestPop, radius, spacing, typography } from '../../../theme/tokens';
import { featureFlags } from '../../../config/featureFlags';
import { useBlockedUsersStore } from '../../../store/blockedUsersStore';
import { useClosedClientsStore } from '../../../store/closedClientsStore';

const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const TODAY = localDay();
const REPLY = 'Hi Jordan, thanks for checking in. What helped you make that space this week?';
const bound = (id: string, client: string, ref: string) => ({
  id, capability: 'draft.coach_message', status: 'pending', subject_user_id: client, tenant_coach_id: 'coach-1', created_at: '2026-11-13T10:00:00.000Z',
  payload: { clientId: client, body: REPLY },
  provenance: [{ source: 'check_in', ref, count: 1, hash: 'h1', origin: 'local', date: TODAY }],
});
const stream2 = (id: string, client: string, capability = 'draft.assign_workout') => ({
  id, capability, status: 'pending', subject_user_id: client, tenant_coach_id: 'coach-1', created_at: '2026-11-13T09:00:00.000Z',
  payload: capability === 'draft.send_notification' ? { body: 'Keep the calves loose tonight.' } : { workoutPlanId: 'w', scheduledFor: '2026-11-20T09:00:00.000Z' },
});
const PLAN = [
  { id: 'p1', clientId: 'client-1', reason: 'Two short nights in a row.', sentAt: '2026-11-12T10:00:00.000Z',
    change: { kind: 'move_session', assignment_id: 'a1', workout: 'Upper body', from_at: '2026-11-13T10:00:00.000Z', to_at: '2026-11-14T10:00:00.000Z' } },
  { id: 'p2', clientId: 'client-2', reason: 'Training load went up this week.', sentAt: '2026-11-12T11:00:00.000Z',
    change: { kind: 'set_calorie_target', target_id: 't1', from_kcal: 2100, to_kcal: 2250 } },
];
const never = () => new Promise<never>(() => undefined);
const flat = (el: { props: { style?: unknown } }) => (StyleSheet.flatten(el.props.style as never) ?? {}) as Record<string, unknown>;
type Tree = { type?: unknown; props?: Record<string, unknown>; children?: unknown[] } | null;
/** The icon drawn with `name` inside a rendered element (the mock above draws a host element named Icon). */
function iconIn(scope: unknown, name: string): Tree {
  const node = scope as Tree;
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'Icon' && node.props?.name === name) return node;
  for (const child of node.children ?? []) { const hit = iconIn(child, name); if (hit) return hit; }
  return null;
}
/** Every host element in the tree whose props match. */
function allWith(scope: unknown, hit: (p: Record<string, unknown>) => boolean, out: Tree[] = []): Tree[] {
  const node = scope as Tree;
  if (!node || typeof node !== 'object') return out;
  if (node.props && typeof node.type === 'string' && hit(node.props)) out.push(node);
  for (const child of node.children ?? []) allWith(child, hit, out);
  return out;
}

let qc: QueryClient;
const draw = async () => render(<QueryClientProvider client={qc}><PendingAiDraftsScreen /></QueryClientProvider>);

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  jest.replaceProperty(featureFlags, 'clientPathCopilot', false);
  useBlockedUsersStore.setState({ userId: 'coach-1', hydrated: true, blocked: [] });
  useClosedClientsStore.setState({ bySource: {} });
  mockUser.role = 'coach';
  mockNav.canGoBack = true;
  mockListPending.mockReset();
  mockPath.mockReset().mockResolvedValue([]);
  mockPatch.mockReset().mockResolvedValue({ data: { id: 'd-7', status: 'approved' } });
  mockPost.mockReset();
  mockCheckIns.mockReset().mockResolvedValue({ data: [{ id: 'ci-7', user_id: 'client-1', date: `${TODAY}T00:00:00.000Z`, notes: 'Busy week, sessions done.', mood: 4, energy: 3, sleep_hours: 7 }] });
  mockNavigate.mockReset();
  mockGoBack.mockReset();
});
afterEach(() => {
  qc.clear();
  jest.restoreAllMocks();
  useBlockedUsersStore.setState({ userId: null, hydrated: false, blocked: [] });
});

describe('ROUND-989: the B-list frame head on Roman\'s drafts list (B-list-390-100.png)', () => {
  it('(a) the head is the deep forestPop.deep (not coachInboxB.deep) with radius.sheet bottom corners', async () => {
    mockListPending.mockResolvedValue({ drafts: [bound('d-7', 'client-1', 'ci-7')] });
    const view = await draw();
    const head = flat(await view.findByTestId('pending-ai-drafts-head'));
    expect(head.backgroundColor).toBe(forestPop.deep);
    expect(head.backgroundColor).not.toBe(coachInboxB.deep);
    expect(head.borderBottomLeftRadius).toBe(radius.sheet);
    expect(head.borderBottomRightRadius).toBe(radius.sheet);
  });

  it('(a) the status band behind the clock is the head\'s deep while the list is focused, and bone again after it closes; restricted keeps bone', async () => {
    mockListPending.mockResolvedValue({ drafts: [bound('d-7', 'client-1', 'ci-7')] });
    // The app's own band (App.tsx mounts StatusBarBand over every screen) beside the list, with a phone's top inset.
    const app = (node: React.ReactNode) => (
      <SafeAreaInsetsContext.Provider value={{ top: 47, bottom: 34, left: 0, right: 0 }}>
        <QueryClientProvider client={qc}>{node}<StatusBarBand /></QueryClientProvider>
      </SafeAreaInsetsContext.Provider>
    );
    const band = (v: Awaited<ReturnType<typeof render>>) => flat(v.getByTestId('status-bar-band')).backgroundColor;
    const view = await render(app(<PendingAiDraftsScreen />));
    await view.findByTestId('pending-ai-drafts-head');
    expect(band(view)).toBe(forestPop.deep);
    await view.rerender(app(null));
    expect(band(view)).toBe(STATUS_BAR_BONE);
    await view.unmount();
    mockUser.role = 'client';
    const restricted = await render(app(<PendingAiDraftsScreen />));
    expect(restricted.getByTestId('pending-ai-drafts-screen-restricted')).toBeTruthy();
    expect(band(restricted)).toBe(STATUS_BAR_BONE);
  });

  it('(b) Back is light on the deep, a 44 pt target labelled Back that goes back, and absent when the stack cannot go back', async () => {
    mockListPending.mockResolvedValue({ drafts: [bound('d-7', 'client-1', 'ci-7')] });
    const view = await draw();
    const back = await view.findByTestId('pending-ai-drafts-back');
    expect(back.props.accessibilityRole).toBe('button');
    expect(back.props.accessibilityLabel).toBe('Back');
    const box = flat(back);
    expect(Math.max(Number(box.width ?? 0), Number(box.minWidth ?? 0))).toBeGreaterThanOrEqual(44);
    expect(Math.max(Number(box.height ?? 0), Number(box.minHeight ?? 0))).toBeGreaterThanOrEqual(44);
    expect(iconIn(back, 'chevron-back')?.props?.color).toBe(forestPop.onDeep);
    await fireEvent.press(back);
    expect(mockGoBack).toHaveBeenCalledTimes(1);
    await view.unmount();
    mockNav.canGoBack = false;
    const again = await draw();
    await again.findByText('Roman');
    expect(again.queryByTestId('pending-ai-drafts-back')).toBeNull();
    expect(again.queryByLabelText('Back')).toBeNull();
  });

  it('(c) Roman\'s mark sits in the head, hidden from spoken text and never a button', async () => {
    mockListPending.mockResolvedValue({ drafts: [bound('d-7', 'client-1', 'ci-7')] });
    const view = await draw();
    // Hidden from spoken text, so the queries must be told to look at hidden elements.
    const mark = await view.findByTestId('pending-ai-drafts-mark', { includeHiddenElements: true });
    expect(within(view.getByTestId('pending-ai-drafts-head')).getByTestId('pending-ai-drafts-mark', { includeHiddenElements: true })).toBeTruthy();
    expect(mark.props.accessibilityElementsHidden).toBe(true);
    expect(mark.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(mark.props.accessibilityRole).toBeUndefined();
    expect(mark.props.onPress).toBeUndefined();
    type Up = { parent: Up | null; props: Record<string, unknown> } | null;
    for (let up = (mark as unknown as Up)?.parent ?? null; up; up = up.parent) {
      if (up.props.testID === 'pending-ai-drafts-head') break;
      expect(up.props.onPress).toBeUndefined();
    }
  });

  it('(d) (e) the title is "Roman" with the header role (CD-68) and the line is "Your drafts, ready when you are." (CD-69)', async () => {
    mockListPending.mockResolvedValue({ drafts: [bound('d-7', 'client-1', 'ci-7')] });
    const view = await draw();
    const head = within(await view.findByTestId('pending-ai-drafts-head'));
    expect(head.getByText('Roman').props.accessibilityRole).toBe('header');
    expect(head.getByText('Your drafts, ready when you are.')).toBeTruthy();
  });

  it.each([
    ['1, a check-in draft alone (the frame\'s case)', [bound('d-7', 'client-1', 'ci-7')], [], '1 draft to review'],
    ['2, a check-in draft and a Stream 2 draft', [bound('d-7', 'client-1', 'ci-7'), stream2('w-1', 'client-2')], [], '2 drafts to review'],
    ['8, five Stream 2 drafts, a check-in draft and two plan changes', [
      bound('d-7', 'client-1', 'ci-7'), stream2('w-1', 'client-2'), stream2('w-2', 'client-2'), stream2('w-3', 'client-1'),
      stream2('n-1', 'client-2', 'draft.send_notification'), stream2('n-2', 'client-1', 'draft.send_notification')], PLAN, '8 drafts to review'],
  ])('(g) the queue line for %s is the one count\'s waiting', async (_name, rows, plan, words) => {
    jest.replaceProperty(featureFlags, 'clientPathCopilot', plan.length > 0);
    mockPath.mockResolvedValue(plan);
    mockListPending.mockResolvedValue({ drafts: rows });
    const view = await draw();
    const line = await view.findByText(words);
    expect(line.props.testID).toBe('pending-ai-drafts-queue');
    expect(Number(words.split(' ')[0])).toBe(romanDraftsCount(rows, 'ok', plan.length ? { n: plan.length, state: 'ok' } : null).waiting);
    // The frame's small muted type, on the page under the head (not inside it).
    expect(flat(line)).toMatchObject({ fontSize: typography.bodySmall.fontSize, color: coachInboxB.muted });
    expect(within(view.getByTestId('pending-ai-drafts-head')).queryByText(words)).toBeNull();
  });

  it('(g) no queue line at 0 or while the first read is loading', async () => {
    mockListPending.mockResolvedValue({ drafts: [] });
    const empty = await draw();
    expect(await empty.findByText('No pending drafts')).toBeTruthy();
    expect(empty.queryByTestId('pending-ai-drafts-queue')).toBeNull();
    expect(empty.queryByText(/to review/)).toBeNull();
    await empty.unmount();
    qc.clear();
    mockListPending.mockImplementation(never);
    const loading = await draw();
    expect(await loading.findByTestId('pending-ai-drafts-loading')).toBeTruthy();
    expect(loading.queryByTestId('pending-ai-drafts-queue')).toBeNull();
    expect(loading.getByText('Roman')).toBeTruthy();
  });

  it('(h) the kind tiles show with a Stream 2 kind and not with check-in drafts only', async () => {
    mockListPending.mockResolvedValue({ drafts: [bound('d-7', 'client-1', 'ci-7'), stream2('w-1', 'client-2')] });
    const mixed = await draw();
    expect(await mixed.findByTestId('pending-ai-drafts-kinds')).toBeTruthy();
    await mixed.unmount();
    qc.clear();
    mockListPending.mockResolvedValue({ drafts: [bound('d-7', 'client-1', 'ci-7'), bound('d-8', 'client-1', 'ci-8')] });
    const only = await draw();
    expect(await only.findByText('2 drafts to review')).toBeTruthy();
    expect(only.queryByTestId('pending-ai-drafts-kinds')).toBeNull();
  });

  it('(i) a Stream 2 card keeps ef35781d\'s look: cream ground, card radius, padding, margin and its buttons', async () => {
    mockListPending.mockResolvedValue({ drafts: [bound('d-7', 'client-1', 'ci-7'), stream2('w-1', 'client-2')] });
    const view = await draw();
    const card = await view.findByTestId('ai-draft-card-draft.assign_workout');
    expect(flat(card)).toEqual({ backgroundColor: coachInboxB.tile, borderRadius: radius.card, padding: spacing.md, marginBottom: 12 });
    expect(flat(view.getByTestId('ai-draft-approve-w-1'))).toMatchObject({ backgroundColor: coachInboxB.deep, minHeight: 44, borderRadius: radius.button });
    expect(flat(view.getByTestId('ai-draft-reject-w-1'))).toMatchObject({ backgroundColor: coachInboxB.chip, borderColor: coachInboxB.line, borderWidth: 1 });
    expect(flat(within(card).getByText('Workout suggestion'))).toMatchObject({ fontSize: 17, lineHeight: 22, color: coachInboxB.ink });
  });

  it('(j) the check-in card: Roman\'s words in the frame\'s small body type, clamped to 4 lines; Back to check-in a row below the button', async () => {
    mockListPending.mockResolvedValue({ drafts: [bound('d-7', 'client-1', 'ci-7')] });
    const view = await draw();
    const card = within(await view.findByTestId('checkin-draft-card-d-7'));
    const words = card.getByText(REPLY);
    expect(words.props.numberOfLines).toBe(4);
    expect(flat(words)).toMatchObject({ fontSize: typography.bodySmall.fontSize, lineHeight: typography.bodySmall.lineHeight });
    expect(flat(card.getByLabelText('Back to check-in'))).toMatchObject({ marginTop: spacing.lg, minHeight: 44 });
    expect(flat(card.getByLabelText('Review draft'))).toMatchObject({ minHeight: 48 });
  });

  it('the head, the queue line and the kind tiles ride the list\'s scroller (LS-952 B1, LO-952 B1)', async () => {
    mockListPending.mockResolvedValue({ drafts: [bound('d-7', 'client-1', 'ci-7'), stream2('w-1', 'client-2')] });
    const view = await draw();
    await view.findByText('2 drafts to review');
    const scroller = within(view.getByTestId('pending-ai-drafts-list'));
    expect(scroller.getByTestId('pending-ai-drafts-head')).toBeTruthy();
    expect(scroller.getByText('Roman')).toBeTruthy();
    expect(scroller.getByText('2 drafts to review')).toBeTruthy();
    expect(scroller.getByTestId('pending-ai-drafts-kinds')).toBeTruthy();
  });

  it('(n) empty, failed and restricted keep their words; empty and failed take the new head, restricted stays as it was', async () => {
    mockListPending.mockResolvedValue({ drafts: [] });
    const empty = await draw();
    expect(await empty.findByText('No pending drafts')).toBeTruthy();
    expect(empty.getByText('Ask the AI to draft something from a client\'s detail screen.')).toBeTruthy();
    expect(empty.getByText('Roman')).toBeTruthy();
    expect(empty.getByText('Your drafts, ready when you are.')).toBeTruthy();
    await empty.unmount();
    qc.clear();
    mockListPending.mockRejectedValue(Object.assign(new Error('Network Error'), { isAxiosError: true, code: 'ERR_NETWORK' }));
    const failed = await draw();
    // usePendingAiDrafts retries once (retry: 1, about a second) before it says the read failed.
    expect(await failed.findByTestId('pending-ai-drafts-error', {}, { timeout: 5000 })).toBeTruthy();
    expect(failed.getByText(/^Pending AI drafts could not load\./)).toBeTruthy();
    expect(failed.getByText('Roman')).toBeTruthy();
    await failed.unmount();
    qc.clear();
    const reads = mockListPending.mock.calls.length;
    mockUser.role = 'client';
    const restricted = await draw();
    expect(restricted.getByTestId('pending-ai-drafts-screen-restricted')).toBeTruthy();
    expect(restricted.getByText('Restricted')).toBeTruthy();
    expect(restricted.getByText('This view is only available to coach accounts.')).toBeTruthy();
    expect(restricted.queryByTestId('pending-ai-drafts-head')).toBeNull();
    expect(mockListPending.mock.calls.length).toBe(reads);
  });

  it('negatives: no old title, no old line, no "Roman has" on this screen, no Chat or Drafts label, nothing with the tab role', async () => {
    jest.replaceProperty(featureFlags, 'clientPathCopilot', true);
    mockPath.mockResolvedValue(PLAN);
    mockListPending.mockResolvedValue({ drafts: [bound('d-7', 'client-1', 'ci-7'), stream2('w-1', 'client-2'), stream2('n-1', 'client-2', 'draft.send_notification')] });
    const view = await draw();
    await view.findByText('5 drafts to review');
    expect(view.queryByText('Pending AI drafts')).toBeNull();
    expect(view.queryByText(/Review what the AI proposed/)).toBeNull();
    expect(view.queryByText(/Roman has/)).toBeNull();
    expect(view.queryByText('Chat')).toBeNull();
    expect(view.queryByText('Drafts')).toBeNull();
    expect(view.queryByLabelText(/^(Chat|Drafts)$/)).toBeNull();
    expect(allWith(view.root, (p) => p.accessibilityRole === 'tab' || p.role === 'tab' || p.accessibilityRole === 'tablist')).toHaveLength(0);
  });

  it('every pressable on the list does something (KT-3): each one pressed in a table', async () => {
    mockListPending.mockResolvedValue({ drafts: [bound('d-7', 'client-1', 'ci-7'), stream2('w-1', 'client-2'), stream2('n-1', 'client-2', 'draft.send_notification')] });
    const view = await draw();
    await view.findByText('3 drafts to review');
    const table: [string, () => void][] = [
      ['Back', () => expect(mockGoBack).toHaveBeenCalledTimes(1)],
      ['Back to check-in', () => expect(mockNavigate).toHaveBeenCalledWith('ClientDetail', { clientId: 'client-1', clientName: 'Jordan Reyes', initialTab: 'timeline' })],
      ['Reject Workout suggestion for client client-2', () => expect(mockPatch).toHaveBeenCalledWith('/ai/gateway/drafts/w-1', { decision: 'rejected' })],
      ['Approve Check-in nudge for client client-2', () => expect(mockPatch).toHaveBeenCalledWith('/ai/gateway/drafts/n-1', { decision: 'approved' })],
      ['Review draft', () => expect(view.getByText("Roman's draft for Jordan")).toBeTruthy()],
    ];
    // The table names every button the list draws (the sheet is not open yet): a new pressable with no row here fails.
    const labels = allWith(view.root, (p) => p.accessibilityRole === 'button' && typeof p.accessibilityLabel === 'string').map((n) => n?.props?.accessibilityLabel);
    expect([...new Set(labels)].sort()).toEqual(table.map(([l]) => l).concat('Approve Workout suggestion for client client-2', 'Reject Check-in nudge for client client-2').sort());
    for (const [label, did] of table) {
      // A Stream 2 decision disables the card buttons until it settles: wait for the button to take a press again.
      await waitFor(() => expect(view.getByLabelText(label).props.accessibilityState?.disabled ?? false).toBe(false));
      await fireEvent.press(view.getByLabelText(label));
      await waitFor(did);
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    }
    await act(async () => undefined);
  });
});
