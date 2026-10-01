/**
 * ConsultationFlow render tests with a mocked API (the backend endpoints are
 * built in a separate slice). Covers: W1 render with Roman's face, rows
 * auto-advance and back, per-chapter save, the P0 two-box agreement (D2)
 * and its intake record, the P8 branch (shown on a yes, never blocks), resume,
 * the complete-call happy path through macro and plan reveals, and 409
 * handling (consultation_incomplete, consent_missing, not_attached).
 */
import React from 'react';
import { Alert, Linking } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import ConsultationFlow, { ConsultationApi } from '../ConsultationFlow';
import type { CompleteOutcome } from '../../../api/consultationApi';
import { answersBeforeSafety, fullAnswers, NOW } from '../../../lib/consultation/__fixtures__/consultFixtures';
import { makeApi, RESULT, resetStores, seedLocal } from '../../../lib/consultation/__fixtures__/flowHarness';
import { readLocalState } from '../../../lib/consultation/storage';
import { CONSENT_COPY_SHA256, consentCopyText } from '../../../lib/consultation/copy';

jest.mock('../../../services/api', () => ({ __esModule: true, default: {} }));
jest.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
const mockStartClientTutorial = jest.fn((..._args: unknown[]) => true);
jest.mock('../../../tutorial/tutorialStore', () => ({
  startClientTutorial: (...args: unknown[]) => mockStartClientTutorial(...args),
}));

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
  mockStartClientTutorial.mockClear();
  await resetStores();
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
    // The single agreement comes straight after the welcome.
    await waitFor(() => r.getByTestId('consult-screen-P0'));
    await fireEvent.press(r.getByTestId('consent-checkbox'));
    await fireEvent.press(r.getByTestId('consult-continue'));
    await waitFor(() => r.getByTestId('consult-screen-G1'));
    expect(r.getByTestId('consult-progress')).toBeTruthy();
    expect(r.getByText('Chapter 1 of 8 · Goals')).toBeTruthy();
  });

  it('auto-advances single-select rows, goes back, and saves at the chapter end', async () => {
    const api = makeApi();
    const P0 = fullAnswers().P0;
    await seedLocal({ P0 }, 'G1');
    const r = await renderFlow(api);
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

    // Consent first (backend #607): P0 on its own, then the chapter.
    expect(api.save).toHaveBeenCalledTimes(2);
    expect(api.save).toHaveBeenNthCalledWith(1, { version: 'consult-v1', answers: { P0 } });
    const second = api.save.mock.calls[1][0];
    expect(second.version).toBe('consult-v1');
    // The answers given, plus explicit clears (null) for closed details and
    // hidden screens (Opus B-06); nothing else.
    const given = Object.fromEntries(Object.entries(second.answers).filter(([, v]) => v !== null));
    expect(given).toEqual({ P0, G1: 'fat_loss', G2: ['energy', 'strength', 'family'] });
    expect(second.answers).toHaveProperty('G2_other', null);
  });

  it('resumes on the saved screen', async () => {
    await seedLocal(answersBeforeSafety(), 'N3');
    const r = await renderFlow(makeApi());
    await waitFor(() => r.getByTestId('consult-screen-N3'));
  });

  it('P0 shows the D2 copy with two boxes; box 1 gates Continue and is recorded by the intake first', async () => {
    const api = makeApi();
    await seedLocal({}, 'P0');
    const r = await renderFlow(api);
    await waitFor(() => r.getByTestId('consult-screen-P0'));
    expect(r.getByText('Before we start')).toBeTruthy();
    expect(r.getByText(/Roman, the assistant in this app, is powered by Anthropic, a third-party AI provider/)).toBeTruthy();
    expect(r.getByText(/If you joined through a clinic, the clinic does not see it\./)).toBeTruthy();
    expect(r.getByTestId('consent-footer').props.children).toBe(
      "Nothing is sent until you continue. You can change the optional choice at any time in Settings > Privacy. Roman's guided tour works either way.",
    );
    // Chapter 0: no progress bar and no Finish later before the agreement.
    expect(r.queryByTestId('consult-finish-later')).toBeNull();
    expect(r.queryByTestId('consult-progress')).toBeNull();

    const cont = () => r.getByTestId('consult-continue');
    expect(cont().props.accessibilityState).toMatchObject({ disabled: true });
    // Box 2 alone never unlocks Continue; it is unticked by default.
    expect(r.getByTestId('consent-ai-checkbox').props.accessibilityState).toMatchObject({ checked: false });
    await fireEvent.press(r.getByTestId('consent-ai-checkbox'));
    expect(cont().props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(r.getByTestId('consent-ai-checkbox'));
    await fireEvent.press(cont());
    expect(r.getByTestId('consult-screen-P0')).toBeTruthy();
    expect(api.save).not.toHaveBeenCalled();

    const box = r.getByTestId('consent-checkbox');
    expect(box.props.accessibilityRole).toBe('checkbox');
    await fireEvent.press(box);
    expect(r.getByTestId('consent-checkbox').props.accessibilityState).toMatchObject({ checked: true });
    await fireEvent.press(cont());
    await waitFor(() => r.getByTestId('consult-screen-G1'));
    // The first server write carries only the agreement, with v2 and the pinned hash.
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
    expect(Object.keys(api.save.mock.calls[0][0].answers)).toEqual(['P0']);
    expect(api.save.mock.calls[0][0].answers.P0).toMatchObject({
      agreed: true,
      copy_version: 'consult-consent-v2',
      text_sha256: CONSENT_COPY_SHA256,
    });
    // Box 2 was left unticked: nothing goes to the AI consent ledger.
    expect(api.grantRomanConsent).not.toHaveBeenCalled();

    const stored = await readLocalState('u1', NOW);
    expect(stored?.answers.P0).toMatchObject({ agreed: true, copy_version: 'consult-consent-v2' });
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
    expect(api.save).toHaveBeenCalledTimes(2); // P0 alone, then the full set
    expect(Object.keys(api.save.mock.calls[0][0].answers)).toEqual(['P0']);
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
    // The tutorial (#309) starts only after the plan reveal's finish, never earlier.
    expect(mockStartClientTutorial).not.toHaveBeenCalled();

    await fireEvent.press(r.getByTestId('consult-finish'));
    expect(mockStartClientTutorial).toHaveBeenCalledTimes(1);
    expect(mockStartClientTutorial).toHaveBeenCalledWith(RESULT);
    expect(onFinished).toHaveBeenCalledWith(RESULT);
  });

  it('a tutorial start failure never blocks finishing the consultation', async () => {
    mockStartClientTutorial.mockImplementationOnce(() => {
      throw new Error('tutorial store unavailable');
    });
    const api = makeApi();
    const onFinished = jest.fn();
    await seedLocal(fullAnswers(), 'SUM');
    const r = await renderFlow(api, onFinished);
    await waitFor(() => r.getByTestId('consult-screen-SUM'));
    await fireEvent.press(r.getByTestId('consult-prepare'));
    await waitFor(() => r.getByTestId('consult-screen-MACRO'));
    await fireEvent.press(r.getByTestId('consult-macro-next'));
    await waitFor(() => r.getByTestId('consult-screen-PLAN'));
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

  it('409 consent_missing resends the saved P0 alone and retries once, never ticking a box', async () => {
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
    expect(api.grantRomanConsent).not.toHaveBeenCalled();
    // Each attempt sends P0 on its own first, then the full set.
    expect(api.save).toHaveBeenCalledTimes(4);
    expect(Object.keys(api.save.mock.calls[0][0].answers)).toEqual(['P0']);
    expect(Object.keys(api.save.mock.calls[2][0].answers)).toEqual(['P0']);
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

  it('Pause / Finish later saves and keeps the place', async () => {
    const api = makeApi();
    await seedLocal(answersBeforeSafety(), 'N3');
    const r = await renderFlow(api);
    await waitFor(() => r.getByTestId('consult-screen-N3'));
    await fireEvent.press(r.getByTestId('consult-finish-later'));
    await waitFor(() => r.getByTestId('consult-paused'));
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(2)); // P0 alone, then the rest
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

// ── Opus fix round (#310 @ 3606b63): B-06, C-2, C-4, C-6 ─────────────────────

const P0_CURRENT = fullAnswers().P0;
const synced = { dirty: true, editedAt: '2026-09-30T19:00:00Z', synced: { saved_at: '2026-09-30T18:00:00Z', revision: 1 } };
const serverWithConsent = () =>
  jest.fn(async () => ({ answers: { P0: P0_CURRENT }, completed: false, consent_recorded: true, saved_at: '2026-09-30T18:00:00Z', revision: 1 }));
type SaveMock = jest.Mock & { mock: { calls: Array<[{ answers: Record<string, unknown> }]> } };
const lastBody = (save: jest.Mock) => {
  const calls = (save as SaveMock).mock.calls;
  return calls[calls.length - 1][0].answers;
};

describe('C-8 Privacy Policy link on P0', () => {
  it('renders below the two boxes, opens the public Privacy Policy, and sends nothing', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const api = makeApi();
    await seedLocal({}, 'P0');
    const r = await renderFlow(api);
    await waitFor(() => r.getByTestId('consult-screen-P0'));
    const link = r.getByTestId('consent-privacy-link');
    expect(link.props.accessibilityRole).toBe('link');
    expect(link.props.accessibilityLabel).toBe('Privacy Policy');
    // Order on screen: box 1, box 2, footer, then the link.
    const tree = JSON.stringify(r.toJSON());
    const at = (id: string) => tree.indexOf(`"testID":"${id}"`);
    expect(at('consent-privacy-link')).toBeGreaterThan(-1);
    expect(at('consent-checkbox')).toBeLessThan(at('consent-ai-checkbox'));
    expect(at('consent-ai-checkbox')).toBeLessThan(at('consent-privacy-link'));
    expect(at('consent-footer')).toBeLessThan(at('consent-privacy-link'));
    await fireEvent.press(link);
    expect(open).toHaveBeenCalledWith('https://app.trygrowthproject.com/privacy');
    expect(r.getByTestId('consult-screen-P0')).toBeTruthy();
    expect(api.save).not.toHaveBeenCalled();
    expect(api.grantRomanConsent).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it('a link that cannot open shows a calm message', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no browser'));
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await seedLocal({}, 'P0');
    const r = await renderFlow(makeApi());
    await waitFor(() => r.getByTestId('consult-screen-P0'));
    await fireEvent.press(r.getByTestId('consent-privacy-link'));
    await waitFor(() => expect(alert).toHaveBeenCalledWith('Privacy Policy unavailable', expect.stringMatching(/try again later\.$/)));
    open.mockRestore();
    alert.mockRestore();
  });

  it('the link is not part of the consent text or its hash', () => {
    expect(consentCopyText()).not.toMatch(/Privacy Policy/);
  });
});

describe('B-06 cleared details are cleared on the server (null), not kept', () => {
  it('deselecting "other" on G2 sends G2_other: null with the chapter save', async () => {
    const api = makeApi({ getState: serverWithConsent() });
    await seedLocal({ P0: P0_CURRENT, G1: 'fat_loss', G2: ['energy', 'other'], G2_other: 'Run a 10k' }, 'G2', synced);
    const r = await renderFlow(api);
    await waitFor(() => r.getByTestId('consult-screen-G2'));
    await fireEvent.press(r.getByTestId('consult-chip-other'));
    await fireEvent.press(r.getByTestId('consult-continue'));
    await waitFor(() => expect(api.save).toHaveBeenCalled());
    const body = lastBody(api.save);
    expect(body.G2).toEqual(['energy']);
    expect(body).toHaveProperty('G2_other', null);
  });

  it('emptying the T3 note while T3 is still yes sends T3_note: null', async () => {
    const a = answersBeforeSafety();
    Object.assign(a, { T3: 'yes', T3_areas: ['knee'], T3_note: 'Old surgery on the left knee' });
    const api = makeApi({ getState: serverWithConsent() });
    await seedLocal(a, 'T3', synced);
    const r = await renderFlow(api);
    await waitFor(() => r.getByTestId('consult-screen-T3'));
    await fireEvent.changeText(r.getByTestId('consult-detail-text-T3'), '');
    await fireEvent.press(r.getByTestId('consult-finish-later'));
    await waitFor(() => expect(api.save).toHaveBeenCalled());
    const body = lastBody(api.save);
    expect(body.T3).toBe('yes');
    expect(body.T3_areas).toEqual(['knee']);
    expect(body).toHaveProperty('T3_note', null);
    expect(JSON.stringify(body)).not.toContain('Old surgery');
  });
});

describe('C-2 save rejections get accurate copy', () => {
  it('409 completion_in_progress on the final save shows "already being prepared", not a connection problem', async () => {
    const save = jest.fn(async () => {
      throw Object.assign(new Error('409'), { response: { status: 409, data: { code: 'completion_in_progress' } } });
    });
    const api = makeApi({ save, getState: serverWithConsent() });
    await seedLocal(fullAnswers(), 'SUM', synced);
    const r = await renderFlow(api);
    await waitFor(() => r.getByTestId('consult-screen-SUM'));
    await fireEvent.press(r.getByTestId('consult-prepare'));
    await waitFor(() => r.getByTestId('consult-problem-completion_in_progress'));
    expect(api.complete).not.toHaveBeenCalled();
  });

  it('400 invalid_answers on the final save asks the client to review, and goes back to the summary', async () => {
    const save = jest.fn(async () => {
      throw Object.assign(new Error('400'), { response: { status: 400, data: { code: 'invalid_answers' } } });
    });
    const api = makeApi({ save, getState: serverWithConsent() });
    await seedLocal(fullAnswers(), 'SUM', synced);
    const r = await renderFlow(api);
    await waitFor(() => r.getByTestId('consult-screen-SUM'));
    await fireEvent.press(r.getByTestId('consult-prepare'));
    await waitFor(() => r.getByTestId('consult-problem-invalid_answers'));
    expect(r.queryByText(/check your connection|couldn't reach/i)).toBeNull();
    await fireEvent.press(r.getByTestId('consult-problem-action'));
    await waitFor(() => r.getByTestId('consult-screen-SUM'));
  });
});

describe('C-4 macro display mode', () => {
  it('simple mode (never-trackers, week one) shows calories and protein only', async () => {
    const api = makeApi({
      complete: jest.fn(async (): Promise<CompleteOutcome> => ({
        kind: 'ok',
        data: { ...RESULT, macro_display_mode: 'simple', simple_until: '2026-10-07' },
      })),
    });
    await seedLocal(fullAnswers(), 'SUM');
    const r = await renderFlow(api);
    await waitFor(() => r.getByTestId('consult-screen-SUM'));
    await fireEvent.press(r.getByTestId('consult-prepare'));
    await waitFor(() => r.getByTestId('consult-screen-MACRO'));
    expect(r.getByTestId('macro-calories')).toBeTruthy();
    expect(r.getByTestId('macro-protein')).toBeTruthy();
    expect(r.queryByTestId('macro-carbs')).toBeNull();
    expect(r.queryByTestId('macro-fat')).toBeNull();
    await fireEvent.press(r.getByTestId('macro-why'));
    expect(r.getByTestId('macro-simple-note')).toBeTruthy();
  });

  it('full mode (and an older server without the field) shows all four', async () => {
    const api = makeApi({
      complete: jest.fn(async (): Promise<CompleteOutcome> => ({ kind: 'ok', data: { ...RESULT, macro_display_mode: 'full' } })),
    });
    await seedLocal(fullAnswers(), 'SUM');
    const r = await renderFlow(api);
    await waitFor(() => r.getByTestId('consult-screen-SUM'));
    await fireEvent.press(r.getByTestId('consult-prepare'));
    await waitFor(() => r.getByTestId('consult-screen-MACRO'));
    expect(r.getByTestId('macro-carbs').props.children).toBe('185 g');
    expect(r.getByTestId('macro-fat').props.children).toBe('50 g');
  });
});

describe('C-6 keyboard', () => {
  it('the question body scrolls the notes above the keyboard', async () => {
    await seedLocal(answersBeforeSafety(), 'T3');
    const r = await renderFlow(makeApi());
    await waitFor(() => r.getByTestId('consult-screen-T3'));
    const scroll = r.getByTestId('consult-scroll');
    expect(scroll.props.automaticallyAdjustKeyboardInsets).toBe(true);
    expect(scroll.props.keyboardShouldPersistTaps).toBe('handled');
  });
});
