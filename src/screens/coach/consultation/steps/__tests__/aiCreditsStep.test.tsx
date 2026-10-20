/**
 * CREDITBUILD-143: KC "Your AI credits." (CREDIT-1 Concept 1, S3 look) and
 * the "AI credits" row on K8, against the CoachStepProps contract and in the
 * real flow: the page shows the real pool, picks its last row by whether
 * packs are sold, keeps Roman's N7 line behind its own switch, and appears
 * only when the flow has a head coach's pool.
 */
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CoachStepProps } from '../../types';
import type { CoachCredits } from '../../../../../components/coach/credits/useCoachCredits';

jest.mock('../../../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'coach_kc' }) }));
const mockInviteLink = jest.fn();
jest.mock('../../../../../api/coachSetupApi', () => ({ coachSetupApi: { inviteLink: () => mockInviteLink() } }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('../../../../../storage/mmkv', () => ({ prefsStorage: { set: jest.fn(async () => undefined) } }));
jest.mock('../../../../../services/sentry', () => ({ captureError: jest.fn(), setSentryUser: jest.fn() }));
jest.mock('../../../../../services/api', () => ({ __esModule: true, default: {} }));
const mockFlags = { roman: false };
jest.mock('../../../../../config/featureFlags', () => {
  const actual = jest.requireActual('../../../../../config/featureFlags');
  const featureFlags = { ...actual.featureFlags };
  Object.defineProperty(featureFlags, 'coachRomanNoDailyLimit', { get: () => mockFlags.roman });
  return { ...actual, featureFlags };
});

import KCAICredits from '../KCAICredits';
import K8PracticeReady from '../K8PracticeReady';
import CoachConsultationFlow from '../../CoachConsultationFlow';
import { STEP_COMPONENTS } from '../../registry';
import { draftKey } from '../../../../../lib/coachConsultation/draft';
import type { CoachConsultApi } from '../../../../../lib/coachConsultation/api';
import type { CoachAIBudgetResponse } from '../../../../../api/types/coachAIBudget';

const BUDGET: CoachAIBudgetResponse = {
  period_start: '2026-10-01T00:00:00.000Z',
  period_end: '2026-11-01T00:00:00.000Z',
  base_displayed_cents: 12500,
  pack_displayed_cents: 0,
  total_displayed_cents: 12500,
  used_displayed_cents: 0,
  remaining_displayed_cents: 12500,
  pct_used: 0,
  base_actual_cents: 4000,
  value_multiplier: '3.125',
  actual_used_cents: 0,
  pack_options_cents: [1000, 2500, 9900],
  custom_pack_bounds_cents: { min: 500, max: 50000 },
};
const SOLD: CoachCredits = { budget: BUDGET, packsSold: true };
const NOT_SOLD: CoachCredits = { budget: BUDGET, packsSold: false };

function props(over: Partial<CoachStepProps> = {}): CoachStepProps {
  return {
    answers: {},
    setAnswers: jest.fn(),
    onNext: jest.fn(),
    onBack: jest.fn(),
    onFinishLater: jest.fn(),
    progress: { chapter: 5, position: 2, count: 2, total: 5 },
    eyebrow: 'Your practice · 5 of 5',
    firstName: 'Jordan',
    completing: false,
    credits: SOLD,
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFlags.roman = false;
  mockInviteLink.mockResolvedValue({ code: 'GP-RS7K2Q', url: 'https://app.trygrowthproject.com/join/GP-RS7K2Q' });
});

describe('KC Your AI credits', () => {
  it('shows the real pool on the ink card, the three rows and one Continue', async () => {
    const p = props();
    const ui = await render(<KCAICredits {...p} />);
    expect(ui.getByText('Your AI credits.')).toBeTruthy();
    expect(ui.getByText('Your practice · 5 of 5')).toBeTruthy();
    expect(ui.getByText('AI Usage:')).toBeTruthy();
    expect(ui.getByTestId('credit-card-amount').props.children).toBe('$0 / $125');
    expect(ui.getByText('Renews Nov 1.')).toBeTruthy();
    expect(ui.getByTestId('credit-card').props.accessibilityLabel).toBe('AI Usage: $0 / $125. Renews Nov 1.');
    expect(ui.getByTestId('credit-rows-uses').props.accessibilityLabel).toBe(
      'What uses them. Roman and AI features, for you and your clients.',
    );
    expect(
      ui.getByText('Roman and AI features pause for you and your clients until they renew. Everything else keeps working.'),
    ).toBeTruthy();
    expect(ui.getByText('Adding more')).toBeTruthy();
    expect(ui.getByText('Tap Buy more credits on your Money page. Credit you buy and do not use carries over.')).toBeTruthy();
    expect(ui.queryByText('Where to find them')).toBeNull();
    await fireEvent.press(ui.getByTestId('kc-continue'));
    expect(p.onNext).toHaveBeenCalledTimes(1);
    await fireEvent.press(ui.getByTestId('coach-consult-finish-later'));
    expect(p.onFinishLater).toHaveBeenCalledTimes(1);
  });

  it('says where to find them, and nothing about buying, where packs are not sold', async () => {
    const ui = await render(<KCAICredits {...props({ credits: NOT_SOLD })} />);
    expect(ui.getByText('Where to find them')).toBeTruthy();
    expect(ui.getByText('Always on your Money page.')).toBeTruthy();
    expect(ui.queryByText('Adding more')).toBeNull();
    expect(ui.queryByText(/Buy more credits/)).toBeNull();
  });

  it("keeps Roman's line off until backend #1016 is live, then shows it", async () => {
    const line = 'Ask me as often as you like. Every conversation uses your AI credits.';
    const off = await render(<KCAICredits {...props()} />);
    expect(off.queryByText(line)).toBeNull();
    await off.unmount();
    mockFlags.roman = true;
    const on = await render(<KCAICredits {...props()} />);
    expect(on.getByText(line)).toBeTruthy();
    expect(on.getByLabelText(`Roman says: ${line}`)).toBeTruthy();
  });
});

describe('K8 AI credits row', () => {
  it('adds "AI credits" after the link for a head coach with a pool', async () => {
    const ui = await render(<K8PracticeReady {...props({ progress: null, eyebrow: 'Your practice', answers: { display_name: 'Jordan Reyes' } })} />);
    expect(ui.getByTestId('k8-credits')).toBeTruthy();
    expect(ui.getByText('AI credits')).toBeTruthy();
    expect(ui.getByText('$125 every month, on your Money page.')).toBeTruthy();
  });

  it('leaves it out without a pool', async () => {
    const ui = await render(<K8PracticeReady {...props({ progress: null, credits: null, answers: { display_name: 'Jordan Reyes' } })} />);
    expect(ui.queryByTestId('k8-credits')).toBeNull();
    expect(ui.queryByText('AI credits')).toBeNull();
  });
});

describe('KC in the flow', () => {
  const steps = { ...STEP_COMPONENTS, KC: KCAICredits };
  async function fromK6(credits: CoachCredits | null) {
    await AsyncStorage.setItem(
      draftKey('kc1'),
      JSON.stringify({ v: 1, step: 'K6', updatedAt: '2026-10-13T20:00:00.000Z', answers: { display_name: 'Jordan Reyes', clients_today: 'none' } }),
    );
    const api: jest.Mocked<CoachConsultApi> = {
      load: jest.fn().mockResolvedValue(null),
      saveDraft: jest.fn().mockResolvedValue('saved'),
      complete: jest.fn().mockResolvedValue(undefined),
    };
    const ui = await render(
      <CoachConsultationFlow userId="kc1" user={{ name: 'Jordan Reyes' }} api={api} onComplete={jest.fn()} steps={steps} credits={credits} />,
    );
    await waitFor(() => expect(ui.getByTestId('k6-later')).toBeTruthy());
    await fireEvent.press(ui.getByTestId('k6-later'));
    return { ui, api };
  }

  it('goes K6, KC, K8 for a head coach; back from K8 returns to KC', async () => {
    const { ui } = await fromK6(SOLD);
    expect(ui.getByTestId('coach-step-KC')).toBeTruthy();
    expect(ui.getByText('Your practice · 5 of 5')).toBeTruthy();
    await fireEvent.press(ui.getByTestId('kc-continue'));
    expect(ui.getByTestId('coach-step-K8')).toBeTruthy();
    expect(ui.getByText('$125 every month, on your Money page.')).toBeTruthy();
    await fireEvent.press(ui.getByTestId('coach-consult-topbar-back'));
    expect(ui.getByTestId('coach-step-KC')).toBeTruthy();
  });

  it('pauses on KC through Finish later', async () => {
    const { ui, api } = await fromK6(SOLD);
    await fireEvent.press(ui.getByTestId('coach-consult-finish-later'));
    await waitFor(() => expect(api.saveDraft).toHaveBeenCalledWith(expect.objectContaining({ display_name: 'Jordan Reyes' }), 'KC'));
  });

  it('goes straight from K6 to K8, with no credits row, without a pool', async () => {
    const { ui } = await fromK6(null);
    expect(ui.queryByTestId('coach-step-KC')).toBeNull();
    expect(ui.getByTestId('coach-step-K8')).toBeTruthy();
    expect(ui.queryByTestId('k8-credits')).toBeNull();
  });
});
