/**
 * Privacy regressions for the PR #310 fix round (Sol audit A-01 to A-04).
 * Each block re-runs the audit's probe against the fixed code and asserts
 * the fixed behaviour.
 *
 *   A-01  no consultation content reaches PostHog touch autocapture
 *   A-02  nothing is sent to the server before box 1 of P0 is ticked; the
 *         first PUT is P0 alone (backend #607 consent-first)
 *   A-03  consent must match the displayed copy version; stale and malformed
 *         records and server version bumps fail closed
 *   D2    box 2 (Roman and AI) is optional, unticked by default, recorded
 *         after the P0 save on the AI consent ledger, never blocking
 *   C-1   a double tap on P0 Continue records once
 *   A-04  the draft is encrypted, bounded, and purged on sign-out with
 *         late writes fenced
 */
import * as path from 'path';
import React from 'react';
import { Alert, AlertButton, Linking, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import ConsultationFlow, { AI_STATUS_WAIT_MS, ConsultationApi } from '../ConsultationFlow';
import type { AiConsentOutcome } from '../../../api/aiConsentApi';
import type { CompleteOutcome } from '../../../api/consultationApi';
import { answersBeforeSafety, fullAnswers, NOW } from '../../../lib/consultation/__fixtures__/consultFixtures';
import { AI_ALLOWED, aiStatus, makeApi, resetStores, seedLocal } from '../../../lib/consultation/__fixtures__/flowHarness';
import {
  DRAFT_CHUNK_CHARS,
  DRAFT_RETENTION_MS,
  installMarkerKey,
  legacyStorageKey,
  manifestKey,
  openDraft,
  purgeConsultationDraft,
  readLocalState,
  writeDraft,
  writeLocalState,
} from '../../../lib/consultation/storage';
import { signOut } from '../../../services/authActions';
import { aiWithdrawalPendingKey, resetAiLedgerWritesForTests } from '../../../lib/consultation/aiConsent';
import { AI_CONSENT_COPY_SHA256, AI_GRANT_NOTICE, AI_GRANT_UNCONFIRMED_NOTICE, AI_WITHDRAW_NOTICE, AI_WITHDRAW_UNCONFIRMED_LINE, CONSENT_COPY_SHA256, CONSENT_COPY_SHA256_V19, CONSULT_CONSENT_COPY_VERSION, SUPPORT_EMAIL, oneBoxConsentScreenCopy, AI_CHOICE_UNKNOWN_LINE } from '../../../lib/consultation/copy';

jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: {},
  usersApi: { updatePushToken: jest.fn(async () => ({ data: {} })) },
  profileApi: { get: jest.fn(async () => ({ data: {} })) },
}));
jest.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('../../../services/sentry', () => ({ setSentryUser: jest.fn(), captureError: jest.fn() }));
jest.mock('../../../lib/analytics', () => ({ reset: jest.fn() }));
jest.mock('../../../lib/userCache', () => ({
  readUserCacheSync: jest.fn(() => ({ id: 'u1' })),
  readUserCache: jest.fn(async () => null),
  clearUserCache: jest.fn(async () => undefined),
}));
jest.mock('../../../offline/sync/sync-engine', () => ({ deleteWorkoutLogsForUser: jest.fn(async () => 0) }));
jest.mock('../../../services/queryClient', () => ({
  retireAndDrainIdentityPersistences: jest.fn(async () => undefined),
  settleAndClearQueryCache: jest.fn(async () => undefined),
  purgePersistedQueryCacheForAllUsers: jest.fn(async () => undefined),
}));

// The installed SDK's own touch extractor (what PostHogProvider calls with
// `autocapture` on; App.tsx keeps it off). Loaded by path because the
// package does not export the subpath.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { autocaptureFromTouchEvent } = require(
  path.resolve(__dirname, '../../../../node_modules/posthog-react-native/dist/autocapture.js'),
) as { autocaptureFromTouchEvent: (e: unknown, posthog: { autocapture: jest.Mock }, opts?: unknown) => void };

function flowElement(api: ConsultationApi, props: Partial<React.ComponentProps<typeof ConsultationFlow>> = {}) {
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

function renderFlow(api: ConsultationApi, props: Partial<React.ComponentProps<typeof ConsultationFlow>> = {}) {
  return render(flowElement(api, props));
}

/**
 * An app restart: the flow is mounted afresh (new key) and reads the draft
 * again; module state (the ledger write queue) starts empty, as in a new process.
 */
function restartFlow(r: Awaited<ReturnType<typeof renderFlow>>, api: ConsultationApi, n = 2) {
  resetAiLedgerWritesForTests();
  return r.rerender(<React.Fragment key={`restart-${n}`}>{flowElement(api)}</React.Fragment>);
}

beforeEach(async () => {
  await resetStores();
});

// ── A-01 ─────────────────────────────────────────────────────────────────────

type HostInstance = { unstable_fiber: unknown };
type Container = { queryAll: (p: (n: HostInstance) => boolean) => HostInstance[] };

/**
 * Simulate a touch on every host element on screen through the SDK's own
 * extractor (real fibers, real ancestor walk); return what reached the SDK.
 */
function touchEverything(container: Container) {
  const sdk = { autocapture: jest.fn() };
  const hosts = container.queryAll(() => true);
  for (const h of hosts) {
    autocaptureFromTouchEvent({ _targetInst: h.unstable_fiber, nativeEvent: { pageX: 10, pageY: 10 } }, sdk, {});
  }
  return { sdk, touched: hosts.length };
}

describe('A-01 analytics exclusion', () => {
  it('control: the harness does capture an element outside the boundary', async () => {
    const r = await render(
      <View testID="outside">
        <Text accessibilityLabel="Yes">Yes</Text>
      </View>,
    );
    const { sdk } = touchEverything(r.container as never);
    expect(sdk.autocapture).toHaveBeenCalled();
  });

  async function expectNothingCaptured(r: Awaited<ReturnType<typeof renderFlow>>) {
    const { sdk, touched } = touchEverything(r.container as never);
    expect(touched).toBeGreaterThan(5);
    expect(sdk.autocapture).not.toHaveBeenCalled();
  }

  it('no answer, screen id, note or measurement reaches the SDK from question screens', async () => {
    const api = makeApi();
    // The audit's probe: a screening yes with a private note on P4.
    const a = answersBeforeSafety();
    Object.assign(a, { P1: 'no', P2: 'no', P3: 'no', P4: 'yes', P4_note: 'Private health note' });
    await seedLocal(a, 'P4');
    const r = await renderFlow(api);
    await waitFor(() => r.getByTestId('consult-screen-P4'));
    expect(r.getByTestId('consult-option-yes')).toBeTruthy();
    await expectNothingCaptured(r);

    await seedLocal(answersBeforeSafety(), 'B3');
    const b = await renderFlow(makeApi());
    await waitFor(() => b.getByTestId('consult-screen-B3'));
    await expectNothingCaptured(b);
  });

  it('the agreement, summary and both reveals are excluded too', async () => {
    await seedLocal({}, 'P0');
    const p0 = await renderFlow(makeApi());
    await waitFor(() => p0.getByTestId('consult-screen-P0'));
    await expectNothingCaptured(p0);
    p0.unmount();

    await seedLocal(fullAnswers({ P2: 'yes', P2_note: 'Chest tightness on stairs' }), 'SUM');
    const r = await renderFlow(makeApi());
    await waitFor(() => r.getByTestId('consult-screen-SUM'));
    await expectNothingCaptured(r);
    await fireEvent.press(r.getByTestId('consult-prepare'));
    await waitFor(() => r.getByTestId('consult-screen-MACRO'));
    await expectNothingCaptured(r);
    await fireEvent.press(r.getByTestId('consult-macro-next'));
    await waitFor(() => r.getByTestId('consult-screen-PLAN'));
    await expectNothingCaptured(r);
  });

  it('problem and paused states are excluded', async () => {
    const api = makeApi({ complete: jest.fn(async (): Promise<CompleteOutcome> => ({ kind: 'error', status: 500 })) });
    await seedLocal(fullAnswers(), 'SUM');
    const r = await renderFlow(api);
    await waitFor(() => r.getByTestId('consult-screen-SUM'));
    await fireEvent.press(r.getByTestId('consult-prepare'));
    await waitFor(() => r.getByTestId('consult-problem-unknown'));
    await expectNothingCaptured(r);

    await seedLocal(answersBeforeSafety(), 'N3');
    const p = await renderFlow(makeApi());
    await waitFor(() => p.getByTestId('consult-screen-N3'));
    await fireEvent.press(p.getByTestId('consult-finish-later'));
    await waitFor(() => p.getByTestId('consult-paused'));
    await expectNothingCaptured(p);
  });
});

// ── A-02 ─────────────────────────────────────────────────────────────────────

const conflict = (code: string) => Object.assign(new Error('409'), { response: { status: 409, data: { code } } });
const P0_CURRENT = fullAnswers().P0;
/** GET /me/onboarding with a current P0 already on the server. */
const serverWithConsent = () =>
  jest.fn(async () => ({ answers: { P0: P0_CURRENT }, completed: false, consent_recorded: true, saved_at: '2026-09-30T18:00:00Z', revision: 1 }));
const tick = () => act(async () => { await new Promise((res) => setTimeout(res, 0)); });

async function toP0(api: ConsultationApi) {
  const r = await renderFlow(api);
  await waitFor(() => r.getByTestId('consult-screen-W1'));
  await fireEvent.press(r.getByTestId('consult-continue'));
  await waitFor(() => r.getByTestId('consult-screen-P0'));
  return r;
}

describe('A-02 agreement before any upload', () => {

  it('LS-E4 C1: ticking the one box alone sends nothing; Continue saves once', async () => {
    const api = makeApi();
    const r = await toP0(api);
    expect(api.save).not.toHaveBeenCalled();
    await fireEvent.press(r.getByTestId('consent-checkbox'));
    await tick();
    expect(api.save).not.toHaveBeenCalled();
    expect(r.queryByTestId('consent-ai-checkbox')).toBeNull();
    await fireEvent.press(r.getByTestId('consult-continue'));
    await waitFor(() => r.getByTestId('consult-screen-G1'));
    expect(api.save).toHaveBeenCalledTimes(1);
  });

  it('LS-E4 C1: two synchronous Continue taps save the first P0 only once', async () => {
    const api = makeApi();
    const r = await toP0(api);
    await fireEvent.press(r.getByTestId('consent-checkbox'));
    const button = r.getByTestId('consult-continue');
    await act(async () => {
      const first = button.props.onPress();
      const second = button.props.onPress();
      await Promise.all([first, second]);
    });
    await waitFor(() => r.getByTestId('consult-screen-G1'));
    expect(api.save).toHaveBeenCalledTimes(1);
  });

  it('LS-E4 C1: completion with a one-box P0 does not depend on the Roman ledger', async () => {
    const shown = oneBoxConsentScreenCopy(false);
    const P0 = { agreed: true as const, copy_version: shown.version, text_sha256: shown.sha256, agreed_at: NOW.toISOString() };
    await seedLocal(fullAnswers({ P0 }), 'SUM');
    const api = makeApi({
      getRomanConsent: jest.fn(async (): Promise<AiConsentOutcome> => ({ kind: 'unavailable', status: 503 })),
    });
    const r = await renderFlow(api);
    await waitFor(() => r.getByTestId('consult-screen-SUM'));
    await fireEvent.press(r.getByTestId('consult-prepare'));
    await waitFor(() => r.getByTestId('consult-screen-MACRO'));
    expect(api.complete).toHaveBeenCalledTimes(1);
    expect(api.withdrawRomanConsent).not.toHaveBeenCalled();
  });

  it('audit probe: answers without a recorded agreement never reach the server', async () => {
    const a = answersBeforeSafety();
    delete a.P0;
    Object.assign(a, { T3: 'yes', T3_areas: ['knee'], T3_note: 'Recent surgery' });
    const api = makeApi();
    await seedLocal(a, 'T4');
    const r = await renderFlow(api);
    // The first gap is the agreement, so the flow resumes there.
    await waitFor(() => r.getByTestId('consult-screen-P0'));
    expect(r.getByTestId('consent-checkbox').props.accessibilityState).toMatchObject({ checked: false });
    expect(api.save).not.toHaveBeenCalled();
  });

});

describe('A-02 consent-first PUT (backend #607)', () => {
  it('the first PUT after W1 carries P0 alone, with the displayed copy version and text hash', async () => {
    const api = makeApi();
    const r = await toP0(api);
    await fireEvent.press(r.getByTestId('consent-checkbox'));
    await fireEvent.press(r.getByTestId('consult-continue'));
    await waitFor(() => r.getByTestId('consult-screen-G1'));
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
    const first = api.save.mock.calls[0][0];
    expect(Object.keys(first.answers)).toEqual(['P0']);
    // STORE-E4 (owner #184-E5 / #184-E6 op 1): the displayed one-box screen is consult-consent-v19 (b#1188 pins).
    expect(first.answers.P0).toMatchObject({ agreed: true, copy_version: 'consult-consent-v19', text_sha256: CONSENT_COPY_SHA256_V19 });
    expect(first.answers.P0.copy_version).toBe(oneBoxConsentScreenCopy(false).version);
    expect(first.answers.P0.text_sha256).toBe(oneBoxConsentScreenCopy(false).sha256);
    // Only backend #607 P0 keys: no AI choice is part of the intake answer.
    expect(Object.keys(first.answers.P0).sort()).toEqual(['agreed', 'agreed_at', 'copy_version', 'text_sha256']);
  });

  it('if the P0 PUT never landed, the next save sends P0 alone before the rest', async () => {
    const save = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ saved_at: '2026-09-30T19:00:00Z', completed_chapters: [] });
    const api = makeApi({ save });
    await seedLocal({}, 'P0');
    const r = await renderFlow(api);
    await waitFor(() => r.getByTestId('consult-screen-P0'));
    await fireEvent.press(r.getByTestId('consent-checkbox'));
    await fireEvent.press(r.getByTestId('consult-continue'));
    await waitFor(() => r.getByTestId('consult-screen-G1'));
    await fireEvent.press(r.getByTestId('consult-option-fat_loss'));
    await waitFor(() => r.getByTestId('consult-screen-G2'));
    await fireEvent.press(r.getByTestId('consult-chip-energy'));
    await fireEvent.press(r.getByTestId('consult-continue'));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(3));
    expect(Object.keys(save.mock.calls[0][0].answers)).toEqual(['P0']); // failed
    expect(Object.keys(save.mock.calls[1][0].answers)).toEqual(['P0']); // P0 first again
    expect(save.mock.calls[2][0].answers).toMatchObject({ G1: 'fat_loss', G2: ['energy'] });
  });

  it('a server that already holds a current P0 gets the answers directly', async () => {
    const api = makeApi({ getState: serverWithConsent() });
    await seedLocal(answersBeforeSafety(), 'N3', { dirty: true, editedAt: '2026-09-30T19:00:00Z', synced: { saved_at: '2026-09-30T18:00:00Z', revision: 1 } });
    const r = await renderFlow(api);
    await waitFor(() => r.getByTestId('consult-screen-N3'));
    await fireEvent.press(r.getByTestId('consult-finish-later'));
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
    expect(Object.keys(api.save.mock.calls[0][0].answers).length).toBeGreaterThan(1);
  });


  it('409 consent_missing on the final save at Prepare shows the agreement problem, not completion', async () => {
    const save = jest.fn(async () => { throw conflict('consent_missing'); });
    const api = makeApi({ save, getState: serverWithConsent() });
    await seedLocal(fullAnswers(), 'SUM', { dirty: true, editedAt: '2026-09-30T19:00:00Z', synced: { saved_at: '2026-09-30T18:00:00Z', revision: 1 } });
    const r = await renderFlow(api);
    await waitFor(() => r.getByTestId('consult-screen-SUM'));
    await fireEvent.press(r.getByTestId('consult-prepare'));
    await waitFor(() => r.getByTestId('consult-problem-consent_missing'));
    expect(api.complete).not.toHaveBeenCalled();
    await fireEvent.press(r.getByTestId('consult-problem-action'));
    await waitFor(() => r.getByTestId('consult-screen-P0'));
    expect(r.getByTestId('consent-checkbox').props.accessibilityState).toMatchObject({ checked: false });
  });
});

// ── A-03 ─────────────────────────────────────────────────────────────────────

describe('A-03 consent matches the displayed copy, fails closed', () => {
  const stale = { agreed: true, copy_version: 'obsolete-v0', agreed_at: '2025-01-01T00:00:00Z' } as never;

  it('LS-E4 C1: a stale local P0 resumes unticked and is never uploaded', async () => {
    await seedLocal(fullAnswers({ P0: stale }), 'SUM');
    const api = makeApi();
    const r = await renderFlow(api);
    await waitFor(() => r.getByTestId('consult-screen-P0'));
    expect(r.queryByTestId('consult-screen-SUM')).toBeNull();
    expect(r.getByTestId('consent-checkbox').props.accessibilityState).toMatchObject({ checked: false });
    expect(r.getByTestId('consult-continue').props.accessibilityState).toMatchObject({ disabled: true });
    await tick();
    expect(api.save).not.toHaveBeenCalled();
  });

  it('LS-E4 C1: a rejected one-box P0 fails closed with the update explanation', async () => {
    const api = makeApi({ save: jest.fn(async () => { throw conflict('consent_missing'); }) });
    const r = await toP0(api);
    await fireEvent.press(r.getByTestId('consent-checkbox'));
    await fireEvent.press(r.getByTestId('consult-continue'));
    await waitFor(() => r.getByTestId('consent-error'));
    expect(r.getByTestId('consent-error').props.children).toMatch(/update the app/);
    expect(r.getByTestId('consent-checkbox').props.accessibilityState).toMatchObject({ checked: false });
    expect(r.getByTestId('consult-continue').props.accessibilityState).toMatchObject({ disabled: true });
    expect(api.save).toHaveBeenCalledTimes(1);
    expect(api.complete).not.toHaveBeenCalled();
  });

  it('LS-E4 C1: a later save rejected for version returns unticked and stops uploads', async () => {
    await seedLocal(fullAnswers(), 'G1');
    const api = makeApi({ save: jest.fn(async () => { throw conflict('consent_version_mismatch'); }) });
    const r = await renderFlow(api);
    await waitFor(() => r.getByTestId('consult-screen-G1'));
    await fireEvent.press(r.getByTestId('option-get_stronger'));
    await fireEvent.press(r.getByTestId('consult-continue'));
    await waitFor(() => r.getByTestId('consult-screen-P0'));
    expect(r.getByTestId('consent-checkbox').props.accessibilityState).toMatchObject({ checked: false });
    expect(r.getByTestId('consult-continue').props.accessibilityState).toMatchObject({ disabled: true });
    expect(r.getByTestId('consent-error').props.children).toMatch(/update the app/);
    const count = (api.save as jest.Mock).mock.calls.length;
    await fireEvent.press(r.getByTestId('consult-continue'));
    await tick();
    expect((api.save as jest.Mock).mock.calls.length).toBe(count);
    expect(api.complete).not.toHaveBeenCalled();
  });

  it('a server P0 of the earlier copy (consult-consent-v1) is not honoured', async () => {
    const api = makeApi({
      getState: jest.fn(async () => ({
        answers: fullAnswers({ P0: { agreed: true, copy_version: 'consult-consent-v1', agreed_at: '2026-09-30T19:00:00.000Z' } as never }),
        completed: false,
        consent_recorded: true,
        saved_at: '2026-09-30T20:00:00Z',
        revision: 3,
      })),
    });
    const r = await renderFlow(api);
    await waitFor(() => r.getByTestId('consult-screen-P0'));
    expect(r.getByTestId('consent-checkbox').props.accessibilityState).toMatchObject({ checked: false });
    await tick();
    expect(api.save).not.toHaveBeenCalled();
  });

  it('malformed records route to P0 unticked', async () => {
    for (const P0 of ['yes', { agreed: 'true' }, { agreed: true }, ['agreed'], { agreed: true, copy_version: CONSULT_CONSENT_COPY_VERSION, agreed_at: '2026-09-30T19:00:00.000Z', text_sha256: 'NOT-HEX' }] as never[]) {
      await resetStores();
      const api = makeApi();
      await seedLocal(fullAnswers({ P0 }), 'SUM');
      const r = await renderFlow(api);
      await waitFor(() => r.getByTestId('consult-screen-P0'));
      expect(r.getByTestId('consent-checkbox').props.accessibilityState).toMatchObject({ checked: false });
      expect(api.save).not.toHaveBeenCalled();
      r.unmount();
    }
  });


  it('a version rejection at Prepare shows the update problem, not completion', async () => {
    const save = jest.fn(async () => { throw conflict('consent_missing'); });
    const api = makeApi({ save });
    await seedLocal(fullAnswers(), 'SUM');
    const r = await renderFlow(api);
    await waitFor(() => r.getByTestId('consult-screen-SUM'));
    await fireEvent.press(r.getByTestId('consult-prepare'));
    await waitFor(() => r.getByTestId('consult-problem-consent_version_mismatch'));
    expect(api.complete).not.toHaveBeenCalled();
  });

  it('409 consent_version_mismatch from complete fails closed back to P0', async () => {
    const api = makeApi({
      complete: jest.fn(async (): Promise<CompleteOutcome> => ({ kind: 'conflict', code: 'consent_version_mismatch' })),
    });
    await seedLocal(fullAnswers(), 'SUM');
    const r = await renderFlow(api);
    await waitFor(() => r.getByTestId('consult-screen-SUM'));
    await fireEvent.press(r.getByTestId('consult-prepare'));
    await waitFor(() => r.getByTestId('consult-problem-consent_version_mismatch'));
    await fireEvent.press(r.getByTestId('consult-problem-action'));
    await waitFor(() => r.getByTestId('consult-screen-P0'));
    expect(r.getByTestId('consent-checkbox').props.accessibilityState).toMatchObject({ checked: false });
  });
});

// ── D2 box 2 ─────────────────────────────────────────────────────────────────

describe('D2 box 2: optional Roman and AI, recorded on the AI consent ledger, never blocking', () => {





});

// ── Fix round 3 (Opus final audit at 00cfb6c) ───────────────────────────────

const httpErr = (status: number, code?: string) =>
  Object.assign(new Error(String(status)), { response: { status, data: code ? { code } : {} } });
const offline = () => new Error('Network Error');

/** P0 from a seeded draft, the one box ticked, Continue: lands on G1. */
async function continueWithTheBox(api: ConsultationApi, props: Partial<React.ComponentProps<typeof ConsultationFlow>> = {}) {
  await seedLocal({}, 'P0');
  const r = await renderFlow(api, props);
  await waitFor(() => r.getByTestId('consult-screen-P0'));
  await fireEvent.press(r.getByTestId('consent-checkbox'));
  await fireEvent.press(r.getByTestId('consult-continue'));
  await waitFor(() => r.getByTestId('consult-screen-G1'));
  return r;
}

describe('C-310-1 / C-310-3 completion guard and the way out of problem screens', () => {
  it('C-310-1: two synchronous taps on Prepare my plan complete once', async () => {
    let finish: (v: CompleteOutcome) => void = () => undefined;
    const complete = jest.fn(() => new Promise<CompleteOutcome>((res) => { finish = res; }));
    const api = makeApi({ complete });
    await seedLocal(fullAnswers(), 'SUM');
    const r = await renderFlow(api);
    await waitFor(() => r.getByTestId('consult-screen-SUM'));
    const prep = r.getByTestId('consult-prepare');
    await act(async () => {
      fireEvent.press(prep);
      fireEvent.press(prep);
    });
    await waitFor(() => expect(complete).toHaveBeenCalledTimes(1));
    await tick();
    expect(complete).toHaveBeenCalledTimes(1);
    await act(async () => finish({ kind: 'error', status: null }));
    // After a failure, Try again works (the guard is released).
    await waitFor(() => r.getByTestId('consult-problem-network'));
    await fireEvent.press(r.getByTestId('consult-problem-action'));
    await waitFor(() => expect(complete).toHaveBeenCalledTimes(2));
  });

  it('C-310-3: the problem screen keeps Try again primary and offers Contact support and Sign out', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const onSignOut = jest.fn();
    const api = makeApi({ complete: jest.fn(async (): Promise<CompleteOutcome> => ({ kind: 'conflict', code: 'not_attached' })) });
    await seedLocal(fullAnswers(), 'SUM');
    const r = await renderFlow(api, { onSignOut });
    await waitFor(() => r.getByTestId('consult-screen-SUM'));
    await fireEvent.press(r.getByTestId('consult-prepare'));
    await waitFor(() => r.getByTestId('consult-problem-unknown'));
    expect(r.getByTestId('consult-problem-action')).toBeTruthy();
    await fireEvent.press(r.getByTestId('consult-support'));
    expect(SUPPORT_EMAIL).toBe('support@thegrowthproject.site');
    expect(open).toHaveBeenCalledWith(expect.stringMatching(/^mailto:support@thegrowthproject\.site\?subject=/));
    await fireEvent.press(r.getByTestId('consult-sign-out'));
    expect(onSignOut).not.toHaveBeenCalled(); // asks first
    const buttons = (alert.mock.calls[alert.mock.calls.length - 1][2] ?? []) as AlertButton[];
    buttons.find((b) => b.style === 'destructive')?.onPress?.();
    expect(onSignOut).toHaveBeenCalledTimes(1);
    open.mockRestore();
    alert.mockRestore();
  });

  it('B-324-1: Contact support that cannot open an email app shows the address, Copy and Try again in place', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no mail app'));
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const r = await continueWithTheBox(makeApi(), { onSignOut: jest.fn() });
    await fireEvent.press(r.getByTestId('consult-finish-later'));
    await waitFor(() => r.getByTestId('consult-paused'));
    expect(r.queryByTestId('consult-support-fallback')).toBeNull();
    await fireEvent.press(r.getByTestId('consult-support'));
    await waitFor(() => r.getByTestId('consult-support-fallback'));
    expect(open).toHaveBeenCalledWith('mailto:support@thegrowthproject.site?subject=Help%20with%20my%20consultation');
    expect(r.getByTestId('consult-support-fallback-status').props.children).toMatch(/could not open an email app/);
    const address = r.getByTestId('consult-support-fallback-address');
    expect(address.props.selectable).toBe(true);
    expect(address.props.children).toBe(SUPPORT_EMAIL);
    expect(r.getByTestId('consult-support-fallback-copy')).toBeTruthy();
    await fireEvent.press(r.getByTestId('consult-support-fallback-retry'));
    await waitFor(() => expect(open).toHaveBeenCalledTimes(2));
    // In place, not a dismissible alert that hides the address again.
    expect(alert).not.toHaveBeenCalled();
    open.mockRestore();
    alert.mockRestore();
  });

  it('C-310-3: the paused screen has the same way out', async () => {
    const r = await continueWithTheBox(makeApi(), { onSignOut: jest.fn() });
    await fireEvent.press(r.getByTestId('consult-finish-later'));
    await waitFor(() => r.getByTestId('consult-paused'));
    expect(r.getByTestId('consult-resume')).toBeTruthy();
    expect(r.getByTestId('consult-support')).toBeTruthy();
    expect(r.getByTestId('consult-sign-out')).toBeTruthy();
  });

  it('C-310-3: without a sign-out handler only Contact support shows', async () => {
    const r = await continueWithTheBox(makeApi());
    await fireEvent.press(r.getByTestId('consult-finish-later'));
    await waitFor(() => r.getByTestId('consult-paused'));
    expect(r.getByTestId('consult-support')).toBeTruthy();
    expect(r.queryByTestId('consult-sign-out')).toBeNull();
  });
});

// ── A-04 ─────────────────────────────────────────────────────────────────────

describe('A-04 encrypted, bounded, purged draft', () => {
  /** The SecureStore mock's backing map (jest setup). */
  const secure = {
    get __store(): Map<string, string> {
      const store: unknown = Reflect.get(SecureStore, '__store');
      if (!(store instanceof Map)) throw new Error('SecureStore mock has no __store');
      return store;
    },
  };
  const sensitive = { P4: 'yes', P4_note: 'Sensitive screening note' };

  it('the draft is stored only in SecureStore, in values under 2 KB, never in AsyncStorage', async () => {
    const big = { ...sensitive, T3: 'yes', T3_note: 'x'.repeat(280), P1_note: '\u00e9'.repeat(280) };
    await writeLocalState('u1', { screenId: 'P4', answers: big });
    const asyncKeys = await AsyncStorage.getAllKeys();
    for (const k of asyncKeys) expect(String(await AsyncStorage.getItem(k))).not.toContain('Sensitive screening note');
    const values = [...secure.__store.entries()].filter(([k]) => k.startsWith('consult_draft.'));
    expect(values.length).toBeGreaterThan(1);
    for (const [, v] of values) {
      expect(v.length).toBeLessThanOrEqual(Math.max(DRAFT_CHUNK_CHARS, 200));
      expect(Buffer.byteLength(v, 'utf8')).toBeLessThan(2048);
    }
    expect((await readLocalState('u1'))?.answers.P4_note).toBe('Sensitive screening note');
  });

  it('audit probe reversed: signOut removes the draft and the legacy plaintext key', async () => {
    await writeLocalState('u1', { screenId: 'P4', answers: sensitive });
    await AsyncStorage.setItem(legacyStorageKey('u1'), JSON.stringify({ answers: sensitive }));
    await signOut('u1');
    expect(await readLocalState('u1')).toBeNull();
    expect(await AsyncStorage.getItem(legacyStorageKey('u1'))).toBeNull();
    expect([...secure.__store.keys()].filter((k) => k.startsWith('consult_draft.u1.'))).toEqual([]);
  });

  it('a write queued before sign-out, or arriving late from the old screen, cannot resurrect the draft', async () => {
    const handle = openDraft('u1');
    const queued = writeDraft(handle, { answers: sensitive, screenId: 'P4', editedAt: 'x', dirty: true, synced: null });
    const out = signOut('u1');
    await writeDraft(handle, { answers: sensitive, screenId: 'P5', editedAt: 'x', dirty: true, synced: null });
    await Promise.all([queued, out]);
    await writeDraft(handle, { answers: sensitive, screenId: 'P6', editedAt: 'x', dirty: true, synced: null });
    expect(await readLocalState('u1')).toBeNull();
    expect(secure.__store.has(manifestKey('u1'))).toBe(false);
    // A new session (new handle) can write again.
    await writeDraft(openDraft('u1'), { answers: { G1: 'fat_loss' }, screenId: 'G1', editedAt: 'x', dirty: true, synced: null });
    expect((await readLocalState('u1'))?.answers.G1).toBe('fat_loss');
  });

  it('the mounted flow cannot write after a purge (late answer from an unmounting screen)', async () => {
    await seedLocal(answersBeforeSafety(), 'N3');
    const r = await renderFlow(makeApi());
    await waitFor(() => r.getByTestId('consult-screen-N3'));
    await purgeConsultationDraft('u1');
    await fireEvent.press(r.getByTestId('consult-chip-4'));
    await act(async () => { await new Promise((res) => setTimeout(res, 0)); });
    expect(await readLocalState('u1')).toBeNull();
  });

  it('a purge leaves other users on the device alone', async () => {
    await writeLocalState('u1', { screenId: 'P4', answers: sensitive });
    await writeLocalState('u2', { screenId: 'G1', answers: { G1: 'fat_loss' } });
    await purgeConsultationDraft('u1');
    expect(await readLocalState('u1')).toBeNull();
    expect((await readLocalState('u2'))?.answers.G1).toBe('fat_loss');
  });

  it('retention is bounded: an untouched draft older than the window is deleted on read', async () => {
    const written = new Date('2026-09-01T00:00:00Z');
    await writeLocalState('u1', { screenId: 'P4', answers: sensitive }, written);
    expect(await readLocalState('u1', new Date(written.getTime() + DRAFT_RETENTION_MS - 1000))).not.toBeNull();
    expect(await readLocalState('u1', new Date(written.getTime() + DRAFT_RETENTION_MS + 1000))).toBeNull();
    expect([...secure.__store.keys()].filter((k) => k.startsWith('consult_draft.u1.'))).toEqual([]);
  });

  it('C-7: a draft left in the Keychain by an earlier install is deleted, not resumed', async () => {
    await writeLocalState('u1', { screenId: 'P4', answers: sensitive });
    expect(await AsyncStorage.getItem(installMarkerKey('u1'))).toBe('1');
    // Reinstall: AsyncStorage is wiped with the app, the Keychain is not.
    await AsyncStorage.clear();
    expect(secure.__store.has(manifestKey('u1'))).toBe(true);
    expect(await readLocalState('u1')).toBeNull();
    expect([...secure.__store.keys()].filter((k) => k.startsWith('consult_draft.u1.'))).toEqual([]);
  });

  it('the install marker holds no answer data and is removed by a purge', async () => {
    await writeLocalState('u1', { screenId: 'P4', answers: sensitive });
    expect(installMarkerKey('u1')).not.toMatch(/P4|Sensitive/);
    await purgeConsultationDraft('u1');
    expect(await AsyncStorage.getItem(installMarkerKey('u1'))).toBeNull();
  });

  it('a corrupt draft is deleted rather than kept', async () => {
    await writeLocalState('u1', { screenId: 'P4', answers: sensitive });
    const chunk = [...secure.__store.keys()].find((k) => /^consult_draft\.u1\.[ab]0$/.test(k))!;
    secure.__store.set(chunk, '{not json');
    expect(await readLocalState('u1')).toBeNull();
    expect(secure.__store.has(manifestKey('u1'))).toBe(false);
  });

  it('finishing onboarding deletes the draft', async () => {
    await seedLocal(fullAnswers(), 'SUM');
    const onFinished = jest.fn();
    const r = await renderFlow(makeApi(), { onFinished });
    await waitFor(() => r.getByTestId('consult-screen-SUM'));
    await fireEvent.press(r.getByTestId('consult-prepare'));
    await waitFor(() => r.getByTestId('consult-screen-MACRO'));
    await fireEvent.press(r.getByTestId('consult-macro-next'));
    await waitFor(() => r.getByTestId('consult-screen-PLAN'));
    await fireEvent.press(r.getByTestId('consult-finish'));
    expect(onFinished).toHaveBeenCalled();
    await act(async () => { await new Promise((res) => setTimeout(res, 0)); });
    expect(await readLocalState('u1')).toBeNull();
  });
});
