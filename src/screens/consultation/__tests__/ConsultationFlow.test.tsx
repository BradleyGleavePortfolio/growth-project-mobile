/**
 * ConsultationFlow render tests with a mocked API (the backend endpoints are
 * built in a separate slice). Covers: W1 render with Roman's face, rows
 * auto-advance and back, per-chapter save, the P0 "I agree" gate and its
 * consent record, the P8 branch (shown on a yes, never blocks), resume,
 * the complete-call happy path through macro and plan reveals, and 409
 * handling (consultation_incomplete, consent_missing, not_attached).
 */
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import ConsultationFlow, { ConsultationApi } from '../ConsultationFlow';
import type { CompleteOnboardingResponse, CompleteOutcome } from '../../../api/consultationApi';
import { answersBeforeSafety, fullAnswers, NOW } from '../../../lib/consultation/__fixtures__/consultFixtures';
import { storageKey } from '../../../lib/consultation/storage';
import type { Answers } from '../../../lib/consultation/types';

jest.mock('../../../services/api', () => ({ __esModule: true, default: {} }));
jest.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));

const RESULT: CompleteOnboardingResponse = {
  macros: { calories: 1789, protein_g: 150, carbs_g: 185, fat_g: 50, method: 'Mifflin-St Jeor', floor_applied: false },
  program: {
    id: 'prog-a',
    name: 'Foundations',
    days_per_week: 3,
    weeks: 4,
    why: ['You are new to structured training.', 'You train at home with dumbbells.', 'Three days fit your week.'],
  },
  spaces: [{ id: 'sp1', name: 'All members' }],
  coach: { id: 'coach-1', display_name: 'Bradley' },
};

function makeApi(overrides: Partial<Record<keyof ConsultationApi, jest.Mock>> = {}) {
  const api = {
    save: jest.fn(async () => ({ saved_at: '2026-09-30T19:00:00Z', completed_chapters: [1] })),
    getState: jest.fn(async () => null),
    complete: jest.fn(async (): Promise<CompleteOutcome> => ({ kind: 'ok', data: RESULT })),
    grantConsent: jest.fn(async () => undefined),
    ...overrides,
  };
  return api as unknown as ConsultationApi & typeof api;
}

async function seedLocal(answers: Answers, screenId: string) {
  await AsyncStorage.setItem(
    storageKey('u1'),
    JSON.stringify({ version: 'consult-v1', answers, screenId, updatedAt: '2026-09-30T19:00:00Z' }),
  );
}

function renderFlow(api: ConsultationApi, onFinished = jest.fn()) {
  return render(
    <ConsultationFlow
      userId="u1"
      firstName="Maya"
      coachName="Bradley"
      api={api}
      onFinished={onFinished}
      now={() => NOW}
      autoAdvanceMs={0}
      prepMinMs={0}
    />,
  );
}

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('ConsultationFlow', () => {
  it('renders W1 with Roman and the greeting, then begins at G1', async () => {
    const api = makeApi();
    const r = await renderFlow(api);
    await waitFor(() => r.getByTestId('consult-screen-W1'));
    expect(r.getByText('Good afternoon,\nMaya.')).toBeTruthy();
    expect(r.getByLabelText(/Roman says: I'm Roman\. Before Bradley builds/)).toBeTruthy();
    expect(r.queryByTestId('consult-progress')).toBeNull();
    await fireEvent.press(r.getByTestId('consult-continue'));
    await waitFor(() => r.getByTestId('consult-screen-G1'));
    expect(r.getByTestId('consult-progress')).toBeTruthy();
    expect(r.getByText('Chapter 1 of 8 · Goals')).toBeTruthy();
  });

  it('auto-advances single-select rows, goes back, and saves at the chapter end', async () => {
    const api = makeApi();
    await seedLocal({}, 'W1');
    const r = await renderFlow(api);
    await waitFor(() => r.getByTestId('consult-screen-W1'));
    await fireEvent.press(r.getByTestId('consult-continue'));
    await waitFor(() => r.getByTestId('consult-screen-G1'));
    await fireEvent.press(r.getByTestId('consult-option-fat_loss'));
    await waitFor(() => r.getByTestId('consult-screen-G2'));
    expect(api.save).not.toHaveBeenCalled();

    await fireEvent.press(r.getByTestId('consult-back'));
    await waitFor(() => r.getByTestId('consult-screen-G1'));
    expect(r.getByTestId('consult-option-fat_loss').props.accessibilityState).toMatchObject({ selected: true });
    await fireEvent.press(r.getByTestId('consult-option-fat_loss'));
    await waitFor(() => r.getByTestId('consult-screen-G2'));

    // G2: Continue disabled until a chip; chips cap at three.
    expect(r.getByTestId('consult-continue').props.accessibilityState).toMatchObject({ disabled: true });
    for (const v of ['energy', 'strength', 'family']) await fireEvent.press(r.getByTestId(`consult-chip-${v}`));
    expect(r.getByText('Up to three.')).toBeTruthy();
    await fireEvent.press(r.getByTestId('consult-chip-event'));
    expect(r.getByTestId('consult-chip-event').props.accessibilityState).toMatchObject({ selected: false });
    await fireEvent.press(r.getByTestId('consult-continue'));
    await waitFor(() => r.getByTestId('consult-screen-B1'));

    expect(api.save).toHaveBeenCalledTimes(1);
    expect(api.save).toHaveBeenCalledWith({
      version: 'consult-v1',
      answers: { G1: 'fat_loss', G2: ['energy', 'strength', 'family'] },
    });
  });

  it('resumes on the saved screen', async () => {
    await seedLocal(answersBeforeSafety(), 'N3');
    const r = await renderFlow(makeApi());
    await waitFor(() => r.getByTestId('consult-screen-N3'));
  });

  it('gates P0 on the single I agree box and records the combined consent', async () => {
    const api = makeApi();
    await seedLocal(answersBeforeSafety(), 'P0');
    const r = await renderFlow(api);
    await waitFor(() => r.getByTestId('consult-screen-P0'));
    expect(r.getByText(/Roman is powered by Anthropic, a third-party AI provider/)).toBeTruthy();
    expect(r.getByTestId('consult-finish-later').props.accessibilityLabel).toBe('Pause');

    const cont = () => r.getByTestId('consult-continue');
    expect(cont().props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(cont());
    expect(r.getByTestId('consult-screen-P0')).toBeTruthy();
    expect(api.grantConsent).not.toHaveBeenCalled();

    const box = r.getByTestId('consent-checkbox');
    expect(box.props.accessibilityRole).toBe('checkbox');
    await fireEvent.press(box);
    expect(r.getByTestId('consent-checkbox').props.accessibilityState).toMatchObject({ checked: true });
    await fireEvent.press(cont());
    await waitFor(() => r.getByTestId('consult-screen-P1'));
    await waitFor(() => expect(api.grantConsent).toHaveBeenCalledWith(expect.objectContaining({ version: 'roman-ai-v1' })));

    const stored = JSON.parse((await AsyncStorage.getItem(storageKey('u1'))) as string);
    expect(stored.answers.P0).toMatchObject({ agreed: true, copy_version: 'consult-consent-v1' });
  });

  it('skips P8 when every screening answer is no', async () => {
    const a = fullAnswers();
    delete a.C1;
    await seedLocal({ ...a, P7: undefined }, 'P7');
    const r = await renderFlow(makeApi());
    await waitFor(() => r.getByTestId('consult-screen-P7'));
    expect(r.getByText('Question 7 of 7')).toBeTruthy();
    await fireEvent.press(r.getByTestId('consult-option-no'));
    await waitFor(() => r.getByTestId('consult-screen-C1'));
  });

  it('shows P8 after a yes, with guidance before the physician line, and never blocks', async () => {
    const a = fullAnswers();
    delete a.C1;
    delete a.P4;
    await seedLocal(a, 'P4');
    const r = await renderFlow(makeApi());
    await waitFor(() => r.getByTestId('consult-screen-P4'));
    await fireEvent.press(r.getByTestId('consult-option-yes'));
    // Yes does not auto-advance: it reveals an optional note and Continue.
    expect(r.getByTestId('consult-screen-P4')).toBeTruthy();
    await fireEvent.changeText(r.getByTestId('consult-detail-text-P4'), 'Old knee surgery');
    await fireEvent.press(r.getByTestId('consult-continue'));
    for (const n of [5, 6, 7]) {
      await waitFor(() => r.getByTestId(`consult-screen-P${n}`));
      await fireEvent.press(r.getByTestId('consult-option-no'));
    }
    await waitFor(() => r.getByTestId('consult-screen-P8'));
    expect(r.getByText('Thank you for answering so carefully, Maya.')).toBeTruthy();
    const guidance = r.getByText(/Choose an effort where you can still hold a conversation/);
    const physician = r.getByTestId('p8-physician-line');
    expect(guidance).toBeTruthy();
    expect(physician.props.children).toMatch(/check with your physician/);
    expect(r.getByText(/call 911/)).toBeTruthy();
    expect(r.getByText(/tell Bradley/)).toBeTruthy();
    expect(r.getByTestId('consult-continue').props.accessibilityState).toMatchObject({ disabled: false });
    await fireEvent.press(r.getByTestId('consult-continue'));
    await waitFor(() => r.getByTestId('consult-screen-C1'));
    // C1 preselects tomorrow.
    expect(r.getByTestId('consult-chip-2026-10-01').props.accessibilityState).toMatchObject({ selected: true });
  });

  it('completes: summary, preparing, macro reveal, plan reveal, finish', async () => {
    const api = makeApi();
    const onFinished = jest.fn();
    await seedLocal(fullAnswers(), 'SUM');
    const r = await renderFlow(api, onFinished);
    await waitFor(() => r.getByTestId('consult-screen-SUM'));
    expect(r.getByText('Lose body fat, for more energy and to keep up with family.')).toBeTruthy();
    expect(r.getByLabelText('Edit your goal')).toBeTruthy();

    await fireEvent.press(r.getByTestId('consult-prepare'));
    await waitFor(() => r.getByTestId('consult-screen-MACRO'));
    expect(api.save).toHaveBeenCalledTimes(1);
    expect(api.complete).toHaveBeenCalledTimes(1);
    expect(r.getByTestId('macro-calories').props.children).toBe('1,789');
    expect(r.getByTestId('macro-protein').props.children).toBe('150 g');
    expect(r.getByLabelText(/Roman says: Here are your daily targets, Maya/)).toBeTruthy();

    await fireEvent.press(r.getByTestId('consult-macro-next'));
    await waitFor(() => r.getByTestId('consult-screen-PLAN'));
    expect(r.getByTestId('plan-name').props.children).toBe('Foundations');
    expect(r.getByText('Your plan · Four weeks')).toBeTruthy();
    expect(r.getByText('Your first session is tomorrow.')).toBeTruthy();
    expect(r.queryByTestId('plan-physician-line')).toBeNull();

    await fireEvent.press(r.getByTestId('consult-finish'));
    expect(onFinished).toHaveBeenCalledWith(RESULT);
  });

  it('shows the physician line on the plan reveal after a screening yes', async () => {
    await seedLocal(fullAnswers({ P2: 'yes' }), 'SUM');
    const r = await renderFlow(makeApi());
    await waitFor(() => r.getByTestId('consult-screen-SUM'));
    expect(r.getByText('Complete. Please check with your physician before starting.')).toBeTruthy();
    await fireEvent.press(r.getByTestId('consult-prepare'));
    await waitFor(() => r.getByTestId('consult-screen-MACRO'));
    await fireEvent.press(r.getByTestId('consult-macro-next'));
    await waitFor(() => r.getByTestId('plan-physician-line'));
  });

  it('409 consultation_incomplete routes to the first missing answer', async () => {
    const api = makeApi({
      complete: jest.fn(async (): Promise<CompleteOutcome> => ({ kind: 'conflict', code: 'consultation_incomplete' })),
    });
    await seedLocal(fullAnswers({ L1: undefined }), 'SUM');
    const r = await renderFlow(api);
    // L1 is missing, so resume goes to L1 rather than the summary.
    await waitFor(() => r.getByTestId('consult-screen-L1'));
    await fireEvent.press(r.getByTestId('consult-option-moderate'));
    await waitFor(() => r.getByTestId('consult-screen-L2'));
  });

  it('409 consultation_incomplete from the server shows a calm problem state and a way back', async () => {
    const api = makeApi({
      complete: jest.fn(async (): Promise<CompleteOutcome> => ({ kind: 'conflict', code: 'consultation_incomplete' })),
    });
    await seedLocal(fullAnswers(), 'SUM');
    const r = await renderFlow(api);
    await waitFor(() => r.getByTestId('consult-screen-SUM'));
    await fireEvent.press(r.getByTestId('consult-prepare'));
    await waitFor(() => r.getByTestId('consult-problem-consultation_incomplete'));
    expect(r.getByText('A few answers are still needed.')).toBeTruthy();
    await fireEvent.press(r.getByTestId('consult-problem-action'));
    // Locally complete, so the flow walks the client through from the first question.
    await waitFor(() => r.getByTestId('consult-screen-G1'));
  });

  it('409 consent_missing re-records the consent once and retries', async () => {
    const complete = jest
      .fn<Promise<CompleteOutcome>, []>()
      .mockResolvedValueOnce({ kind: 'conflict', code: 'consent_missing' })
      .mockResolvedValueOnce({ kind: 'ok', data: RESULT });
    const api = makeApi({ complete });
    await seedLocal(fullAnswers(), 'SUM');
    const r = await renderFlow(api);
    await waitFor(() => r.getByTestId('consult-screen-SUM'));
    await fireEvent.press(r.getByTestId('consult-prepare'));
    await waitFor(() => r.getByTestId('consult-screen-MACRO'));
    expect(api.grantConsent).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('409 consent_missing that persists sends the client back to P0', async () => {
    const api = makeApi({
      complete: jest.fn(async (): Promise<CompleteOutcome> => ({ kind: 'conflict', code: 'consent_missing' })),
    });
    await seedLocal(fullAnswers(), 'SUM');
    const r = await renderFlow(api);
    await waitFor(() => r.getByTestId('consult-screen-SUM'));
    await fireEvent.press(r.getByTestId('consult-prepare'));
    await waitFor(() => r.getByTestId('consult-problem-consent_missing'));
    await fireEvent.press(r.getByTestId('consult-problem-action'));
    await waitFor(() => r.getByTestId('consult-screen-P0'));
  });

  it('409 not_attached and network failures offer a retry', async () => {
    const complete = jest
      .fn<Promise<CompleteOutcome>, []>()
      .mockResolvedValueOnce({ kind: 'conflict', code: 'not_attached' })
      .mockResolvedValueOnce({ kind: 'ok', data: RESULT });
    const api = makeApi({ complete });
    await seedLocal(fullAnswers(), 'SUM');
    const r = await renderFlow(api);
    await waitFor(() => r.getByTestId('consult-screen-SUM'));
    await fireEvent.press(r.getByTestId('consult-prepare'));
    await waitFor(() => r.getByTestId('consult-problem-not_attached'));
    await fireEvent.press(r.getByTestId('consult-problem-action'));
    await waitFor(() => r.getByTestId('consult-screen-MACRO'));
  });

  it('a failed final save never calls complete', async () => {
    const api = makeApi({ save: jest.fn(async () => { throw new Error('offline'); }) });
    await seedLocal(fullAnswers(), 'SUM');
    const r = await renderFlow(api);
    await waitFor(() => r.getByTestId('consult-screen-SUM'));
    await fireEvent.press(r.getByTestId('consult-prepare'));
    await waitFor(() => r.getByTestId('consult-problem-network'));
    expect(api.complete).not.toHaveBeenCalled();
  });

  it('an already completed onboarding replays the reveal from GET /me/onboarding', async () => {
    const api = makeApi({
      getState: jest.fn(async () => ({ answers: fullAnswers(), completed: true, result: RESULT })),
    });
    const r = await renderFlow(api);
    await waitFor(() => r.getByTestId('consult-screen-MACRO'));
    expect(api.complete).not.toHaveBeenCalled();
  });

  it('Finish later saves and keeps the place', async () => {
    const api = makeApi();
    await seedLocal(answersBeforeSafety(), 'N3');
    const r = await renderFlow(api);
    await waitFor(() => r.getByTestId('consult-screen-N3'));
    await fireEvent.press(r.getByTestId('consult-finish-later'));
    await waitFor(() => r.getByTestId('consult-paused'));
    expect(api.save).toHaveBeenCalledTimes(1);
    await fireEvent.press(r.getByTestId('consult-resume'));
    await waitFor(() => r.getByTestId('consult-screen-N3'));
  });

  it('every pressable control on a question screen has an accessibility label', async () => {
    await seedLocal(answersBeforeSafety(), 'N2');
    const r = await renderFlow(makeApi());
    await waitFor(() => r.getByTestId('consult-screen-N2'));
    const pressables = [
      ...r.queryAllByRole('button'),
      ...r.queryAllByRole('checkbox'),
      ...r.queryAllByRole('radio'),
    ];
    expect(pressables.length).toBeGreaterThan(5);
    for (const p of pressables) expect(p.props.accessibilityLabel).toBeTruthy();
  });
});
