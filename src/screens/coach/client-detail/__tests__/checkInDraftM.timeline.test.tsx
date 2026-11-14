/**
 * CHECKIN-DRAFT-M (owner #203-E13, #203-E14; ctx#503 layout A): "Draft a reply" on a client's check-in row on the
 * Timeline. Roman writes the reply to that one check-in; the coach edits it and sends it, and nothing reaches the
 * client without his Send on the sheet showing that draft. The real TimelineTab, its sheet and ReportMessageSheet;
 * services/api mocked at its edge with the b#1234 CONTRACT's shapes (6754622970, FIX ROUND 1 6757296797).
 */
import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('../../../../theme/ThemeProvider', () => ({
  useTheme: () => ({
    colors: new Proxy({}, { get: () => '#000000' }),
    semanticColors: jest.requireActual('../../../../theme/tokens').lightTokens,
    colorScheme: 'light',
  }),
}));
jest.mock('../../../../ui/layout/Screen', () => ({
  ...jest.requireActual('../../../../ui/layout/Screen'),
  useScreenInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));
const mockPost = jest.fn();
const mockPatch = jest.fn();
const mockGet = jest.fn();
const mockCheckIns = jest.fn();
jest.mock('../../../../services/api', () => ({
  __esModule: true,
  default: {
    post: (...a: unknown[]) => mockPost(...a),
    patch: (...a: unknown[]) => mockPatch(...a),
    get: (...a: unknown[]) => mockGet(...a),
  },
  coachApi: { getClientCheckIns: (...a: unknown[]) => mockCheckIns(...a) },
}));
// The phone's connection, switchable from a test (useNetworkStatus is NetInfo's one reader).
let mockOnline = true;
const mockNetListeners = new Set<() => void>();
jest.mock('../../../../hooks/useNetworkStatus', () => {
  const R = jest.requireActual('react');
  return {
    useNetworkStatus: () => {
      const [, bump] = R.useState(0);
      R.useEffect(() => {
        const l = () => bump((n: number) => n + 1);
        mockNetListeners.add(l);
        return () => { mockNetListeners.delete(l); };
      }, []);
      return { isOnline: mockOnline, isInternetReachable: mockOnline ? true : false };
    },
    isEffectivelyOnline: (s: { isOnline: boolean; isInternetReachable: boolean | null }) => s.isOnline && s.isInternetReachable !== false,
  };
});

import { TimelineTab } from '../TimelineTab';
import * as clientData from '../useClientDetailData';
import ReportMessageSheet from '../../../../components/messaging/ReportMessageSheet';
import type { TimelineEvent } from '../types';

const setOnline = async (v: boolean) => {
  await act(async () => { mockOnline = v; mockNetListeners.forEach((l) => l()); });
};
const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const TODAY = localDay();
const NOTE = 'Busy week at work, but I made time for my sessions.';
const REPLY = 'Hi Jordan, thanks for checking in. What helped you make that space this week?';

type Row = { id: string; date: string; notes?: string | null; mood?: number | null; energy?: number | null; sleep_hours?: number | null; soreness?: number | null; weight_lbs?: number | null; coach_id?: string; reviewed_by_coach?: boolean };
/** The Timeline's check-in event as useClientDetailData builds it from a timeline row. */
function event(row: Row): TimelineEvent {
  return {
    id: `checkin_${row.id}`, type: 'checkin', title: 'Check-in', subtitle: clientData.checkInSubtitle(row),
    date: `${row.date}T09:00:00`, icon: 'chatbubble-ellipses', iconColor: '#000000',
    checkIn: { id: row.id, coachId: row.coach_id ?? 'coach-1', reviewed: row.reviewed_by_coach === true },
    checkInDraft: clientData.checkInDraftFields(row),
  } as TimelineEvent;
}
const WITH_NOTE: Row = { id: 'ci-1', date: TODAY, notes: NOTE, mood: 4 };
const invoked = (draftId = 'd-1', reply = REPLY) => ({
  data: { request_id: 'r', audit_id: 'a', enabled: true, provider: 'anthropic', model: 'm', reply, draft_mode: true, approval: { required: true, status: 'pending', draft_id: draftId } },
});
const httpError = (status: number, data: Record<string, unknown> = {}) => Object.assign(new Error(`HTTP ${status}`), { response: { status, data } });
const never = () => new Promise<never>(() => undefined);

let qc: QueryClient;
async function renderFile(rows: Row[] = [WITH_NOTE], clientId = 'client-1', clientName = 'Jordan Reyes') {
  const ui = (r: Row[], id: string, name: string) => (
    <QueryClientProvider client={qc}>
      {/* ClientDetailScreen keys the file by client (:56): a new client is a new mount */}
      <TimelineTab key={id} events={r.map(event)} onLoad={() => undefined} days={90} viewerId="coach-1" onMarkReviewed={async () => undefined} clientId={id} clientName={name} />
    </QueryClientProvider>
  );
  const view = await render(ui(rows, clientId, clientName));
  return { ...view, switchTo: (r: Row[], id: string, name: string) => view.rerender(ui(r, id, name)) };
}
type FileView = Awaited<ReturnType<typeof renderFile>>;
const invokes = () => mockPost.mock.calls.filter(([url]) => url === '/ai/gateway/invoke');
const patches = () => mockPatch.mock.calls;

async function openReady(view: FileView) {
  await fireEvent.press(view.getByText('Draft a reply'));
  await view.findByText("Roman's draft for Jordan");
}

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mockOnline = true;
  mockPost.mockReset();
  mockPatch.mockReset();
  mockGet.mockReset();
  mockCheckIns.mockReset();
  mockPost.mockImplementation((url: string) => (url === '/ai/gateway/invoke' ? Promise.resolve(invoked()) : Promise.resolve({ data: { reportId: 'd-1', status: 'received' } })));
  mockPatch.mockResolvedValue({ data: { id: 'd-1', status: 'approved' } });
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('CHECKIN-DRAFT-M: the action on the check-in row', () => {
  it('case 1: a check-in with a note shows Draft a reply; one tap sends exactly one invoke for that check-in and draws the reply', async () => {
    const view = await renderFile();
    const action = view.getByLabelText("Draft a reply to Jordan's check-in with Roman");
    expect(within(action).getByText('Draft a reply')).toBeTruthy();
    await openReady(view);
    expect(invokes()).toEqual([[
      '/ai/gateway/invoke',
      { capability: 'draft.coach_message', subject_user_id: 'client-1', message: '', check_in_id: 'ci-1' },
    ]]);
    expect(view.getByTestId('checkin-draft-text').props.children).toBe(REPLY);
    expect(view.getByText('Drafted by Roman')).toBeTruthy();
    expect(view.getByText('Not sent')).toBeTruthy();
    expect(view.getByText('Jordan’s check-in')).toBeTruthy();
    expect(within(view.getByTestId('checkin-draft-source')).getByText(NOTE)).toBeTruthy();
    expect(view.getByText('Jordan Reyes · Check-in')).toBeTruthy();
    expect(view.getByText(/^Today · /)).toBeTruthy();
    expect(view.getByText('You read it before it goes. Nothing is sent until you tap Send.')).toBeTruthy();
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(patches()).toHaveLength(0);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('case 1: Mark reviewed and Draft a reply both show on an unreviewed row of mine; a reviewed row keeps the action', async () => {
    const view = await renderFile([WITH_NOTE, { id: 'ci-2', date: '2026-11-03', notes: 'Fine week.', reviewed_by_coach: true }]);
    expect(view.getByText('Mark reviewed')).toBeTruthy();
    expect(view.getByText('Reviewed')).toBeTruthy();
    expect(view.getAllByText('Draft a reply')).toHaveLength(2);
  });

  it('case 2: numbers only show the action and the numbers under No written note; sleep 0 alone shows; nothing to draft hides it', async () => {
    const view = await renderFile([
      { id: 'n-1', date: TODAY, notes: null, mood: 4, energy: 3, sleep_hours: 7.5 },
      { id: 'n-2', date: '2026-11-03', sleep_hours: 0 },
      { id: 'n-3', date: '2026-11-02', notes: '   ' },
      { id: 'n-4', date: '2026-11-01', soreness: 3, weight_lbs: 180 },
    ]);
    expect(view.getAllByText('Draft a reply')).toHaveLength(2);
    await fireEvent.press(view.getAllByText('Draft a reply')[0]);
    await view.findByText("Roman's draft for Jordan");
    const source = view.getByTestId('checkin-draft-source');
    expect(within(source).getByText('No written note')).toBeTruthy();
    expect(within(source).getByText('Mood 4/5 · Energy 3/5 · Sleep 7.5 h')).toBeTruthy();
    expect(invokes()[0][1]).toEqual({ capability: 'draft.coach_message', subject_user_id: 'client-1', message: '', check_in_id: 'n-1' });
  });

  it('case 2: the event keeps the note trimmed and the numbers from the row keys', async () => {
    expect(clientData.checkInDraftFields({ id: 'x', date: '2026-11-06T00:00:00.000Z', notes: '  Good week  ', mood: 5, energy: null, sleep_hours: 0 }))
      .toEqual({ day: '2026-11-06', note: 'Good week', mood: 5, energy: null, sleepHours: 0 });
    expect(clientData.checkInDraftFields({ id: 'y', date: '2026-11-06', notes: '  ' })).toEqual({ day: '2026-11-06', note: null, mood: null, energy: null, sleepHours: null });
  });
});

describe('CHECKIN-DRAFT-M: writing and refusals', () => {
  it('waiting: the head says Reply to Jordan, the source shows, Roman is writing and no Send', async () => {
    mockPost.mockImplementation(never);
    const view = await renderFile();
    await fireEvent.press(view.getByText('Draft a reply'));
    expect(await view.findByText('Reply to Jordan')).toBeTruthy();
    expect(view.getAllByText('Roman is writing').length).toBeGreaterThan(0);
    expect(within(view.getByTestId('checkin-draft-source')).getByText(NOTE)).toBeTruthy();
    expect(view.queryByLabelText('Send to Jordan')).toBeNull();
    expect(invokes()).toHaveLength(1);
  });

  it('case 3: a re-tap on a live draft gets the same draft back and shows its stored text', async () => {
    const view = await renderFile();
    await openReady(view);
    await fireEvent.press(view.getByTestId('checkin-draft-scrim'));
    await waitFor(() => expect(view.queryByTestId('checkin-draft-sheet')).toBeNull());
    mockPost.mockImplementation(() => Promise.resolve(invoked('d-1', 'Stored words from the first tap.')));
    await openReady(view);
    expect(view.getByTestId('checkin-draft-text').props.children).toBe('Stored words from the first tap.');
    expect(invokes()).toHaveLength(2);
    expect(patches()).toHaveLength(0);
  });

  it('case 4: switch or provider off (stub, no draft id): CD-57 with Not now only, no PATCH', async () => {
    mockPost.mockResolvedValue({ data: { enabled: false, provider: 'stub', reply: '', approval: { required: false, status: 'not_required', draft_id: null } } });
    const view = await renderFile();
    await fireEvent.press(view.getByText('Draft a reply'));
    expect(await view.findByText("Roman can't write this right now. Nothing was sent.")).toBeTruthy();
    expect(view.getByText('Reply to Jordan')).toBeTruthy();
    expect(view.getByLabelText('Not now')).toBeTruthy();
    expect(view.queryByLabelText('Try again')).toBeNull();
    expect(view.queryByLabelText('Send to Jordan')).toBeNull();
    await fireEvent.press(view.getByLabelText('Not now'));
    expect(patches()).toHaveLength(0);
  });

  it.each([
    [400, { code: 'CHECK_IN_DRAFT_INVALID' }], [402, { code: 'COACH_AI_BUDGET_EXHAUSTED' }], [403, { code: 'ai_consent_required' }],
    [403, { code: 'coach_ai_consent_required' }], [403, { code: 'messaging.blocked' }], [404, { code: 'CHECK_IN_NOT_FOUND' }],
    [422, { code: 'CHECK_IN_NOTHING_TO_DRAFT' }], [422, { code: 'CHECK_IN_NEEDS_COACH' }],
  ])('case 5: invoke %s %o: CD-57, no Try again', async (status, data) => {
    mockPost.mockRejectedValue(httpError(status, data));
    const view = await renderFile();
    await fireEvent.press(view.getByText('Draft a reply'));
    expect(await view.findByText("Roman can't write this right now. Nothing was sent.")).toBeTruthy();
    expect(view.queryByLabelText('Try again')).toBeNull();
    expect(view.getByLabelText('Not now')).toBeTruthy();
    expect(invokes()).toHaveLength(1);
  });

  it.each([['no answer', new Error('Network Error')], ['500', httpError(500)]])('case 6: %s on invoke: CD-58 with Try again, which sends one invoke', async (_l, err) => {
    mockPost.mockRejectedValueOnce(err);
    const view = await renderFile();
    await fireEvent.press(view.getByText('Draft a reply'));
    expect(await view.findByText("Roman couldn't write this. Nothing was sent. Try again in a moment.")).toBeTruthy();
    expect(view.getByLabelText('Not now')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('Try again'));
    await view.findByText("Roman's draft for Jordan");
    expect(invokes()).toHaveLength(2);
  });
});

describe('CHECKIN-DRAFT-M: edit and send', () => {
  it('case 7: Send without an edit approves with no payload; 200 draws the sent state', async () => {
    const view = await renderFile();
    await openReady(view);
    await fireEvent.press(view.getByLabelText('Send to Jordan'));
    expect(await view.findByText('Sent by you in Messages.')).toBeTruthy();
    expect(view.getAllByText('Sent to Jordan').length).toBeGreaterThan(0);
    expect(view.getByText(REPLY)).toBeTruthy();
    expect(view.getByText('Drafted by Roman')).toBeTruthy();
    expect(patches()).toHaveLength(1);
    const [url, body] = patches()[0];
    expect(url).toBe('/ai/gateway/drafts/d-1');
    expect(body).toEqual({ decision: 'approved' });
    expect('payload' in body).toBe(false);
    await fireEvent.press(view.getByLabelText('Done'));
    await waitFor(() => expect(view.queryByTestId('checkin-draft-sheet')).toBeNull());
  });

  it('case 8: Edit, Save edits, Send sends the saved text trimmed; Edited by you keeps the Roman attribution', async () => {
    const view = await renderFile();
    await openReady(view);
    await fireEvent.press(view.getByLabelText("Edit reply to Jordan's check-in"));
    expect(view.getByText('Edit your reply')).toBeTruthy();
    expect(view.getByText('Your edits stay here until you tap Send.')).toBeTruthy();
    expect(view.queryByLabelText('Send to Jordan')).toBeNull();
    await fireEvent.changeText(view.getByLabelText('Your reply to Jordan'), '  Would moving Tuesday to the morning help?  ');
    await fireEvent.press(view.getByLabelText('Save edits'));
    expect(await view.findByText('Edited by you')).toBeTruthy();
    expect(view.getByText('Drafted by Roman')).toBeTruthy();
    expect(view.getByText('Not sent')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('Send to Jordan'));
    await view.findByText('Sent by you in Messages.');
    expect(patches()).toEqual([['/ai/gateway/drafts/d-1', { decision: 'approved', payload: { body: 'Would moving Tuesday to the morning help?' } }]]);
  });

  it('case 8: Cancel restores the text from before the edit and sends no payload', async () => {
    const view = await renderFile();
    await openReady(view);
    await fireEvent.press(view.getByLabelText("Edit reply to Jordan's check-in"));
    await fireEvent.changeText(view.getByLabelText('Your reply to Jordan'), 'Something else entirely');
    await fireEvent.press(view.getByLabelText('Cancel'));
    expect(view.getByTestId('checkin-draft-text').props.children).toBe(REPLY);
    expect(view.queryByText('Edited by you')).toBeNull();
    await fireEvent.press(view.getByLabelText('Send to Jordan'));
    await view.findByText('Sent by you in Messages.');
    expect('payload' in patches()[0][1]).toBe(false);
  });

  it('case 9: a blank or whitespace edit cannot be saved; a 4,001-character paste is cut at 4,000', async () => {
    const view = await renderFile();
    await openReady(view);
    await fireEvent.press(view.getByLabelText("Edit reply to Jordan's check-in"));
    const field = view.getByLabelText('Your reply to Jordan');
    expect(field.props.maxLength).toBe(4000);
    await fireEvent.changeText(field, '   \n  ');
    expect(view.getByLabelText('Save edits').props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(view.getByLabelText('Save edits'));
    expect(view.getByText('Edit your reply')).toBeTruthy();
    await fireEvent.changeText(view.getByLabelText('Your reply to Jordan'), 'a'.repeat(4001));
    expect(view.getByLabelText('Your reply to Jordan').props.value).toHaveLength(4000);
  });

  it('case 10: a double tap on Send sends one PATCH', async () => {
    mockPatch.mockImplementation(never);
    const view = await renderFile();
    await openReady(view);
    const send = view.getByLabelText('Send to Jordan');
    await fireEvent.press(send);
    await fireEvent.press(send);
    await waitFor(() => expect(view.getAllByText('Sending').length).toBeGreaterThan(0));
    await fireEvent.press(view.getByLabelText('Send to Jordan'));
    expect(patches()).toHaveLength(1);
    expect(view.queryByLabelText('Not now')).toBeNull();
  });

  it('case 11: a lost Send keeps the edited text and waits for a tap; a second Send answered "already approved" is sent', async () => {
    mockPatch.mockRejectedValueOnce(new Error('Network Error'));
    const view = await renderFile();
    await openReady(view);
    await fireEvent.press(view.getByLabelText("Edit reply to Jordan's check-in"));
    await fireEvent.changeText(view.getByLabelText('Your reply to Jordan'), 'My own words.');
    await fireEvent.press(view.getByLabelText('Save edits'));
    await fireEvent.press(view.getByLabelText('Send to Jordan'));
    expect(await view.findByText('Not sent to Jordan. Try again.')).toBeTruthy();
    expect(view.getByTestId('checkin-draft-text').props.children).toBe('My own words.');
    expect(view.queryByText('Sent by you in Messages.')).toBeNull();
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(patches()).toHaveLength(1);
    mockPatch.mockRejectedValueOnce(httpError(403, { statusCode: 403, message: 'Draft already approved', error: 'Forbidden' }));
    await fireEvent.press(view.getByLabelText('Send to Jordan'));
    expect(await view.findByText('Sent by you in Messages.')).toBeTruthy();
    expect(view.getByText('My own words.')).toBeTruthy();
    expect(patches()).toHaveLength(2);
    expect(patches()[1][1]).toEqual({ decision: 'approved', payload: { body: 'My own words.' } });
  });

  it.each([
    [409, { error: 'AI_DRAFT_RACE_IN_FLIGHT' }], [500, { code: 'AI_MATERIALISATION_FAILED' }], [400, { error: 'AI_DRAFT_PAYLOAD_INVALID' }],
  ])('case 12: Send %s: CD-62 over the kept text, not sent', async (status, data) => {
    mockPatch.mockRejectedValueOnce(httpError(status, data));
    const view = await renderFile();
    await openReady(view);
    await fireEvent.press(view.getByLabelText('Send to Jordan'));
    expect(await view.findByText('Not sent to Jordan. Try again.')).toBeTruthy();
    expect(view.getByTestId('checkin-draft-text').props.children).toBe(REPLY);
    expect(view.queryByText('Sent by you in Messages.')).toBeNull();
    expect(view.getByLabelText('Send to Jordan')).toBeTruthy();
  });

  it.each([
    [404, { message: 'AI draft not found' }], [403, { message: 'BLOCKED' }],
  ])('case 13: Send %s: CD-57 with Not now only', async (status, data) => {
    mockPatch.mockRejectedValueOnce(httpError(status, data));
    const view = await renderFile();
    await openReady(view);
    await fireEvent.press(view.getByLabelText('Send to Jordan'));
    expect(await view.findByText("Roman can't write this right now. Nothing was sent.")).toBeTruthy();
    expect(view.queryByLabelText('Send to Jordan')).toBeNull();
    expect(view.queryByLabelText('Try again')).toBeNull();
    expect(view.getByLabelText('Not now')).toBeTruthy();
  });
});

describe('CHECKIN-DRAFT-M: offline, close and report', () => {
  it('case 14: offline at open asks nothing; CD-60 and a disabled Draft a reply; back online nothing is sent until a tap', async () => {
    mockOnline = false;
    const view = await renderFile();
    await fireEvent.press(view.getByLabelText("Draft a reply to Jordan's check-in with Roman"));
    expect(await view.findByText("You’re offline. Connect to ask Roman for a draft. Nothing was sent.")).toBeTruthy();
    const ask = view.getByTestId('checkin-draft-ask');
    expect(ask.props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(ask);
    expect(invokes()).toHaveLength(0);
    await setOnline(true);
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(invokes()).toHaveLength(0);
    expect(view.getByTestId('checkin-draft-ask').props.accessibilityState).toMatchObject({ disabled: false });
    await fireEvent.press(view.getByTestId('checkin-draft-ask'));
    await view.findByText("Roman's draft for Jordan");
    expect(invokes()).toHaveLength(1);
  });

  it('case 14: offline with a draft: CD-61, Send disabled, the text kept; reconnect sends nothing', async () => {
    const view = await renderFile();
    await openReady(view);
    await setOnline(false);
    expect(await view.findByText('You’re offline. Your edits are still here. Connect before sending.')).toBeTruthy();
    expect(view.getByLabelText('Send to Jordan').props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(view.getByLabelText('Send to Jordan'));
    expect(view.getByTestId('checkin-draft-text').props.children).toBe(REPLY);
    await setOnline(true);
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(patches()).toHaveLength(0);
    expect(view.queryByText('You’re offline. Your edits are still here. Connect before sending.')).toBeNull();
  });

  it('case 15: Not now on ready rejects once; the scrim leaves the draft pending; a later tap drafts again', async () => {
    const view = await renderFile();
    await openReady(view);
    await fireEvent.press(view.getByTestId('checkin-draft-scrim'));
    await waitFor(() => expect(view.queryByTestId('checkin-draft-sheet')).toBeNull());
    expect(patches()).toHaveLength(0);
    await openReady(view);
    await fireEvent.press(view.getByLabelText('Not now'));
    await waitFor(() => expect(view.queryByTestId('checkin-draft-sheet')).toBeNull());
    expect(patches()).toEqual([['/ai/gateway/drafts/d-1', { decision: 'rejected' }]]);
    expect(invokes()).toHaveLength(2);
  });

  it('case 15: the scrim while editing goes back to the review text, not out of the sheet', async () => {
    const view = await renderFile();
    await openReady(view);
    await fireEvent.press(view.getByLabelText("Edit reply to Jordan's check-in"));
    await fireEvent.changeText(view.getByLabelText('Your reply to Jordan'), 'Half typed');
    await fireEvent.press(view.getByTestId('checkin-draft-scrim'));
    expect(view.getByTestId('checkin-draft-text').props.children).toBe(REPLY);
    expect(view.getByTestId('checkin-draft-sheet')).toBeTruthy();
  });

  it.each([['received'], ['already_reported']])('case 16: Report this draft posts {reason} only; %s ends in the Roman room words; the draft stays', async (status) => {
    const view = await renderFile();
    await openReady(view);
    mockPost.mockResolvedValueOnce({ data: { reportId: 'd-1', status } });
    await fireEvent.press(view.getByLabelText('Report this draft'));
    expect(await view.findByText('Report Message')).toBeTruthy();
    expect(view.queryByLabelText('Additional details')).toBeNull();
    await fireEvent.press(view.getByLabelText('Harassment or bullying'));
    await fireEvent.press(view.getByLabelText('Submit report'));
    await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('Reported', 'Your report has been submitted.'));
    const reports = mockPost.mock.calls.filter(([url]) => url === '/ai/gateway/drafts/d-1/report');
    expect(reports).toEqual([['/ai/gateway/drafts/d-1/report', { reason: 'harassment' }]]);
    expect(Object.keys(reports[0][1] as object)).toEqual(['reason']);
    expect(view.getByTestId('checkin-draft-text').props.children).toBe(REPLY);
    expect(view.getByLabelText('Send to Jordan')).toBeTruthy();
    expect(patches()).toHaveLength(0);
  });

  it('case 16: a hate-speech pick goes on the wire as harassment; a 404 keeps the report sheet and its failure line', async () => {
    const view = await renderFile();
    await openReady(view);
    mockPost.mockRejectedValueOnce(httpError(404, { message: 'AI draft not found' }));
    await fireEvent.press(view.getByLabelText('Report this draft'));
    await fireEvent.press(await view.findByLabelText('Hate speech'));
    await fireEvent.press(view.getByLabelText('Submit report'));
    expect(await view.findByText('Sending your report could not be confirmed. Check your connection, then try again.')).toBeTruthy();
    expect(mockPost.mock.calls.filter(([url]) => url === '/ai/gateway/drafts/d-1/report')).toEqual([['/ai/gateway/drafts/d-1/report', { reason: 'harassment' }]]);
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it("case 21: a sheet open on client A's file never draws A's draft on client B's file, or after the file is gone", async () => {
    const view = await renderFile();
    await openReady(view);
    await view.switchTo([{ id: 'ci-9', date: TODAY, notes: 'Another client.' }], 'client-2', 'Sam Lee');
    expect(view.queryByText(REPLY)).toBeNull();
    expect(view.queryByTestId('checkin-draft-sheet')).toBeNull();
    expect(view.getByLabelText("Draft a reply to Sam's check-in with Roman")).toBeTruthy();
    await view.unmount();
    const again = await renderFile();
    expect(again.queryByTestId('checkin-draft-sheet')).toBeNull();
    expect(again.queryByText(REPLY)).toBeNull();
  });
});

describe('CHECKIN-DRAFT-M: ReportMessageSheet current callers (case 23)', () => {
  it('the Roman room look without the new prop keeps More details and passes the details on', async () => {
    const onSubmit = jest.fn().mockResolvedValue(undefined);
    const view = await render(<ReportMessageSheet visible look="roman" messagePreview="A reply" onSubmit={onSubmit} onClose={() => undefined} />);
    expect(view.getByText('More details (optional)')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('Spam'));
    await fireEvent.changeText(view.getByLabelText('Additional details'), 'More words');
    await fireEvent.press(view.getByLabelText('Submit report'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ reason: 'spam', details: 'More words' }));
  });
});
