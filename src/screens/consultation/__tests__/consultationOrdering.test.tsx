/**
 * Correctness regressions for the PR #310 fix round (Sol audit B-01 to B-04,
 * C-02). The audit's probes are re-run against the fixed flow.
 *
 *   B-01  a pending auto-advance never survives an answer change
 *   B-02  chapter saves are serialized and coalesced; the final save drains
 *         the queue before complete, so an older write can never land last
 *   B-03  resume reconciles the local draft with the server by revision and
 *         timestamp (the pure rules are in lib/consultation/__tests__)
 *   B-04  the frame consumes safe-area insets
 *   C-02  a delayed load for a previous user never reaches the new user's flow
 */
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native';
import ConsultationFlow, { ConsultationApi } from '../ConsultationFlow';
import type { SaveConsultationRequest, SaveConsultationResponse } from '../../../api/consultationApi';
import { answersBeforeSafety, fullAnswers, NOW } from '../../../lib/consultation/__fixtures__/consultFixtures';
import { makeApi, RESULT, resetStores, seedLocal } from '../../../lib/consultation/__fixtures__/flowHarness';
import { readLocalState } from '../../../lib/consultation/storage';
import type { Answers } from '../../../lib/consultation/types';

jest.mock('../../../services/api', () => ({ __esModule: true, default: {} }));
jest.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));

function flow(api: ConsultationApi, props: Partial<React.ComponentProps<typeof ConsultationFlow>> = {}) {
  return (
    <ConsultationFlow
      userId="u1"
      firstName="Maya"
      coachName="Bradley"
      api={api}
      onFinished={jest.fn()}
      now={() => NOW}
      autoAdvanceMs={0}
      prepMinMs={0}
      {...props}
    />
  );
}
const renderFlow = (api: ConsultationApi, props: Partial<React.ComponentProps<typeof ConsultationFlow>> = {}) =>
  render(flow(api, props));

const tick = (ms = 0) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

beforeEach(async () => {
  await resetStores();
});

// ── B-01 ─────────────────────────────────────────────────────────────────────

describe('B-01 auto-advance timer', () => {
  it('audit probe: No then Yes inside the delay stays on T3 with the injury detail required', async () => {
    await seedLocal(answersBeforeSafety(), 'T3');
    const r = await renderFlow(makeApi(), { autoAdvanceMs: 200 });
    await waitFor(() => r.getByTestId('consult-screen-T3'));
    await fireEvent.press(r.getByTestId('consult-option-no'));
    await fireEvent.press(r.getByTestId('consult-option-yes'));
    expect(r.getByTestId('consult-continue').props.accessibilityState.disabled).toBe(true);
    await tick(260);
    expect(r.getByTestId('consult-screen-T3')).toBeTruthy();
    expect(r.queryByTestId('consult-screen-T4')).toBeNull();
    // The required area is still asked for; choosing one allows Continue.
    await fireEvent.press(r.getByTestId('consult-detail-chip-knee'));
    await fireEvent.press(r.getByTestId('consult-continue'));
    await waitFor(() => r.getByTestId('consult-screen-T4'));
  });

  it('changing a single select inside the delay advances once, with the last choice', async () => {
    await seedLocal(answersBeforeSafety(), 'L1');
    const r = await renderFlow(makeApi(), { autoAdvanceMs: 200 });
    await waitFor(() => r.getByTestId('consult-screen-L1'));
    await fireEvent.press(r.getByTestId('consult-option-light'));
    await fireEvent.press(r.getByTestId('consult-option-active'));
    await tick(260);
    await waitFor(() => r.getByTestId('consult-screen-L2'));
    const stored = await readLocalState('u1', NOW);
    expect(stored?.answers.L1).toBe('active');
    expect(stored?.screenId).toBe('L2');
  });

  it('Back or Pause during the delay cancels the advance', async () => {
    await seedLocal(answersBeforeSafety(), 'L1');
    const r = await renderFlow(makeApi(), { autoAdvanceMs: 200 });
    await waitFor(() => r.getByTestId('consult-screen-L1'));
    await fireEvent.press(r.getByTestId('consult-option-light'));
    await fireEvent.press(r.getByTestId('consult-back'));
    await waitFor(() => r.getByTestId('consult-screen-B4'));
    await tick(260);
    expect(r.getByTestId('consult-screen-B4')).toBeTruthy();

    await fireEvent.press(r.getByTestId('consult-continue'));
    await waitFor(() => r.getByTestId('consult-screen-L1'));
    await fireEvent.press(r.getByTestId('consult-option-moderate'));
    await fireEvent.press(r.getByTestId('consult-finish-later'));
    await waitFor(() => r.getByTestId('consult-paused'));
    await tick(260);
    expect(r.getByTestId('consult-paused')).toBeTruthy();
  });
});

// ── B-02 ─────────────────────────────────────────────────────────────────────

type SaveFn = (body: SaveConsultationRequest) => Promise<SaveConsultationResponse>;

describe('B-02 ordered, serialized saves', () => {
  it('audit probe: an old chapter save still in flight cannot land after the final save and completion', async () => {
    let serverSnapshot: Answers | null = null;
    const order: string[] = [];
    let release!: () => void;
    const save = jest.fn<ReturnType<SaveFn>, Parameters<SaveFn>>();
    save.mockImplementationOnce(
      (body) =>
        new Promise((resolve) => {
          release = () => {
            serverSnapshot = body.answers;
            order.push(`save:${String(body.answers.G1)}`);
            resolve({ saved_at: '2026-09-30T19:00:00Z', completed_chapters: [], revision: 1 });
          };
        }),
    );
    save.mockImplementation(async (body) => {
      serverSnapshot = body.answers;
      order.push(`save:${String(body.answers.G1)}`);
      return { saved_at: '2026-09-30T19:05:00Z', completed_chapters: [], revision: 2 };
    });
    const complete = jest.fn(async () => {
      order.push('complete');
      return { kind: 'ok' as const, data: RESULT };
    });
    const api = makeApi({ save, complete });
    await seedLocal(fullAnswers(), 'C1');
    const r = await renderFlow(api);
    await waitFor(() => r.getByTestId('consult-screen-C1'));
    await fireEvent.press(r.getByTestId('consult-continue')); // chapter-8 save, held in flight
    await waitFor(() => r.getByTestId('consult-screen-SUM'));
    await fireEvent.press(r.getByTestId('summary-edit-1'));
    await waitFor(() => r.getByTestId('consult-screen-G1'));
    await fireEvent.press(r.getByTestId('consult-option-muscle_gain'));
    await waitFor(() => r.getByTestId('consult-screen-G2'));
    await fireEvent.press(r.getByTestId('consult-continue')); // chapter-1 save, queued (coalesced)
    await waitFor(() => r.getByTestId('consult-screen-SUM'));
    await fireEvent.press(r.getByTestId('consult-prepare'));
    await tick(10);
    // Completion waits for the queue: nothing has completed while the old save is open.
    expect(complete).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => { release(); });
    await waitFor(() => r.getByTestId('consult-screen-MACRO'));
    expect(serverSnapshot!.G1).toBe('muscle_gain');
    // P0 alone (consent first), the old set, one coalesced newer save, then
    // complete. Never old-after-new.
    expect(order).toEqual(['save:undefined', 'save:fat_loss', 'save:muscle_gain', 'complete']);
  });

  it('saves never overlap: at most one request is in flight', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const save = jest.fn(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight -= 1;
      return { saved_at: '2026-09-30T19:00:00Z', completed_chapters: [] };
    });
    const api = makeApi({ save });
    await seedLocal(answersBeforeSafety(), 'N3');
    const r = await renderFlow(api);
    await waitFor(() => r.getByTestId('consult-screen-N3'));
    await fireEvent.press(r.getByTestId('consult-finish-later'));
    await fireEvent.press(r.getByTestId('consult-resume'));
    await fireEvent.press(r.getByTestId('consult-finish-later'));
    await fireEvent.press(r.getByTestId('consult-resume'));
    await fireEvent.press(r.getByTestId('consult-finish-later'));
    await tick(120);
    expect(maxInFlight).toBe(1);
    // Robust to timing (coalescing may merge taps): the first PUT carries P0
    // alone (consent first, backend #607), P0-only PUTs happen once, and the
    // full-answer PUTs never exceed the three Pause taps.
    const calls = save.mock.calls as unknown as Array<[{ answers: Record<string, unknown> }]>;
    const isP0Only = (c: [{ answers: Record<string, unknown> }]) =>
      Object.keys(c[0].answers).length === 1 && 'P0' in c[0].answers;
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(isP0Only(calls[0])).toBe(true);
    expect(calls.filter(isP0Only)).toHaveLength(1);
    const full = calls.filter((c) => !isP0Only(c));
    expect(full.length).toBeGreaterThanOrEqual(1);
    expect(full.length).toBeLessThanOrEqual(3);
  });

  it('a successful save marks the draft clean with the server revision; a later edit marks it dirty', async () => {
    const api = makeApi({ save: jest.fn(async () => ({ saved_at: '2026-09-30T19:10:00Z', completed_chapters: [], revision: 7 })) });
    await seedLocal(answersBeforeSafety(), 'N3');
    const r = await renderFlow(api);
    await waitFor(() => r.getByTestId('consult-screen-N3'));
    await fireEvent.press(r.getByTestId('consult-finish-later'));
    await tick(10);
    let stored = await readLocalState('u1', NOW);
    expect(stored?.dirty).toBe(false);
    expect(stored?.synced).toEqual({ saved_at: '2026-09-30T19:10:00Z', revision: 7 });
    await fireEvent.press(r.getByTestId('consult-resume'));
    await fireEvent.press(r.getByTestId('consult-chip-4'));
    await tick(10);
    stored = await readLocalState('u1', NOW);
    expect(stored?.dirty).toBe(true);
  });
});

// ── B-03 ─────────────────────────────────────────────────────────────────────

describe('B-03 resume reconciliation', () => {
  it('audit probe: a newer server schedule beats an older clean local draft', async () => {
    const api = makeApi({
      getState: jest.fn(async () => ({ answers: fullAnswers({ S1: '4' }), completed: false, saved_at: '2026-09-30T20:00:00Z', revision: 5 })),
    });
    await seedLocal(fullAnswers({ S1: '2' }), 'S1', { dirty: false, synced: { saved_at: '2026-09-29T19:00:00Z', revision: 2 } });
    const r = await renderFlow(api);
    await waitFor(() => r.getByTestId('consult-screen-S1'));
    expect(r.getByTestId('consult-chip-4').props.accessibilityState.selected).toBe(true);
    expect(r.getByTestId('consult-chip-2').props.accessibilityState.selected).toBe(false);
  });

  it('audit probe: an older unsynced local draft loses to a newer server save from another device', async () => {
    const api = makeApi({
      getState: jest.fn(async () => ({ answers: fullAnswers({ S1: '4' }), completed: false, saved_at: '2026-09-30T20:00:00Z' })),
    });
    await seedLocal(fullAnswers({ S1: '2' }), 'S1', { dirty: true, editedAt: '2026-09-29T19:00:00Z' });
    const r = await renderFlow(api);
    await waitFor(() => r.getByTestId('consult-screen-S1'));
    expect(r.getByTestId('consult-chip-4').props.accessibilityState.selected).toBe(true);
    // The stale local set is not sent back over the newer server copy.
    expect(api.save).not.toHaveBeenCalled();
  });

  it('newer unsynced local edits survive resume and are the next save', async () => {
    const api = makeApi({
      getState: jest.fn(async () => ({ answers: fullAnswers({ S1: '4' }), completed: false, saved_at: '2026-09-30T18:00:00Z', revision: 3 })),
    });
    await seedLocal(fullAnswers({ S1: '2' }), 'S1', { dirty: true, editedAt: '2026-09-30T19:30:00Z', synced: { saved_at: '2026-09-30T18:00:00Z', revision: 3 } });
    const r = await renderFlow(api);
    await waitFor(() => r.getByTestId('consult-screen-S1'));
    expect(r.getByTestId('consult-chip-2').props.accessibilityState.selected).toBe(true);
    await fireEvent.press(r.getByTestId('consult-finish-later'));
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
    expect(api.save.mock.calls[0][0].answers.S1).toBe('2');
  });
});

// ── B-04 ─────────────────────────────────────────────────────────────────────

describe('B-04 safe-area insets', () => {
  const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };

  it('the frame pads the notch and the home indicator', async () => {
    await seedLocal(answersBeforeSafety(), 'G2');
    const r = await render(<SafeAreaProvider initialMetrics={metrics}>{flow(makeApi())}</SafeAreaProvider>);
    await waitFor(() => r.getByTestId('consult-screen-G2'));
    const root = StyleSheet.flatten(r.getByTestId('consult-screen-G2').props.style);
    expect(root.paddingTop).toBe(47);
    const footer = StyleSheet.flatten(r.getByTestId('consult-footer').props.style);
    expect(footer.paddingBottom).toBeGreaterThanOrEqual(34 + 16);
    // Back sits below the inset, inside the padded frame, not under the status bar.
    expect(r.getByTestId('consult-back')).toBeTruthy();
  });

  it('the summary frame pads too', async () => {
    await seedLocal(fullAnswers(), 'SUM');
    const r = await render(<SafeAreaProvider initialMetrics={metrics}>{flow(makeApi())}</SafeAreaProvider>);
    await waitFor(() => r.getByTestId('consult-screen-SUM'));
    expect(StyleSheet.flatten(r.getByTestId('consult-screen-SUM').props.style).paddingTop).toBe(47);
  });

  it('no provider means no inset (no double padding under a parent safe area)', async () => {
    await seedLocal(fullAnswers(), 'SUM');
    const plain = await renderFlow(makeApi());
    await waitFor(() => plain.getByTestId('consult-screen-SUM'));
    expect(StyleSheet.flatten(plain.getByTestId('consult-screen-SUM').props.style).paddingTop).toBe(0);
  });
});

// ── C-02 ─────────────────────────────────────────────────────────────────────

describe('C-02 identity fencing', () => {
  it('audit probe: a delayed load for the previous user never overwrites or is submitted by the new user', async () => {
    const api = makeApi();
    let oldResponse!: (v: unknown) => void;
    api.getState.mockImplementationOnce(() => new Promise((resolve) => { oldResponse = resolve; }) as never);
    api.getState.mockResolvedValue({ completed: false, answers: fullAnswers({ G1: 'maintenance' }) } as never);
    const r = await renderFlow(api);
    await waitFor(() => expect(api.getState).toHaveBeenCalledTimes(1));
    await r.rerender(flow(api, { userId: 'u2' }));
    await waitFor(() => r.getByTestId('consult-screen-SUM'));
    expect(r.getByText(/Maintain and feel better/)).toBeTruthy();
    await act(async () => {
      oldResponse({ completed: false, answers: fullAnswers({ P4: 'yes', P4_note: 'Private health note belonging to u1' }) });
    });
    expect(r.getByText(/Maintain and feel better/)).toBeTruthy();
    await fireEvent.press(r.getByTestId('consult-prepare'));
    await waitFor(() => expect(api.save).toHaveBeenCalled());
    expect(api.save.mock.calls[0][0].answers.P4_note).toBeUndefined();
  });
});
