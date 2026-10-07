import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react-native';
import { Alert, Linking, StyleSheet } from 'react-native';
import type { CoachingSession } from '../../../api/schedulingApi';
import { lightTokens } from '../../../theme/tokens';
import ClientUpcomingSessionsScreen from '../ClientUpcomingSessionsScreen';

const mockMutate = jest.fn();
const mockRefetch = jest.fn();
let mockLoading = false;
let mockError = false;
let mockCancelError = false;
let mockData: CoachingSession[] = [];
jest.mock('../../../hooks/useScheduling', () => ({
  useMyUpcomingSessions: () => ({ data: mockData, isLoading: mockLoading, isError: mockError, refetch: mockRefetch }),
  useCancelSession: () => ({ mutate: mockMutate, isPending: false, isError: mockCancelError, error: new Error('Network Error') }),
}));
jest.mock('../RescheduleSheet', () => ({
  __esModule: true,
  default: ({ session, onClose }: { session: CoachingSession; onClose: () => void }) => {
    const R = jest.requireActual('react');
    const RN = jest.requireActual('react-native');
    return R.createElement(RN.Pressable, { onPress: onClose, accessibilityLabel: 'Close move' }, R.createElement(RN.Text, {}, session.id));
  },
}));
const session = (over: Partial<CoachingSession> = {}): CoachingSession => ({
  id: 's1', coach_id: 'c1', client_id: 'u1', session_type_id: 't1', status: 'scheduled',
  start_at: '2030-10-07T16:00:00Z', end_at: '2030-10-07T16:20:00Z', title: 'Training',
  coach_notes_md: null, client_recap_md: null, video_provider: 'manual',
  video_url: 'https://meet.example/room', video_meeting_id: null, calendar_provider: 'stub',
  calendar_event_id: null, approved_at: null, ended_at: null, end_reason: null,
  created_at: '', updated_at: '', cancellable: true, ...over,
});
beforeEach(() => { jest.clearAllMocks(); mockData = [session(), session({ id: 's2', title: 'Check-in', start_at: '2030-10-08T16:00:00Z' })]; mockLoading = mockError = mockCancelError = false; });
afterEach(async () => { await cleanup(); jest.restoreAllMocks(); });

it('keeps Join, move, close and cancellation reachable, with one forest primary and hairline rows', async () => {
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const r = await render(<ClientUpcomingSessionsScreen />);
  expect(r.getByText('2 confirmed sessions.')).toBeTruthy();
  const joins = r.getAllByText('Join session (manual)');
  expect(StyleSheet.flatten(joins[0].parent?.props.style).backgroundColor).toBe(lightTokens.accent);
  expect(StyleSheet.flatten(joins[1].parent?.props.style).backgroundColor).not.toBe(lightTokens.accent);
  for (const button of r.getAllByRole('button')) expect(StyleSheet.flatten(button.props.style).minHeight).toBeGreaterThanOrEqual(44);
  expect(StyleSheet.flatten(r.getByText('Training').parent?.props.style)).toMatchObject({ borderTopWidth: StyleSheet.hairlineWidth });
  await fireEvent.press(r.getByLabelText('Join Training on manual'));
  expect(open).toHaveBeenCalledWith('https://meet.example/room');
  await fireEvent.press(r.getByLabelText('Reschedule Training'));
  expect(r.getByText('s1')).toBeTruthy();
  await fireEvent.press(r.getByLabelText('Close move'));
  expect(r.queryByText('s1')).toBeNull();
  await fireEvent.press(r.getByLabelText('Cancel Training'));
  expect(alert).toHaveBeenCalledWith('Cancel session', 'Are you sure? Your coach will be notified.', expect.any(Array));
  await act(async () => alert.mock.calls[0][2]?.find((b) => b.style === 'destructive')?.onPress?.());
  expect(mockMutate).toHaveBeenCalledWith({ id: 's1' });
  expect(r.getByText(new Date(mockData[0].start_at).toLocaleString())).toBeTruthy();
  open.mockRejectedValueOnce(new Error('No browser'));
  await fireEvent.press(r.getByLabelText('Join Training on manual'));
  expect(alert).toHaveBeenLastCalledWith('Could not open link', 'Open the session from Calendar or message your coach for the call link.');
});

it('shows neutral server lockout copy without inventing a four-hour deadline', async () => {
  mockData = [session({ cancellable: false, video_url: null })];
  const r = await render(<ClientUpcomingSessionsScreen />);
  expect(r.getByText('1 confirmed session.')).toBeTruthy();
  expect(r.getByText('This session can no longer be changed here. Message your coach if you need help.')).toBeTruthy();
  expect(r.queryByText(/4h|4 hours/)).toBeNull();
  expect(r.queryByText(/Join session/)).toBeNull();
  await fireEvent.press(r.getByLabelText('Cancel disabled for Training'));
  await fireEvent.press(r.getByLabelText('Reschedule Training'));
  expect(mockMutate).not.toHaveBeenCalled();
  expect(r.queryByText('s1')).toBeNull();
});

it('keeps loading, retry, empty and actionable cancellation failure states', async () => {
  mockLoading = true;
  const r = await render(<ClientUpcomingSessionsScreen />);
  expect(r.getByText('Loading upcoming sessions.')).toBeTruthy();
  mockLoading = false; mockError = true;
  await r.rerender(<ClientUpcomingSessionsScreen />);
  expect(r.getByText('Sessions could not be loaded. Refresh to try again.')).toBeTruthy();
  await fireEvent.press(r.getByText('Retry'));
  expect(mockRefetch).toHaveBeenCalled();
  mockError = false; mockData = [];
  await r.rerender(<ClientUpcomingSessionsScreen />);
  expect(r.getByText('No upcoming sessions.')).toBeTruthy();
  mockData = [session()]; mockCancelError = true;
  await r.rerender(<ClientUpcomingSessionsScreen />);
  expect(r.getByText(/connection dropped/)).toBeTruthy();
});
