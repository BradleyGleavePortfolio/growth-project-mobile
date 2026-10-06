/**
 * CommunityReportsEntry (AUDIT-10-125 B-1): the coach Messages header opens the
 * community report queue, which no coach screen reached while the coach
 * Community tab is off in the store build. Hidden when the queue route does
 * not answer (community API off), shows the open count, and opens the queue
 * registered in the Clients stack.
 */
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000000' }) }),
}));
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return { ...actual, useNavigation: () => ({ navigate: mockNavigate }) };
});

import api from '../../../services/api';
import { CommunityReportsEntry } from '../CommunityReportsEntry';

const http = { get: api.get as jest.Mock };

const item = (id: string) => ({
  id,
  workspace_id: '00000000-0000-4000-8000-000000000001',
  target_type: 'post',
  target_id: '00000000-0000-4000-8000-0000000000aa',
  content: 'Reported text',
  media: null,
  removed: false,
  respond_by: '2026-10-07T20:00:00.000Z',
  overdue: false,
  author_user_id: '00000000-0000-4000-8000-0000000000bb',
  author_name: 'Sam Member',
  cohort_name: null,
  reason: 'harassment',
  notes: null,
  created_at: '2026-10-06T20:00:00.000Z',
});

function renderQ(node: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  mockNavigate.mockReset();
  http.get.mockReset();
});

describe('CommunityReportsEntry', () => {
  it('is hidden while the community API is off', async () => {
    http.get.mockRejectedValue({ isAxiosError: true, response: { status: 503, data: { code: 'community.disabled' } } });
    const r = await renderQ(<CommunityReportsEntry />);
    await waitFor(() => expect(http.get).toHaveBeenCalledWith('/community/moderation/flagged'));
    expect(r.queryByTestId('messages-community-reports-entry')).toBeNull();
  });

  it('shows the open report count and opens the queue in the Clients stack', async () => {
    http.get.mockResolvedValue({ data: { items: [item('00000000-0000-4000-8000-000000000011'), item('00000000-0000-4000-8000-000000000012')] } });
    const r = await renderQ(<CommunityReportsEntry />);
    await waitFor(() => expect(r.getByTestId('messages-community-reports-entry')).toBeTruthy());
    expect(r.getByTestId('messages-community-reports-count').props.children).toBe('2');
    await fireEvent.press(r.getByTestId('messages-community-reports-entry'));
    expect(mockNavigate).toHaveBeenCalledWith('ClientsStack', {
      screen: 'CoachCommunityModeration',
      initial: false,
    });
  });

  it('stays reachable with no open reports (no count badge)', async () => {
    http.get.mockResolvedValue({ data: { items: [] } });
    const r = await renderQ(<CommunityReportsEntry />);
    await waitFor(() => expect(r.getByTestId('messages-community-reports-entry')).toBeTruthy());
    expect(r.queryByTestId('messages-community-reports-count')).toBeNull();
  });
});
