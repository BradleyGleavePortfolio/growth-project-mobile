/**
 * S-REACH: coach view of a client's consultation answers (backend #607,
 * GET /coach/clients/:clientId/consultation). Covers the answers view
 * (readiness first), the empty state, one specific failure state per cause
 * with a working action, Sentry reporting without answers, and that the
 * answers never enter the persisted query cache.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockGet = jest.fn();
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { get: (u: string) => mockGet(u) },
}));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ semanticColors: new Proxy({}, { get: () => '#000000' }) }),
}));
const mockSignOut = jest.fn(() => Promise.resolve());
jest.mock('../../../services/authActions', () => ({ signOut: () => mockSignOut() }));
const mockReport = jest.fn();
jest.mock('../../../lib/consultation/report', () => ({
  reportUnexpected: (where: string, info: unknown) => mockReport(where, info),
}));
const mockOpenSupport = jest.fn(() => Promise.resolve());
jest.mock('../../../components/support/SupportEmailFallback', () => ({
  useSupportEmail: () => ({ state: 'idle', open: mockOpenSupport, copy: jest.fn() }),
  SupportEmailFallback: () => null,
}));

import ClientConsultationScreen, { failureCopy, firstNameOf } from '../ClientConsultationScreen';
import { ConsultationLoadError, type ConsultationView } from '../../../api/coachConsultationApi';

const CLIENT = '11111111-1111-4111-8111-111111111111';

const VIEW: ConsultationView = {
  version: 'consult-v1',
  revision: 3,
  revision_cause: 'complete',
  submitted_at: '2026-10-01T15:00:00.000Z',
  saved_at: '2026-10-01T15:00:00.000Z',
  chapters: [
    {
      key: 'body',
      title: 'Body basics',
      answers: [{ screen: 'B3', question: 'Your height and weight.', answer_label: '5 ft 6 in (168 cm), 172 lb' }],
    },
    { key: 'schedule', title: 'Your week', answers: [] },
  ],
  screening: {
    any_yes: true,
    items: [
      { key: 'P1', question: 'Question one', answer: 'no', note: null },
      { key: 'P2', question: 'Has a joint ever stopped you training?', answer: 'yes', note: 'Left knee, 2024' },
    ],
  },
  consent: { version: 'consult-consent-v3', agreed_at: '2026-10-01T14:00:00.000Z' },
};

function httpError(status: number | null, data?: unknown) {
  return Object.assign(new Error(`status ${status}`), {
    isAxiosError: true,
    config: { headers: {} },
    response: status === null ? undefined : { status, data, headers: {} },
  });
}

async function mount(clientName = 'Sam Rivera') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = await render(
    <QueryClientProvider client={qc}>
      <ClientConsultationScreen route={{ key: 'k', name: 'ClientConsultation', params: { clientId: CLIENT, clientName } }} />
    </QueryClientProvider>,
  );
  return { qc, ...utils };
}

beforeEach(() => {
  mockGet.mockReset();
  mockReport.mockReset();
  mockSignOut.mockClear();
  mockOpenSupport.mockClear();
});

describe('ClientConsultationScreen', () => {
  it('shows a loading state while the answers are read', async () => {
    mockGet.mockReturnValueOnce(new Promise(() => undefined));
    await mount();
    expect(screen.getByTestId('consultation-loading')).toBeTruthy();
  });

  it('shows the readiness yes answers first, then every chapter, from the coach route', async () => {
    mockGet.mockResolvedValueOnce({ data: VIEW });
    await mount();
    await screen.findByTestId('consultation-answers');
    expect(mockGet).toHaveBeenCalledWith(`/coach/clients/${CLIENT}/consultation`);
    expect(screen.getByText('Sam Rivera')).toBeTruthy();
    expect(screen.getByTestId('consultation-screening-flag').props.children).toMatch(/Yes to one question/);
    expect(screen.getByText('Has a joint ever stopped you training?')).toBeTruthy();
    expect(screen.getByText('Left knee, 2024')).toBeTruthy();
    expect(screen.queryByText('Question one')).toBeNull();
    expect(screen.getByText('5 ft 6 in (168 cm), 172 lb')).toBeTruthy();
    expect(screen.getByTestId('consultation-chapter-schedule')).toBeTruthy();
    expect(screen.getByTestId('consultation-status').props.children).toMatch(/^Completed /);
    expect(screen.getByTestId('consultation-consent')).toBeTruthy();
  });

  it('says plainly when every readiness answer is no, and when some are still to answer', async () => {
    mockGet.mockResolvedValueOnce({
      data: {
        ...VIEW,
        submitted_at: null,
        screening: { any_yes: false, items: [VIEW.screening.items[0], { ...VIEW.screening.items[1], answer: null, note: null }] },
      },
    });
    await mount();
    const line = await screen.findByTestId('consultation-readiness-line');
    expect(line.props.children).toBe('No to the 1 answered so far, 1 still to answer.');
    expect(screen.getByTestId('consultation-status').props.children).toMatch(/^In progress, last saved /);
  });

  it('shows an honest empty state on the uniform 404', async () => {
    mockGet.mockRejectedValueOnce(httpError(404, { message: 'Consultation not found' }));
    await mount();
    await screen.findByTestId('consultation-none');
    expect(screen.getByText('No consultation answers are on file for Sam yet.')).toBeTruthy();
    expect(mockReport).not.toHaveBeenCalled();
  });

  it('offline: says what happened, offers Try again, and does not report', async () => {
    mockGet.mockRejectedValueOnce(httpError(null)).mockResolvedValueOnce({ data: VIEW });
    await mount();
    await screen.findByTestId('consultation-error-offline');
    expect(screen.getByText('No connection')).toBeTruthy();
    expect(screen.queryByTestId('consultation-support')).toBeNull();
    expect(mockReport).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('consultation-retry'));
    await screen.findByTestId('consultation-answers');
  });

  it('session ended: offers Log in again, which signs out', async () => {
    mockGet.mockRejectedValueOnce(httpError(401, { message: 'Unauthorized' }));
    await mount();
    await screen.findByTestId('consultation-error-session');
    await fireEvent.press(screen.getByTestId('consultation-login'));
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it('unexpected: shows a short reference, Try again and Email support, and reports without answers', async () => {
    mockGet.mockRejectedValueOnce(httpError(500, { message: 'Internal server error', request_id: 'abcdef1234567890' }));
    await mount();
    await screen.findByTestId('consultation-error-unexpected');
    expect(screen.getByText('The answers did not load')).toBeTruthy();
    expect(screen.getByTestId('consultation-error-reference').props.children).toEqual(['Reference ', 'abcdef12']);
    await fireEvent.press(screen.getByTestId('consultation-support'));
    expect(mockOpenSupport).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mockReport).toHaveBeenCalledTimes(1));
    expect(mockReport).toHaveBeenCalledWith('coach_consultation_read', {
      status: 500,
      code: 'http_500',
      requestId: 'abcdef1234567890',
    });
    expect(screen.getByTestId('consultation-retry')).toBeTruthy();
  });

  it('keeps the answers out of the persisted cache (meta.persist false)', async () => {
    mockGet.mockResolvedValueOnce({ data: VIEW });
    const { qc } = await mount();
    await screen.findByTestId('consultation-answers');
    const q = qc.getQueryCache().find({ queryKey: ['coach', 'consultation', CLIENT] });
    expect(q?.meta).toEqual({ persist: false });
  });
});

describe('copy helpers', () => {
  it('firstNameOf takes the first word, or null', async () => {
    expect(firstNameOf('Sam Rivera')).toBe('Sam');
    expect(firstNameOf('  ')).toBeNull();
    expect(firstNameOf(undefined)).toBeNull();
  });

  it('every failure kind has specific copy (never a bare "Something went wrong")', async () => {
    const kinds = ['offline', 'busy', 'session', 'unexpected'] as const;
    const titles = kinds.map((k) => failureCopy(new ConsultationLoadError(k, null, null, 'x')).title);
    expect(new Set(titles).size).toBe(kinds.length);
    for (const k of kinds) {
      const c = failureCopy(new ConsultationLoadError(k, null, null, 'x'));
      expect(`${c.title} ${c.body}`).not.toMatch(/something went wrong|!|\bwe\b|\bus\b/i);
    }
  });
});
