/**
 * Sol A-335-1: no client consultation content reaches PostHog touch
 * autocapture. App.tsx mounts PostHogProvider with `autocapture` on, so a
 * touch anywhere sends the touched element's text, accessibility label and
 * testID, plus its ancestors', unless an ancestor carries `ph-no-capture`.
 *
 * Every host element of every state of the coach consultation screen and of
 * the client detail card is touched through the installed SDK's own
 * extractor (real fibers, real ancestor walk), following the onboarding
 * privacy suite (consultationPrivacy.test.tsx A-01). A control proves the
 * harness does capture an element outside the boundary.
 */
import * as path from 'path';
import React from 'react';
import { Text, View } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockGet = jest.fn();
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { get: (u: string) => mockGet(u) },
}));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ semanticColors: new Proxy({}, { get: () => '#000000' }) }),
}));
jest.mock('../../../services/authActions', () => ({ signOut: jest.fn(() => Promise.resolve()) }));
jest.mock('../../../lib/consultation/report', () => ({ reportUnexpected: jest.fn() }));
jest.mock('../../../components/support/SupportEmailFallback', () => ({
  useSupportEmail: () => ({ state: 'idle', open: jest.fn(), copy: jest.fn() }),
  SupportEmailFallback: () => null,
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
}));

import ClientConsultationScreen from '../ClientConsultationScreen';
import { ConsultationSummaryCard } from '../client-detail/ConsultationSummaryCard';
import type { ConsultationView } from '../../../api/coachConsultationApi';
import type { ThemeColors } from '../../../theme/ThemeProvider';

// The installed SDK's own touch extractor (what PostHogProvider calls with
// `autocapture` on). Loaded by path because the package does not export it.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { autocaptureFromTouchEvent } = require(
  path.resolve(__dirname, '../../../../node_modules/posthog-react-native/dist/autocapture.js'),
) as { autocaptureFromTouchEvent: (e: unknown, posthog: { autocapture: jest.Mock }, opts?: unknown) => void };

const CLIENT = '33333333-3333-4333-8333-333333333333';
const NAME = 'Sam Rivera';
const NOTE = 'Left knee surgery 2024';
const MEASURE = '5 ft 6 in (168 cm), 172 lb';

const VIEW: ConsultationView = {
  version: 'consult-v1',
  revision: 2,
  revision_cause: 'complete',
  submitted_at: '2026-10-01T15:00:00.000Z',
  saved_at: '2026-10-01T15:00:00.000Z',
  chapters: [
    {
      key: 'body',
      title: 'Body basics',
      answers: [{ screen: 'B3', question: 'Your height and weight.', answer_label: MEASURE }],
    },
    { key: 'schedule', title: 'Your week', answers: [] },
  ],
  screening: {
    any_yes: true,
    items: [
      { key: 'P1', question: 'Has a doctor said to avoid exercise?', answer: 'no', note: null },
      { key: 'P2', question: 'Has a joint ever stopped you training?', answer: 'yes', note: NOTE },
      { key: 'P3', question: 'Chest pain when active?', answer: null, note: null },
    ],
  },
  consent: { version: 'consult-consent-v3', agreed_at: '2026-10-01T14:00:00.000Z' },
};

type HostInstance = { unstable_fiber: unknown };
type Container = { queryAll: (p: (n: HostInstance) => boolean) => HostInstance[] };

/** Touch every host element through the SDK's extractor; return what reached the SDK. */
function touchEverything(container: Container) {
  const sdk = { autocapture: jest.fn() };
  const hosts = container.queryAll(() => true);
  for (const h of hosts) {
    autocaptureFromTouchEvent({ _targetInst: h.unstable_fiber, nativeEvent: { pageX: 10, pageY: 10 } }, sdk, {});
  }
  return { sdk, touched: hosts.length };
}

function expectNothingCaptured(container: unknown, minHosts: number) {
  const { sdk, touched } = touchEverything(container as Container);
  expect(touched).toBeGreaterThanOrEqual(minHosts);
  expect(sdk.autocapture).not.toHaveBeenCalled();
}

function httpError(status: number | null, data?: unknown) {
  return Object.assign(new Error(`status ${status}`), {
    isAxiosError: true,
    config: { headers: { 'X-Request-Id': 'abcdef12-3456-4789-8abc-def012345678' } },
    response: status === null ? undefined : { status, data, headers: {} },
  });
}

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

async function mountScreen() {
  return render(
    <QueryClientProvider client={client()}>
      <ClientConsultationScreen
        route={{ key: 'k', name: 'ClientConsultation', params: { clientId: CLIENT, clientName: NAME } }}
      />
    </QueryClientProvider>,
  );
}

async function mountCard() {
  const colors = new Proxy({}, { get: () => '#000000' }) as ThemeColors;
  return render(
    <QueryClientProvider client={client()}>
      <ConsultationSummaryCard clientId={CLIENT} clientName={NAME} colors={colors} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockGet.mockReset();
});

describe('A-335-1 analytics exclusion: coach consultation', () => {
  it('control: the harness captures text and labels outside the boundary', async () => {
    const r = await render(
      <View testID="outside">
        <Text accessibilityLabel={NAME}>{NOTE}</Text>
      </View>,
    );
    const { sdk } = touchEverything(r.container as never);
    expect(sdk.autocapture).toHaveBeenCalled();
    expect(JSON.stringify(sdk.autocapture.mock.calls)).toContain(NOTE);
  });

  it('answers: no name, readiness answer, note or measurement reaches the SDK', async () => {
    mockGet.mockResolvedValueOnce({ data: VIEW });
    const r = await mountScreen();
    await screen.findByTestId('consultation-answers');
    // The probe content is on screen, so the touches below do reach it.
    expect(screen.getByText(NAME)).toBeTruthy();
    expect(screen.getByText(NOTE)).toBeTruthy();
    expect(screen.getByText(MEASURE)).toBeTruthy();
    expectNothingCaptured(r.container, 20);
  });

  it('loading, none and every failure state are excluded too', async () => {
    mockGet.mockReturnValueOnce(new Promise(() => undefined));
    const loading = await mountScreen();
    expect(screen.getByTestId('consultation-loading')).toBeTruthy();
    expectNothingCaptured(loading.container, 5);
    loading.unmount();

    mockGet.mockRejectedValueOnce(httpError(404, { message: 'Consultation not found' }));
    const none = await mountScreen();
    await screen.findByTestId('consultation-none');
    expectNothingCaptured(none.container, 5);
    none.unmount();

    const failures: Array<[number | null, string]> = [
      [null, 'offline'],
      [429, 'busy'],
      [401, 'session'],
      [500, 'unexpected'],
    ];
    for (const [status, kind] of failures) {
      mockGet.mockRejectedValueOnce(httpError(status, { message: 'x' }));
      const r = await mountScreen();
      await screen.findByTestId(`consultation-error-${kind}`);
      expectNothingCaptured(r.container, 5);
      r.unmount();
    }
  });

  it('the client detail card, whose label counts yes answers, is excluded in every state', async () => {
    mockGet.mockResolvedValueOnce({ data: VIEW });
    const ready = await mountCard();
    const card = await screen.findByTestId('summary-consultation-card');
    await screen.findByText(/Yes to one readiness question/);
    expect(card.props.accessibilityLabel).toMatch(/Yes to one readiness question/);
    expectNothingCaptured(ready.container, 3);
    ready.unmount();

    mockGet.mockReturnValueOnce(new Promise(() => undefined));
    const loading = await mountCard();
    expect(screen.getByText('Loading answers')).toBeTruthy();
    expectNothingCaptured(loading.container, 3);
    loading.unmount();

    mockGet.mockRejectedValueOnce(httpError(500, { message: 'x' }));
    const failed = await mountCard();
    await screen.findByText(/did not load/);
    expectNothingCaptured(failed.container, 3);
  });
});
