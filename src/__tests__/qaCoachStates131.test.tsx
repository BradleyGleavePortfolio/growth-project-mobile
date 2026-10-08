/**
 * QA-COACH-STATES-131: the coach screens share ONE calm "could not load"
 * (a sentence in words, no red, no icon, no box, and a forest "Try again"
 * text action with a 44 pt target) and ONE loading look (the shared
 * skeleton; its label is spoken, not printed). "Check your connection"
 * appears only when the request got no answer; raw server text never shows.
 * Failing first on mobile main e1688b51. Every route and action keeps parity.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Colors from '../constants/colors';

jest.mock('../services/sentry', () => ({ captureError: jest.fn() }));
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
  useIsFocused: () => true,
  useFocusEffect: jest.fn(),
}));
jest.mock('../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'coach-1', email: 'c@x.io', role: 'coach' }),
}));
jest.mock('../api/schedulingApi', () => ({
  ...jest.requireActual('../api/schedulingApi'),
  schedulingApi: { listMySessions: jest.fn() },
}));
jest.mock('../api/invites', () => ({
  invitesApi: { listInvites: jest.fn(), resendInvite: jest.fn(), revokeInvite: jest.fn() },
}));
jest.mock('../services/ptmApi', () => ({ ptmApi: { getMyRiskBoard: jest.fn() } }));
const mockDrafts = jest.fn();
jest.mock('../hooks/usePendingAiDrafts', () => ({
  COACH_AI_PENDING_DRAFTS_QUERY_KEY: ['coach', 'ai', 'pending-drafts'],
  usePendingAiDrafts: () => mockDrafts(),
}));
jest.mock('../api/coachAiExecutionApi', () => ({
  coachAiExecutionApi: { approveDraft: jest.fn(), rejectDraft: jest.fn() },
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));

import { schedulingApi } from '../api/schedulingApi';
import { invitesApi } from '../api/invites';
import { ptmApi } from '../services/ptmApi';
import CoachBookingInboxScreen from '../screens/coach/CoachBookingInboxScreen';
import CoachInvitesScreen from '../screens/coach/CoachInvitesScreen';
import PendingAiDraftsScreen from '../screens/coach/PendingAiDraftsScreen';
import RiskBoardScreen from '../screens/coach/RiskBoardScreen';
import { FailureBox, LoadingRow } from '../screens/coach/programs/ProgramUi';

const listSessions = jest.mocked(schedulingApi.listMySessions);
const listInvites = jest.mocked(invitesApi.listInvites);
const riskBoard = jest.mocked(ptmApi.getMyRiskBoard);

const serverDown = Object.assign(new Error('Request failed with status code 500'), {
  isAxiosError: true,
  response: { status: 500, data: { message: 'raw server text' } },
});
const offline = Object.assign(new Error('Network Error'), { isAxiosError: true, code: 'ERR_NETWORK' });
const forbidden = Object.assign(new Error('Request failed with status code 403'), {
  isAxiosError: true,
  response: { status: 403, data: { message: 'Forbidden resource' } },
});
const RED = [Colors.error, Colors.noticeCriticalBg, Colors.noticeCriticalAccent, Colors.noticeCriticalText];

type Found = Awaited<ReturnType<typeof render>>['root'];

/** The calm look: words in ink, no red anywhere, a forest text "Try again" of 44 pt. */
function expectCalm(root: NonNullable<Found>, action = 'Try again') {
  const json = JSON.stringify(root.toJSON());
  for (const red of RED) expect(json).not.toContain(red);
  expect(json).not.toMatch(/Couldn't|Pull down/);
  expect(within(root).queryByRole('button', { name: 'Retry' })).toBeNull();
  const button = within(root).getByRole('button', { name: action });
  const box = StyleSheet.flatten(button.props.style);
  expect(box.backgroundColor).toBeUndefined();
  expect(box.borderWidth).toBeUndefined();
  expect(box.minHeight).toBeGreaterThanOrEqual(44);
  expect(StyleSheet.flatten(within(root).getByText(action).props.style).color).toBe(Colors.primary);
  return button;
}

const clients: QueryClient[] = [];
function withQuery(node: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(qc);
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}
beforeEach(() => jest.clearAllMocks());
afterEach(async () => {
  await cleanup();
  for (const qc of clients.splice(0)) qc.clear();
});

describe('Booking inbox', () => {
  it('a failed request list is one calm error; Try again reloads it', async () => {
    listSessions.mockImplementation(async (_n, opts) => {
      if (opts?.status?.includes('requested')) throw serverDown;
      return [];
    });
    const r = await withQuery(<CoachBookingInboxScreen />);
    const state = await r.findByTestId('coach-requests-error');
    expect(within(state).getByText(/The app could not load booking requests/)).toBeTruthy();
    expect(JSON.stringify(state.toJSON())).not.toMatch(/connection/i);
    const calls = listSessions.mock.calls.length;
    await fireEvent.press(expectCalm(state));
    await waitFor(() => expect(listSessions.mock.calls.length).toBeGreaterThan(calls));
  });

  it('offline, the request list error names the connection', async () => {
    listSessions.mockImplementation(async (_n, opts) => {
      if (opts?.status?.includes('requested')) throw offline;
      return [];
    });
    const r = await withQuery(<CoachBookingInboxScreen />);
    const state = await r.findByTestId('coach-requests-error');
    expect(within(state).getByText(/connection dropped/)).toBeTruthy();
  });

  it('upcoming and past sessions fail inline with their own Try again; past sessions load as a skeleton', async () => {
    listSessions.mockImplementation(async (_n, opts) => {
      if (opts?.status?.includes('pending_provider')) throw serverDown;
      return [];
    });
    const r = await withQuery(<CoachBookingInboxScreen />);
    const agenda = await r.findByTestId('coach-agenda-error');
    await fireEvent.press(expectCalm(agenda));
    await waitFor(() =>
      expect(listSessions.mock.calls.filter(([, o]) => o?.status?.includes('pending_provider')).length).toBe(2),
    );
    await cleanup();

    let failPast = false;
    listSessions.mockImplementation((_n, opts) => {
      if (opts?.scope !== 'past') return Promise.resolve([]);
      return failPast ? Promise.reject(serverDown) : new Promise(() => undefined);
    });
    const loading = await withQuery(<CoachBookingInboxScreen />);
    const skeleton = await loading.findByTestId('coach-ended-loading');
    expect(skeleton.props.accessibilityLabel).toBe('Loading past sessions');
    expect(loading.queryByText(/Loading past sessions/)).toBeNull();
    await cleanup();

    failPast = true;
    const failed = await withQuery(<CoachBookingInboxScreen />);
    const past = await failed.findByTestId('coach-ended-error');
    expect(within(past).getByText(/The app could not load past sessions/)).toBeTruthy();
    expectCalm(past);
  });
});

describe('Invites', () => {
  type Nav = React.ComponentProps<typeof CoachInvitesScreen>['navigation'];
  const nav = { navigate: jest.fn(), goBack: jest.fn() } as Partial<Nav> as Nav;

  it('loads as a skeleton under the top bar: Back and Bulk invite stay reachable', async () => {
    listInvites.mockReturnValue(new Promise(() => undefined));
    const r = await render(<CoachInvitesScreen navigation={nav} />);
    expect(r.getByTestId('coach-invites-loading').props.accessibilityLabel).toBe('Loading invites');
    await fireEvent.press(r.getByLabelText('Bulk invite'));
    expect(nav.navigate).toHaveBeenCalledWith('BulkInvite');
    await fireEvent.press(r.getByLabelText('Go back'));
    expect(nav.goBack).toHaveBeenCalled();
  });

  it('a refused load never shows server text; Try again reloads', async () => {
    listInvites.mockRejectedValueOnce(forbidden).mockResolvedValueOnce([]);
    const r = await render(<CoachInvitesScreen navigation={nav} />);
    const state = await r.findByTestId('coach-invites-error-state');
    expect(r.queryByText(/Forbidden resource/)).toBeNull();
    expect(within(state).getByText('Your invites could not load. Try again in a moment.')).toBeTruthy();
    await fireEvent.press(expectCalm(state));
    await waitFor(() => expect(r.getByTestId('coach-invites-empty')).toBeTruthy());
    expect(listInvites).toHaveBeenCalledTimes(2);
  });

  it('says "Check your connection" only when the request got no answer', async () => {
    listInvites.mockRejectedValueOnce(offline);
    const r = await render(<CoachInvitesScreen navigation={nav} />);
    expect(await r.findByText('Your invites could not load. Check your connection, then try again.')).toBeTruthy();
    await cleanup();
    listInvites.mockRejectedValueOnce(serverDown);
    const s = await render(<CoachInvitesScreen navigation={nav} />);
    await s.findByTestId('coach-invites-error-state');
    expect(s.queryByText(/connection/i)).toBeNull();
  });
});

describe('Pending AI drafts', () => {
  const base = { data: undefined, isLoading: false, isError: false, isFetching: false, error: null, refetch: jest.fn() };

  it('loads as a skeleton, not an empty state titled "Loading"', async () => {
    mockDrafts.mockReturnValue({ ...base, isLoading: true, isFetching: true });
    const r = await withQuery(<PendingAiDraftsScreen />);
    expect(r.getByTestId('pending-ai-drafts-loading').props.accessibilityLabel).toBe('Loading pending drafts');
    expect(r.queryByText(/Loading pending drafts/)).toBeNull();
  });

  it('a failed load is the calm error; Try again refetches', async () => {
    const refetch = jest.fn();
    mockDrafts.mockReturnValue({ ...base, isError: true, error: offline, refetch });
    const r = await withQuery(<PendingAiDraftsScreen />);
    const state = r.getByTestId('pending-ai-drafts-error');
    expect(within(state).getByText('Pending AI drafts could not load. Check your connection, then try again.')).toBeTruthy();
    await fireEvent.press(expectCalm(state));
    expect(refetch).toHaveBeenCalled();
  });
});

describe('Risk board', () => {
  it('never shows the raw error; Try again loads the board again', async () => {
    riskBoard.mockRejectedValueOnce(serverDown).mockResolvedValueOnce({ data: { items: [], next_cursor: null } });
    const r = await render(<RiskBoardScreen />);
    const state = await r.findByTestId('risk-board-error');
    expect(r.queryByText(/status code|raw server text/)).toBeNull();
    expect(within(state).getByText('The risk board could not load. Try again in a moment.')).toBeTruthy();
    await fireEvent.press(expectCalm(state));
    expect(await r.findByText(/Risk levels update every night/)).toBeTruthy();
    expect(riskBoard).toHaveBeenCalledTimes(2);
  });

  it('offline, the risk board names the connection', async () => {
    riskBoard.mockRejectedValueOnce(offline);
    const r = await render(<RiskBoardScreen />);
    expect(await r.findByText('The risk board could not load. Check your connection, then try again.')).toBeTruthy();
  });
});

describe('Programs FailureBox and LoadingRow', () => {
  const failure = {
    code: null, status: 500, reference: 'AB12CD34', support: true, reload: false,
    message: 'Could not load programs because of a problem on the server. Retry; if it happens again, contact support and quote reference AB12CD34.',
  };

  it('is calm: Try again reruns, Contact support opens the support inbox', async () => {
    const onRetry = jest.fn();
    const r = await render(<FailureBox failure={failure} onRetry={onRetry} />);
    expect(r.getByText(failure.message)).toBeTruthy();
    const json = JSON.stringify(r.toJSON());
    for (const red of RED) expect(json).not.toContain(red);
    const root = r.root;
    if (!root) throw new Error('FailureBox rendered nothing');
    await fireEvent.press(expectCalm(root));
    expect(onRetry).toHaveBeenCalled();
    const support = r.getByRole('button', { name: 'Contact support' });
    expect(StyleSheet.flatten(support.props.style).minHeight).toBeGreaterThanOrEqual(44);
    await fireEvent.press(support);
    expect(mockNavigate).toHaveBeenCalledWith('SupportInbox');
  });

  it('an ended session offers Sign in again (forest) instead of Try again', async () => {
    const r = await render(
      <FailureBox failure={{ ...failure, status: 401, support: false, recovery: 'sign_in' }} onRetry={jest.fn()} />,
    );
    expect(r.queryByRole('button', { name: 'Try again' })).toBeNull();
    const root = r.root;
    if (!root) throw new Error('FailureBox rendered nothing');
    // The sign-out handler is unchanged (a dynamic import jest cannot run).
    expect(expectCalm(root, 'Sign in again').props.accessibilityHint).toBe('Signs you out so you can sign back in');
  });

  it('LoadingRow is the shared skeleton with a spoken label', async () => {
    const r = await render(<LoadingRow label="Loading programs" />);
    expect(r.getByLabelText('Loading programs')).toBeTruthy();
    expect(r.queryByText('Loading programs')).toBeNull();
  });
});
