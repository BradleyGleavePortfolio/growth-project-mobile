/**
 * R2b refusals on every coach AI surface (backend #626):
 *   - CoachAiSection (POST /coach/ai/workout-program | meal-plan | client-insight)
 *   - AskAiActionSheet (POST /v1/coach/ai/draft/send-notification, via the gateway)
 *   - WearableInsightPanel, coach (GET /v1/wearables/insights/coach)
 *   - AiTriageCard (GET /community/ai-triage)
 *
 * 403 ai_consent_required -> "This client has not allowed AI help", the coach
 * still sees their data, Try again; never the raw server string, never "you
 * don't have access". 503 ai_egress_blocked -> support path + reference.
 */
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AxiosResponse } from 'axios';

jest.mock('@expo/vector-icons', () => {
  function Icon() {
    return null;
  }
  return { Ionicons: Icon, MaterialIcons: Icon, Feather: Icon };
});

jest.mock('../theme/ThemeProvider', () => {
  const colors = new Proxy({}, { get: (_t, prop) => (typeof prop === 'string' ? `#${prop}` : '#000') });
  const Pass = ({ children }: { children: React.ReactNode }) => children;
  return { __esModule: true, ThemeProvider: Pass, default: Pass, useTheme: () => ({ colors }) };
});

jest.mock('../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../theme/tokens');
  return { useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }) };
});

jest.mock('../services/api', () => {
  const get = jest.fn();
  const post = jest.fn();
  return { __esModule: true, default: { get, post, defaults: { baseURL: 'http://test.local/api' } }, get, post };
});

jest.mock('../services/sentry', () => ({ captureError: jest.fn() }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));

const mockInvokeSendNotification = jest.fn();
jest.mock('../api/coachAiExecutionApi', () => ({
  coachAiExecutionApi: { invokeSendNotification: (...a: unknown[]) => mockInvokeSendNotification(...a) },
}));

jest.mock('../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'coach-1', role: 'coach', firstName: 'Casey' }),
}));

const mockUseCoachInsight = jest.fn();
jest.mock('../hooks/useWearableInsight', () => ({
  useCoachInsight: (args: unknown) => mockUseCoachInsight(args),
  useApproveDraft: () => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false }),
}));

jest.mock('../screens/client/wearables/components/useReduceMotion', () => ({ useReduceMotion: () => true }));

import api from '../services/api';
import CoachAiSection from '../components/coach/CoachAiSection';
import { AskAiActionSheet } from '../components/coach/ai-execution/AskAiActionSheet';
import { WearableInsightPanel } from '../screens/coach/client-detail/WearableInsightPanel';
import AiTriageCard from '../components/community/AiTriageCard';

const mockedGet = api.get as jest.Mock;
const mockedPost = api.post as jest.Mock;

const COACH_MESSAGE = "This client hasn't allowed AI help yet. They can turn it on in their app under Settings > Privacy.";

function httpError(status: number, data: Record<string, unknown>, headers: Record<string, string> = {}) {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    response: { status, data, headers },
    config: { headers: {} },
  });
}
const consentError = () => httpError(403, { statusCode: 403, code: 'ai_consent_required', message: COACH_MESSAGE });
const egressError = () =>
  httpError(503, { statusCode: 503, code: 'ai_egress_blocked', message: 'server message', requestId: 'egress-ref-1234' });

function ok<T>(data: T): AxiosResponse<T> {
  return { data, status: 200, statusText: 'OK', headers: {}, config: { headers: {} } } as AxiosResponse<T>;
}

beforeEach(() => {
  mockedGet.mockReset();
  mockedPost.mockReset();
  mockInvokeSendNotification.mockReset();
  mockUseCoachInsight.mockReset();
});

describe('CoachAiSection — R2b refusals', () => {
  async function openInsightForm() {
    mockedGet.mockResolvedValue(ok({ ready: true, modelUsed: 'm' }));
    const r = await render(
      <NavigationContainer>
        <CoachAiSection clientId="c1" clientName="Jane Doe" />
      </NavigationContainer>,
    );
    const cta = await r.findByTestId('coach-ai-cta-insight');
    await waitFor(() => expect(cta.props.accessibilityState).toEqual(expect.objectContaining({ disabled: false })));
    await fireEvent.press(cta);
    return r;
  }

  // The CTA and the form's submit share the label; the submit is the last one.
  async function pressSubmit(r: Awaited<ReturnType<typeof openInsightForm>>) {
    const matches = r.getAllByLabelText('Generate weekly insight');
    await fireEvent.press(matches[matches.length - 1]);
  }

  it('403 ai_consent_required: specific coach notice, Try again re-sends, no raw server string', async () => {
    mockedPost.mockRejectedValueOnce(consentError());
    const r = await openInsightForm();
    await pressSubmit(r);
    await waitFor(() => expect(r.getByTestId('coach-ai-refusal')).toBeTruthy());
    expect(r.getByTestId('coach-ai-refusal-title').props.children).toBe('AI help is off for this client');
    expect(r.queryByText(COACH_MESSAGE)).toBeNull();
    mockedPost.mockRejectedValueOnce(consentError());
    await fireEvent.press(r.getByTestId('coach-ai-refusal-retry'));
    await waitFor(() => expect(mockedPost).toHaveBeenCalledTimes(2));
  });

  it('503 ai_egress_blocked: support path with the reference', async () => {
    mockedPost.mockRejectedValueOnce(egressError());
    const r = await openInsightForm();
    await pressSubmit(r);
    await waitFor(() => expect(r.getByTestId('coach-ai-refusal-title').props.children).toBe('AI help is paused on our side'));
    expect(r.getByTestId('coach-ai-refusal-reference').props.children).toBe('Reference: egress-r');
    expect(r.getByTestId('coach-ai-refusal-copy-reference')).toBeTruthy();
  });
});

describe('AskAiActionSheet — R2b refusals', () => {
  async function renderSheet() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const r = await render(
      <QueryClientProvider client={qc}>
        <AskAiActionSheet visible clientId="c1" clientName="Jane" onClose={jest.fn()} />
      </QueryClientProvider>,
    );
    await fireEvent.press(r.getByTestId('ask-ai-option-draft.send_notification'));
    await fireEvent.changeText(r.getByTestId('ask-ai-body-input'), 'How did the week go?');
    await fireEvent.changeText(r.getByTestId('ask-ai-prompt-input'), 'Missed two check-ins');
    return r;
  }

  it('403 ai_consent_required: the client has not allowed AI help; Try again re-submits', async () => {
    mockInvokeSendNotification.mockRejectedValueOnce(consentError());
    const r = await renderSheet();
    await fireEvent.press(r.getByTestId('ask-ai-submit'));
    await waitFor(() => expect(r.getByTestId('ask-ai-refusal')).toBeTruthy());
    expect(r.getByTestId('ask-ai-refusal-body').props.children).toContain('You still see their data');
    expect(r.queryByText('Request failed with status code 403')).toBeNull();
    mockInvokeSendNotification.mockResolvedValueOnce({ approval: { draft_id: 'd1' } });
    await fireEvent.press(r.getByTestId('ask-ai-refusal-retry'));
    await waitFor(() => expect(mockInvokeSendNotification).toHaveBeenCalledTimes(2));
  });

  it('503 ai_egress_blocked: paused on our side with the reference', async () => {
    mockInvokeSendNotification.mockRejectedValueOnce(egressError());
    const r = await renderSheet();
    await fireEvent.press(r.getByTestId('ask-ai-submit'));
    await waitFor(() => expect(r.getByTestId('ask-ai-refusal-title').props.children).toBe('AI help is paused on our side'));
    expect(r.getByTestId('ask-ai-refusal-reference')).toBeTruthy();
  });
});

describe('WearableInsightPanel (coach) — R2b refusals', () => {
  function queryError(error: unknown) {
    return { data: undefined, isLoading: false, isError: true, error, refetch: jest.fn(), isRefetching: false };
  }

  it('403 ai_consent_required: client has not allowed AI help, never "no access"', async () => {
    const q = queryError(consentError());
    mockUseCoachInsight.mockReturnValue(q);
    const r = await render(<WearableInsightPanel side="coach" clientId="c1" clientFirstName="Jane" bucket="SLEEP_RECOVERY" />);
    expect(r.getByTestId('coach-insight-refused')).toBeTruthy();
    expect(r.getByTestId('coach-insight-ai-refusal-body').props.children).toContain('AI insights are off for this client');
    expect(r.queryByText("You don't have access to this client's insights.")).toBeNull();
    await fireEvent.press(r.getByTestId('coach-insight-ai-refusal-retry'));
    expect(q.refetch).toHaveBeenCalled();
  });

  it('503 ai_egress_blocked: support path with the reference', async () => {
    mockUseCoachInsight.mockReturnValue(queryError(egressError()));
    const r = await render(<WearableInsightPanel side="coach" clientId="c1" clientFirstName="Jane" bucket="SLEEP_RECOVERY" />);
    expect(r.getByTestId('coach-insight-ai-refusal-title').props.children).toBe('AI help is paused on our side');
  });

  it('a plain 403 (not the AI code) keeps the existing access copy', async () => {
    mockUseCoachInsight.mockReturnValue(queryError(httpError(403, { message: 'Forbidden' })));
    const r = await render(<WearableInsightPanel side="coach" clientId="c1" clientFirstName="Jane" bucket="SLEEP_RECOVERY" />);
    expect(r.queryByTestId('coach-insight-refused')).toBeNull();
    expect(r.getByTestId('coach-insight-error')).toBeTruthy();
  });
});

describe('AiTriageCard — R2b / C-626-4', () => {
  it('503 ai_egress_blocked: support path inside the card', async () => {
    const r = await render(
      <AiTriageCard
        status="error"
        refusal={{ kind: 'egress_blocked', reference: 'tri-ref-0001', serverMessage: null }}
        onRetry={jest.fn()}
        testID="t"
      />,
    );
    expect(r.getByTestId('t-refused')).toBeTruthy();
    expect(r.getByTestId('t-ai-refusal-title').props.children).toBe('AI help is paused on our side');
  });

  it('503 ai_triage_unavailable (no refusal): the explicit "triage unavailable" state with Retry, not an empty inbox', async () => {
    const onRetry = jest.fn();
    const r = await render(<AiTriageCard status="error" refusal={null} onRetry={onRetry} testID="t" />);
    expect(r.getByTestId('t-error')).toBeTruthy();
    expect(r.getByText('Triage is unavailable right now. Your inbox below is unaffected.')).toBeTruthy();
    await fireEvent.press(r.getByTestId('t-retry'));
    expect(onRetry).toHaveBeenCalled();
  });
});
