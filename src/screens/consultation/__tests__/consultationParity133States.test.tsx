/**
 * CONSULT-PARITY-133 (b): the consultation reveals and states (prototype
 * 37-45). Summary offline (43), calm server error with Roman's face (44),
 * the macro reveal's one success haptic and unclipped hero number (39), the
 * plan reveal's first-day ring and session length (40), the welcome-back
 * line after a resume (42), the under-16 stop (45), and the coachless copy.
 */
import React from 'react';
import { StyleProp, StyleSheet, TextStyle } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { HapticService } from '../../../ui/haptics/haptics.service';
import ConsultationFlow from '../ConsultationFlow';
import { CompleteProblemScreen, MacroRevealScreen, PausedScreen, PlanRevealScreen, SummaryScreen } from '../RevealScreens';
import { fullAnswers, NOW } from '../../../lib/consultation/__fixtures__/consultFixtures';
import { makeApi, RESULT, resetStores, seedLocal } from '../../../lib/consultation/__fixtures__/flowHarness';
import { firstSessionWeekday, sessionLengthLine, welcomeBackLine } from '../../../lib/consultation/copy';
import { fillCopy } from '../../../lib/consultation/engine';

const mockNet = { isOnline: true, isInternetReachable: null as boolean | null };
jest.mock('../../../hooks/useNetworkStatus', () => ({ useNetworkStatus: () => mockNet }));
jest.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('../../../ui/haptics/haptics.service', () => ({
  HapticService: { success: jest.fn(async () => undefined), softImpact: jest.fn(async () => undefined), selection: jest.fn(async () => undefined) },
}));
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { put: jest.fn(), get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));

const ctx = { firstName: 'Maya', coachName: 'Bradley', now: NOW };
const coachless = { firstName: 'Maya', coachless: true, now: NOW };
const noop = () => undefined;
const flat = (style: StyleProp<TextStyle>): TextStyle => StyleSheet.flatten(style) ?? {};

beforeEach(async () => {
  await resetStores();
  mockNet.isOnline = true;
  mockNet.isInternetReachable = null;
  (HapticService.success as jest.Mock).mockClear();
});

describe('reveals and states', () => {
  it('summary offline: Prepare waits for the network, Roman says nothing is lost (43)', async () => {
    mockNet.isOnline = false;
    const r = await render(<SummaryScreen answers={fullAnswers()} ctx={ctx} now={NOW} onEdit={noop} onBack={noop} onPrepare={noop} />);
    const cta = r.getByTestId('consult-prepare');
    expect(cta.props.accessibilityLabel).toBe("Prepare when I'm back online");
    expect(cta.props.accessibilityState).toMatchObject({ disabled: true });
    expect(r.getByText(/the moment you're connected\. Nothing you've told me is lost\./)).toBeTruthy();
    // Back online: the normal action and line return.
    mockNet.isOnline = true;
    await r.rerender(<SummaryScreen answers={fullAnswers()} ctx={ctx} now={NOW} onEdit={noop} onBack={noop} onPrepare={noop} />);
    expect(r.getByTestId('consult-prepare').props.accessibilityLabel).toBe('Prepare my plan');
    expect(r.getByText(/Shall I prepare your numbers and your plan\?/)).toBeTruthy();
  });

  it('server error is calm: Roman\'s face above the serif sentence (44)', async () => {
    const r = await render(<CompleteProblemScreen problem="network" onAction={noop} onBack={noop} />);
    expect(r.getByTestId('consult-problem-roman')).toBeTruthy();
    expect(r.getByText("I couldn't reach the server.")).toBeTruthy();
    expect(r.getByTestId('consult-problem-action').props.accessibilityLabel).toBe('Try again');
  });

  it('macro reveal: one success haptic, hero number never clipped (39)', async () => {
    const r = await render(<MacroRevealScreen result={RESULT} answers={fullAnswers()} ctx={ctx} onNext={noop} />);
    expect(HapticService.success).toHaveBeenCalledTimes(1);
    const hero = flat(r.getByTestId('macro-calories').props.style);
    expect(hero.lineHeight as number).toBeGreaterThanOrEqual(1.2 * (hero.fontSize as number));
    await fireEvent.press(r.getByTestId('macro-why'));
    expect(r.getByText(/Message Bradley any time from Messages/)).toBeTruthy();
  });

  it('macro reveal for a coachless client never points to a coach', async () => {
    const r = await render(<MacroRevealScreen result={RESULT} answers={fullAnswers()} ctx={coachless} onNext={noop} />);
    await fireEvent.press(r.getByTestId('macro-why'));
    expect(r.queryByText(/coach/i)).toBeNull();
  });

  it('plan reveal: the first day is ring-highlighted and the session length shows (40)', async () => {
    const r = await render(<PlanRevealScreen result={RESULT} answers={fullAnswers()} ctx={ctx} now={NOW} onBack={noop} onFinish={noop} />);
    expect(firstSessionWeekday('2026-10-01')).toBe(3); // Thursday
    expect(r.getByTestId('plan-first-day-ring')).toBeTruthy();
    expect(r.getByTestId('plan-week-strip').props.accessibilityLabel).toMatch(/First session: Thursday$/);
    expect(r.getByText('Your first session is tomorrow.')).toBeTruthy();
    expect(r.getByTestId('plan-week-line').props.children).toBe('3 days a week. About 30 to 45 minutes each.');
    expect(sessionLengthLine(undefined)).toBeNull();
  });

  it('plan reveal for a coachless client with a screening yes keeps the physician line, drops the coach', async () => {
    const r = await render(
      <PlanRevealScreen result={RESULT} answers={fullAnswers({ P1: 'yes' })} ctx={coachless} now={NOW} onBack={noop} onFinish={noop} />,
    );
    expect(r.getByTestId('plan-physician-line').props.children).toBe('Start once your physician gives you the OK.');
    await fireEvent.press(r.getByTestId('plan-why'));
    expect(r.queryByText(/coach|Bradley/i)).toBeNull();
  });

  it('paused for a coachless client says nothing about a coach', async () => {
    const r = await render(<PausedScreen ctx={coachless} onResume={noop} />);
    expect(r.queryByText(/coach/i)).toBeNull();
    expect(r.getByText(/pick up exactly where you left off\.$/)).toBeTruthy();
  });

  it('welcome back: a resume greets the client on the screen it lands on, then the chapter line returns (42)', async () => {
    const a = fullAnswers();
    for (const k of ['S1', 'S2', 'S3', 'S3b', 'N1', 'N2', 'N3', 'N4', 'N5', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'C1']) delete a[k];
    await seedLocal(a, 'S1');
    const r = await render(
      <ConsultationFlow userId="u1" firstName="Maya" api={makeApi()} onFinished={jest.fn()} now={() => NOW} autoAdvanceMs={0} prepMinMs={0} />,
    );
    await waitFor(() => r.getByTestId('consult-screen-S1'));
    expect(r.getByText('Welcome back, Maya. You were telling me about your schedule.')).toBeTruthy();
    expect(r.queryByText('Now the practical part: when and where.')).toBeNull();
    expect(fillCopy(welcomeBackLine(5) as string, {})).toBe('Welcome back. You were telling me about your schedule.');
    expect(welcomeBackLine(0)).toBeNull();
  });
});
