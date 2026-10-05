/**
 * S-REACH: client detail > Summary carries the entry to the consultation
 * answers, and the card itself flags readiness yes answers before any tap.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockGet = jest.fn();
jest.mock('../../../../services/api', () => ({
  __esModule: true,
  default: { get: (u: string) => mockGet(u) },
}));
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

import { ConsultationSummaryCard, consultationCardLine } from '../ConsultationSummaryCard';
import type { ConsultationView } from '../../../../api/coachConsultationApi';
import type { ThemeColors } from '../../../../theme/ThemeProvider';

const CLIENT = '22222222-2222-4222-8222-222222222222';
const colors = new Proxy({}, { get: () => '#000000' }) as ThemeColors;

const VIEW: ConsultationView = {
  version: 'consult-v1',
  revision: 1,
  revision_cause: 'save',
  submitted_at: null,
  saved_at: '2026-10-01T15:00:00.000Z',
  chapters: [],
  screening: {
    any_yes: true,
    items: [
      { key: 'P1', question: 'q1', answer: 'yes', note: null },
      { key: 'P2', question: 'q2', answer: 'yes', note: null },
    ],
  },
  consent: { version: null, agreed_at: null },
};

async function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return await render(
    <QueryClientProvider client={qc}>
      <ConsultationSummaryCard clientId={CLIENT} clientName="Sam Rivera" colors={colors} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockGet.mockReset();
  mockNavigate.mockReset();
});

it('opens the consultation screen for this client', async () => {
  mockGet.mockResolvedValueOnce({ data: VIEW });
  await mount();
  await screen.findByText(/Yes to 2 readiness questions/);
  await fireEvent.press(screen.getByTestId('summary-consultation-card'));
  expect(mockNavigate).toHaveBeenCalledWith('ClientConsultation', { clientId: CLIENT, clientName: 'Sam Rivera' });
});

it('says "No answers on file yet" on the uniform 404', async () => {
  mockGet.mockRejectedValueOnce(
    Object.assign(new Error('404'), { isAxiosError: true, response: { status: 404, data: { message: 'Consultation not found' } } }),
  );
  await mount();
  expect(await screen.findByText('No answers on file yet')).toBeTruthy();
});

it('consultationCardLine covers every state', async () => {
  expect(consultationCardLine(undefined, 'loading').line).toBe('Loading answers');
  expect(consultationCardLine(undefined, 'error').line).toMatch(/did not load\. Open to try again/);
  expect(consultationCardLine({ kind: 'none' }, 'ready').line).toBe('No answers on file yet');
  const flagged = consultationCardLine({ kind: 'ok', view: VIEW }, 'ready');
  expect(flagged.flagged).toBe(true);
  expect(flagged.line).toMatch(/^In progress, saved .*Yes to 2 readiness questions\.$/);
  const clean = consultationCardLine(
    { kind: 'ok', view: { ...VIEW, submitted_at: '2026-10-02T10:00:00.000Z', screening: { any_yes: false, items: [] } } },
    'ready',
  );
  expect(clean).toEqual({ line: expect.stringMatching(/^Completed /), flagged: false });
});
