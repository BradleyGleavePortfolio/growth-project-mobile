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
import { AI_CONSENT_COPY_SHA256, AI_GRANT_NOTICE, AI_WITHDRAW_NOTICE, CONSENT_COPY_SHA256, CONSULT_CONSENT_COPY_VERSION, SUPPORT_EMAIL } from '../../../lib/consultation/copy';

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
// `autocapture` on, as App.tsx configures it). Loaded by path because the
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

/** An app restart: the flow is mounted afresh (new key) and reads the draft again. */
function restartFlow(r: Awaited<ReturnType<typeof renderFlow>>, api: ConsultationApi, n = 2) {
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
  it('first run: W1 leads to P0 and nothing is sent until box 1 is ticked', async () => {
    const api = makeApi();
    const r = await toP0(api);
    expect(api.save).not.toHaveBeenCalled();
    await fireEvent.press(r.getByTestId('consent-checkbox'));
    await tick();
    expect(api.save).not.toHaveBeenCalled(); // ticking alone sends nothing
    await fireEvent.press(r.getByTestId('consult-continue'));
    await waitFor(() => r.getByTestId('consult-screen-G1'));
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
    expect(api.grantRomanConsent).not.toHaveBeenCalled();
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

  it('box 1 does not depend on the AI consent ledger: saves and completion work with box 2 never ticked', async () => {
    await seedLocal(fullAnswers(), 'SUM');
    const api = makeApi();
    const r = await renderFlow(api);
    await waitFor(() => r.getByTestId('consult-screen-SUM'));
    await fireEvent.press(r.getByTestId('consult-prepare'));
    await waitFor(() => r.getByTestId('consult-screen-MACRO'));
    expect(api.complete).toHaveBeenCalledTimes(1);
    expect(api.grantRomanConsent).not.toHaveBeenCalled();
    expect(api.withdrawRomanConsent).not.toHaveBeenCalled();
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
    expect(first.answers.P0).toMatchObject({ agreed: true, copy_version: 'consult-consent-v2', text_sha256: CONSENT_COPY_SHA256 });
    expect(first.answers.P0.copy_version).toBe(CONSULT_CONSENT_COPY_VERSION);
    // Only backend #607 P0 keys: box 2 is never part of the intake answer.
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

  it('409 consent_missing on a later save routes back to the agreement, unticked, and stops uploading', async () => {
    const save = jest.fn(async () => { throw conflict('consent_missing'); });
    const api = makeApi({ save, getState: serverWithConsent() });
    await seedLocal(answersBeforeSafety(), 'N3', { dirty: true, editedAt: '2026-09-30T19:00:00Z', synced: { saved_at: '2026-09-30T18:00:00Z', revision: 1 } });
    const r = await renderFlow(api);
    await waitFor(() => r.getByTestId('consult-screen-N3'));
    await fireEvent.press(r.getByTestId('consult-finish-later'));
    await waitFor(() => r.getByTestId('consult-screen-P0'));
    expect(r.getByTestId('consent-checkbox').props.accessibilityState).toMatchObject({ checked: false });
    expect(r.getByTestId('consent-ai-checkbox').props.accessibilityState).toMatchObject({ checked: false });
    expect(r.queryByTestId('consent-error')).toBeNull(); // not a version problem
    expect(save).toHaveBeenCalledTimes(1);
    expect((await readLocalState('u1', NOW))?.answers.P0).toBeUndefined();
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

  it('audit probe: a stale copy version resumes at P0 unticked and is never re-sent', async () => {
    for (const P0 of [stale, { agreed: true, copy_version: 'consult-consent-v1', agreed_at: '2026-09-30T19:00:00.000Z' }] as never[]) {
      await resetStores();
      const api = makeApi({
        complete: jest.fn(async (): Promise<CompleteOutcome> => ({ kind: 'conflict', code: 'consent_missing' })),
      });
      await seedLocal(fullAnswers({ P0 }), 'SUM');
      const r = await renderFlow(api);
      await waitFor(() => r.getByTestId('consult-screen-P0'));
      expect(r.queryByTestId('consult-screen-SUM')).toBeNull();
      expect(r.getByTestId('consent-checkbox').props.accessibilityState).toMatchObject({ checked: false });
      expect(r.getByTestId('consult-continue').props.accessibilityState).toMatchObject({ disabled: true });
      await tick();
      expect(api.save).not.toHaveBeenCalled();
      expect(api.grantRomanConsent).not.toHaveBeenCalled();
      r.unmount();
    }
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

  it('a server that no longer accepts this copy version (P0-only PUT rejected) fails closed with an update message', async () => {
    const save = jest.fn(async (_body: { answers: object }) => { throw conflict('consent_missing'); });
    const api = makeApi({ save });
    const r = await toP0(api);
    await fireEvent.press(r.getByTestId('consent-checkbox'));
    await fireEvent.press(r.getByTestId('consent-ai-checkbox'));
    await fireEvent.press(r.getByTestId('consult-continue'));
    await waitFor(() => r.getByTestId('consent-error'));
    expect(r.getByTestId('consult-screen-P0')).toBeTruthy();
    expect(r.getByTestId('consent-error').props.children).toMatch(/update the app/);
    expect(r.getByTestId('consent-error').props.children).not.toMatch(/Nothing has been sent/); // Opus C-3
    expect(r.getByTestId('consent-checkbox').props.accessibilityState).toMatchObject({ checked: false });
    await fireEvent.press(r.getByTestId('consent-checkbox'));
    expect(r.getByTestId('consult-continue').props.accessibilityState).toMatchObject({ disabled: true });
    expect(save).toHaveBeenCalledTimes(1);
    expect(Object.keys(save.mock.calls[0][0].answers)).toEqual(['P0']);
    await tick();
    // Box 1 was rejected, so the optional box 2 grant is not sent either.
    expect(api.grantRomanConsent).not.toHaveBeenCalled();
    expect((await readLocalState('u1', NOW))?.answers.P0).toBeUndefined();
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
  it('ticked: POST /me/ai-consent/roman after the P0 save, with client-ai-v3 and the box 2 copy hash; the flow does not wait', async () => {
    let release: (v: unknown) => void = () => undefined;
    const grantRomanConsent = jest.fn(() => new Promise((res) => { release = res; }));
    const api = makeApi({ grantRomanConsent });
    const r = await toP0(api);
    await fireEvent.press(r.getByTestId('consent-checkbox'));
    await fireEvent.press(r.getByTestId('consent-ai-checkbox'));
    expect(r.getByTestId('consent-ai-checkbox').props.accessibilityState).toMatchObject({ checked: true });
    await fireEvent.press(r.getByTestId('consult-continue'));
    // The client is already on G1 while the grant is still pending.
    await waitFor(() => r.getByTestId('consult-screen-G1'));
    await waitFor(() => expect(grantRomanConsent).toHaveBeenCalledTimes(1));
    expect(api.save.mock.invocationCallOrder[0]).toBeLessThan(grantRomanConsent.mock.invocationCallOrder[0]);
    expect(grantRomanConsent).toHaveBeenCalledWith({ version: 'client-ai-v3', copy_sha256: AI_CONSENT_COPY_SHA256, platform: 'ios' });
    // Never on the intake: box 2 is not part of any PUT.
    for (const [body] of api.save.mock.calls) expect(JSON.stringify(body)).not.toMatch(/client-ai|anthropic/i);
    release({ kind: 'ok', status: null });
  });

  it('a failed grant is retried once and then left for Settings; onboarding continues and completes', async () => {
    const grantRomanConsent = jest.fn(async () => ({ kind: 'error' as const, status: 500 }));
    const api = makeApi({ grantRomanConsent });
    await seedLocal({}, 'P0');
    const r = await renderFlow(api);
    await waitFor(() => r.getByTestId('consult-screen-P0'));
    await fireEvent.press(r.getByTestId('consent-checkbox'));
    await fireEvent.press(r.getByTestId('consent-ai-checkbox'));
    await fireEvent.press(r.getByTestId('consult-continue'));
    await waitFor(() => r.getByTestId('consult-screen-G1'));
    await waitFor(() => expect(grantRomanConsent).toHaveBeenCalledTimes(2));
    await tick();
    expect(grantRomanConsent).toHaveBeenCalledTimes(2);
    expect(r.queryByTestId('consent-error')).toBeNull();
  });

  it('ledger not deployed (404) or switched off (503): skipped silently, no retry, left for Settings', async () => {
    for (const [status, calls] of [[404, 1], [503, 1]] as const) {
      await resetStores();
      const grantRomanConsent = jest.fn(async () => ({ kind: 'unavailable' as const, status }));
      const api = makeApi({ grantRomanConsent });
      await seedLocal({}, 'P0');
      const r = await renderFlow(api);
      await waitFor(() => r.getByTestId('consult-screen-P0'));
      await fireEvent.press(r.getByTestId('consent-checkbox'));
      await fireEvent.press(r.getByTestId('consent-ai-checkbox'));
      await fireEvent.press(r.getByTestId('consult-continue'));
      await waitFor(() => r.getByTestId('consult-screen-G1'));
      await waitFor(() => expect(grantRomanConsent).toHaveBeenCalledTimes(calls));
      await tick();
      expect(grantRomanConsent).toHaveBeenCalledTimes(calls);
      expect(r.queryByTestId('consent-error')).toBeNull();
      r.unmount();
    }
  });

  it('409 CONSENT_VERSION_MISMATCH on the box 2 grant is not retried and never blocks', async () => {
    const grantRomanConsent = jest.fn(async () => ({ kind: 'version_mismatch' as const }));
    const api = makeApi({ grantRomanConsent });
    await seedLocal({}, 'P0');
    const r = await renderFlow(api);
    await waitFor(() => r.getByTestId('consult-screen-P0'));
    await fireEvent.press(r.getByTestId('consent-checkbox'));
    await fireEvent.press(r.getByTestId('consent-ai-checkbox'));
    await fireEvent.press(r.getByTestId('consult-continue'));
    await waitFor(() => r.getByTestId('consult-screen-G1'));
    await waitFor(() => expect(grantRomanConsent).toHaveBeenCalledTimes(1));
    await tick();
    expect(grantRomanConsent).toHaveBeenCalledTimes(1);
  });

  it('back on P0 later, box 2 shows the earlier choice; unticking it withdraws (DELETE), box 1 stays', async () => {
    const api = makeApi();
    await seedLocal({}, 'P0');
    const r = await renderFlow(api);
    await waitFor(() => r.getByTestId('consult-screen-P0'));
    await fireEvent.press(r.getByTestId('consent-checkbox'));
    await fireEvent.press(r.getByTestId('consent-ai-checkbox'));
    await fireEvent.press(r.getByTestId('consult-continue'));
    await waitFor(() => r.getByTestId('consult-screen-G1'));
    await waitFor(() => expect(api.grantRomanConsent).toHaveBeenCalledTimes(1));
    await fireEvent.press(r.getByTestId('consult-back'));
    await waitFor(() => r.getByTestId('consult-screen-P0'));
    expect(r.getByTestId('consent-checkbox').props.accessibilityState).toMatchObject({ checked: true });
    expect(r.getByTestId('consent-ai-checkbox').props.accessibilityState).toMatchObject({ checked: true });
    await fireEvent.press(r.getByTestId('consent-ai-checkbox'));
    await fireEvent.press(r.getByTestId('consult-continue'));
    await waitFor(() => r.getByTestId('consult-screen-G1'));
    await waitFor(() => expect(api.withdrawRomanConsent).toHaveBeenCalledTimes(1));
    expect(api.grantRomanConsent).toHaveBeenCalledTimes(1);
  });

  it('C-1: a double tap on Continue records the agreement and the optional grant once', async () => {
    const api = makeApi();
    await seedLocal({}, 'P0');
    const r = await renderFlow(api);
    await waitFor(() => r.getByTestId('consult-screen-P0'));
    await fireEvent.press(r.getByTestId('consent-checkbox'));
    await fireEvent.press(r.getByTestId('consent-ai-checkbox'));
    const cont = r.getByTestId('consult-continue');
    await act(async () => {
      fireEvent.press(cont);
      fireEvent.press(cont);
    });
    await waitFor(() => r.getByTestId('consult-screen-G1'));
    await waitFor(() => expect(api.grantRomanConsent).toHaveBeenCalledTimes(1));
    await tick();
    expect(api.save).toHaveBeenCalledTimes(1);
    expect(api.grantRomanConsent).toHaveBeenCalledTimes(1);
  });
});

// ── Fix round 3 (Opus final audit at 00cfb6c) ───────────────────────────────

const httpErr = (status: number, code?: string) =>
  Object.assign(new Error(String(status)), { response: { status, data: code ? { code } : {} } });
const offline = () => new Error('Network Error');

/** P0 from a seeded draft, both boxes ticked, Continue: lands on G1. */
async function continueWithBothBoxes(api: ConsultationApi, props: Partial<React.ComponentProps<typeof ConsultationFlow>> = {}) {
  await seedLocal({}, 'P0');
  const r = await renderFlow(api, props);
  await waitFor(() => r.getByTestId('consult-screen-P0'));
  await fireEvent.press(r.getByTestId('consent-checkbox'));
  await fireEvent.press(r.getByTestId('consent-ai-checkbox'));
  await fireEvent.press(r.getByTestId('consult-continue'));
  await waitFor(() => r.getByTestId('consult-screen-G1'));
  return r;
}

const aiBox = (r: { getByTestId: (id: string) => { props: { accessibilityState?: { checked?: boolean } } } }) =>
  r.getByTestId('consent-ai-checkbox').props.accessibilityState?.checked;

describe('B-310-1 the box 2 grant waits for the agreement to land', () => {
  it.each([
    ['offline', offline()],
    ['500', httpErr(500)],
    ['409 completion_in_progress', httpErr(409, 'completion_in_progress')],
  ])('P0 save fails (%s): no grant; the next save that lands the agreement sends it once', async (_label, err) => {
    const api = makeApi();
    api.save.mockRejectedValueOnce(err);
    const r = await continueWithBothBoxes(api);
    await tick();
    await tick();
    expect(api.save).toHaveBeenCalledTimes(1);
    expect(api.grantRomanConsent).not.toHaveBeenCalled();
    // Finish later saves again; this time the agreement lands, then the grant goes.
    await fireEvent.press(r.getByTestId('consult-finish-later'));
    await waitFor(() => expect(api.grantRomanConsent).toHaveBeenCalledTimes(1));
    const lastSave = api.save.mock.invocationCallOrder[api.save.mock.invocationCallOrder.length - 1];
    expect(lastSave).toBeLessThan(api.grantRomanConsent.mock.invocationCallOrder[0]);
    expect(Object.keys(api.save.mock.calls[1][0].answers)).toEqual(['P0']);
    await tick();
    expect(api.grantRomanConsent).toHaveBeenCalledTimes(1);
  });

  it('every save fails: the grant is never sent this session (left for Settings), and onboarding is not blocked', async () => {
    const api = makeApi({ save: jest.fn(async () => { throw offline(); }) });
    const r = await continueWithBothBoxes(api);
    await fireEvent.press(r.getByTestId('consult-finish-later'));
    await waitFor(() => r.getByTestId('consult-paused'));
    await tick();
    await tick();
    expect(api.save.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(api.grantRomanConsent).not.toHaveBeenCalled();
  });

  it('the agreement is rejected (P0-only PUT 409 consent_missing): the held grant is dropped, the client chooses again', async () => {
    const api = makeApi({ save: jest.fn(async () => { throw httpErr(409, 'consent_missing'); }) });
    await seedLocal({}, 'P0');
    const r = await renderFlow(api);
    await waitFor(() => r.getByTestId('consult-screen-P0'));
    await fireEvent.press(r.getByTestId('consent-checkbox'));
    await fireEvent.press(r.getByTestId('consent-ai-checkbox'));
    await fireEvent.press(r.getByTestId('consult-continue'));
    await waitFor(() => r.getByTestId('consent-error'));
    await tick();
    expect(api.grantRomanConsent).not.toHaveBeenCalled();
    expect(aiBox(r)).toBe(false);
  });

  it('a held grant is cancelled when the client unticks box 2 on a return to P0', async () => {
    const api = makeApi();
    api.save.mockRejectedValueOnce(offline());
    const r = await continueWithBothBoxes(api);
    await tick();
    await fireEvent.press(r.getByTestId('consult-back'));
    await waitFor(() => r.getByTestId('consult-screen-P0'));
    // B-310-3: box 2 shows the client's latest choice (yes, still waiting);
    // unticking it is the newer choice and cancels the held grant.
    expect(aiBox(r)).toBe(true);
    await fireEvent.press(r.getByTestId('consent-ai-checkbox'));
    expect(aiBox(r)).toBe(false);
    await fireEvent.press(r.getByTestId('consult-continue'));
    await waitFor(() => r.getByTestId('consult-screen-G1'));
    await fireEvent.press(r.getByTestId('consult-finish-later'));
    await waitFor(() => r.getByTestId('consult-paused'));
    await tick();
    expect(api.grantRomanConsent).not.toHaveBeenCalled();
    expect(api.withdrawRomanConsent).not.toHaveBeenCalled();
  });
});

describe('B-310-2 box 2 on P0 shows only confirmed results', () => {
  it('grant confirmed, app restarted, Back to P0: box 2 is ticked (from the draft); Continue sends nothing', async () => {
    const api = makeApi();
    const r1 = await continueWithBothBoxes(api);
    await waitFor(() => expect(api.grantRomanConsent).toHaveBeenCalledTimes(1));
    await tick();
    await tick();
    expect((await readLocalState('u1', NOW))?.aiRoman).toBe(true);
    const r = r1;
    await restartFlow(r, api);
    await waitFor(() => r.getByTestId('consult-screen-G1'));
    await fireEvent.press(r.getByTestId('consult-back'));
    await waitFor(() => r.getByTestId('consult-screen-P0'));
    expect(aiBox(r)).toBe(true);
    await fireEvent.press(r.getByTestId('consult-continue'));
    await waitFor(() => r.getByTestId('consult-screen-G1'));
    await tick();
    expect(api.grantRomanConsent).toHaveBeenCalledTimes(1);
    expect(api.withdrawRomanConsent).not.toHaveBeenCalled();
  });

  it('a grant that was never confirmed shows unticked after a restart', async () => {
    const api = makeApi({ grantRomanConsent: jest.fn(async () => ({ kind: 'error' as const, status: 500 })) });
    const r1 = await continueWithBothBoxes(api);
    await waitFor(() => expect(api.grantRomanConsent).toHaveBeenCalledTimes(2));
    await tick();
    const r = r1;
    await restartFlow(r, api);
    await waitFor(() => r.getByTestId('consult-screen-G1'));
    await fireEvent.press(r.getByTestId('consult-back'));
    await waitFor(() => r.getByTestId('consult-screen-P0'));
    expect(aiBox(r)).toBe(false);
  });

  it('GET /me/ai-consent is the truth when it answers: granted ticks box 2', async () => {
    const api = makeApi({ getRomanConsent: jest.fn(async () => ({ kind: 'ok' as const, status: AI_ALLOWED })) });
    await seedLocal({}, 'P0');
    const r = await renderFlow(api);
    await waitFor(() => r.getByTestId('consult-screen-P0'));
    await waitFor(() => expect(aiBox(r)).toBe(true));
  });

  it('GET /me/ai-consent is the truth when it answers: withdrawn unticks a draft that said allowed', async () => {
    const api = makeApi({ getRomanConsent: jest.fn(async () => ({ kind: 'ok' as const, status: aiStatus({ state: 'withdrawn', version: 'client-ai-v3' }) })) });
    await seedLocal({}, 'P0', { aiRoman: true });
    const r = await renderFlow(api);
    await waitFor(() => r.getByTestId('consult-screen-P0'));
    await waitFor(() => expect(aiBox(r)).toBe(false));
  });

  it('a late GET never overrides a box the client has just tapped; the latest choice is applied (B-310-3)', async () => {
    let answer: (v: AiConsentOutcome) => void = () => undefined;
    const api = makeApi({ getRomanConsent: jest.fn(() => new Promise<AiConsentOutcome>((res) => { answer = res; })) });
    // This phone last saw "not allowed"; a grant was made elsewhere since.
    await seedLocal({ P0: fullAnswers().P0 }, 'P0', { aiRoman: false });
    const r = await renderFlow(api);
    await waitFor(() => r.getByTestId('consult-screen-P0'));
    await fireEvent.press(r.getByTestId('consent-ai-checkbox'));
    await fireEvent.press(r.getByTestId('consent-ai-checkbox'));
    await fireEvent.press(r.getByTestId('consult-continue'));
    await waitFor(() => r.getByTestId('consult-screen-G1'));
    await act(async () => answer({ kind: 'ok', status: AI_ALLOWED }));
    await waitFor(() => expect(api.withdrawRomanConsent).toHaveBeenCalledTimes(1));
    await tick();
    expect(api.grantRomanConsent).not.toHaveBeenCalled();
    expect(api.withdrawRomanConsent).toHaveBeenCalledTimes(1);
    await fireEvent.press(r.getByTestId('consult-back'));
    await waitFor(() => r.getByTestId('consult-screen-P0'));
    expect(aiBox(r)).toBe(false);
    const saved = await readLocalState('u1', NOW);
    expect(saved?.aiRoman).toBe(false);
    expect(saved?.aiWant).toBeUndefined();
  });

  it('unticking on a return: DELETE with exactly one retry; still unconfirmed shows a calm notice, box 2 stays ticked', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const api = makeApi({ withdrawRomanConsent: jest.fn(async () => ({ kind: 'error' as const, status: 500 })) });
    await seedLocal({ P0: fullAnswers().P0 }, 'G1', { aiRoman: true });
    const r = await renderFlow(api);
    await waitFor(() => r.getByTestId('consult-screen-G1'));
    await fireEvent.press(r.getByTestId('consult-back'));
    await waitFor(() => r.getByTestId('consult-screen-P0'));
    expect(aiBox(r)).toBe(true);
    await fireEvent.press(r.getByTestId('consent-ai-checkbox'));
    await fireEvent.press(r.getByTestId('consult-continue'));
    await waitFor(() => r.getByTestId('consult-screen-G1'));
    await waitFor(() => expect(alert).toHaveBeenCalledWith(AI_WITHDRAW_NOTICE.title, AI_WITHDRAW_NOTICE.body));
    expect(api.withdrawRomanConsent).toHaveBeenCalledTimes(2);
    expect(AI_WITHDRAW_NOTICE.body).toMatch(/Settings > Privacy > Roman and AI\.$/);
    await fireEvent.press(r.getByTestId('consult-back'));
    await waitFor(() => r.getByTestId('consult-screen-P0'));
    expect(aiBox(r)).toBe(true);
    expect((await readLocalState('u1', NOW))?.aiRoman).toBe(true);
    alert.mockRestore();
  });

  it('a withdrawal confirmed on the retry: no notice, box 2 unticked from then on (draft too)', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const withdrawRomanConsent = jest
      .fn()
      .mockResolvedValueOnce({ kind: 'error', status: null })
      .mockResolvedValue({ kind: 'ok', status: aiStatus({ state: 'withdrawn' }) });
    const api = makeApi({ withdrawRomanConsent });
    await seedLocal({ P0: fullAnswers().P0 }, 'G1', { aiRoman: true });
    const r = await renderFlow(api);
    await waitFor(() => r.getByTestId('consult-screen-G1'));
    await fireEvent.press(r.getByTestId('consult-back'));
    await waitFor(() => r.getByTestId('consult-screen-P0'));
    await fireEvent.press(r.getByTestId('consent-ai-checkbox'));
    await fireEvent.press(r.getByTestId('consult-continue'));
    await waitFor(() => expect(withdrawRomanConsent).toHaveBeenCalledTimes(2));
    await tick();
    await tick();
    expect(alert).not.toHaveBeenCalled();
    await fireEvent.press(r.getByTestId('consult-back'));
    await waitFor(() => r.getByTestId('consult-screen-P0'));
    expect(aiBox(r)).toBe(false);
    expect((await readLocalState('u1', NOW))?.aiRoman).toBe(false);
    alert.mockRestore();
  });
});

describe('B-310-3 / C-310-6 / C-310-7 the latest box 2 choice wins', () => {
  it('B-310-3: a grant in flight when the client unticks on a return: exactly one DELETE after it; unticked from then on', async () => {
    let releaseGrant: (v: AiConsentOutcome) => void = () => undefined;
    const grantRomanConsent = jest.fn(() => new Promise<AiConsentOutcome>((res) => { releaseGrant = res; }));
    const api = makeApi({ grantRomanConsent });
    const r = await continueWithBothBoxes(api);
    await waitFor(() => expect(grantRomanConsent).toHaveBeenCalledTimes(1));
    await fireEvent.press(r.getByTestId('consult-back'));
    await waitFor(() => r.getByTestId('consult-screen-P0'));
    expect(aiBox(r)).toBe(true);
    await fireEvent.press(r.getByTestId('consent-ai-checkbox'));
    await fireEvent.press(r.getByTestId('consult-continue'));
    await waitFor(() => r.getByTestId('consult-screen-G1'));
    expect(api.withdrawRomanConsent).not.toHaveBeenCalled();
    await act(async () => releaseGrant({ kind: 'ok', status: AI_ALLOWED }));
    await waitFor(() => expect(api.withdrawRomanConsent).toHaveBeenCalledTimes(1));
    await tick();
    await tick();
    expect(api.withdrawRomanConsent).toHaveBeenCalledTimes(1);
    expect(grantRomanConsent).toHaveBeenCalledTimes(1);
    expect(grantRomanConsent.mock.invocationCallOrder[0]).toBeLessThan(api.withdrawRomanConsent.mock.invocationCallOrder[0]);
    const saved = await readLocalState('u1', NOW);
    expect(saved?.aiRoman).toBe(false);
    expect(saved?.aiWant).toBeUndefined();
    await fireEvent.press(r.getByTestId('consult-back'));
    await waitFor(() => r.getByTestId('consult-screen-P0'));
    expect(aiBox(r)).toBe(false);
  });

  it('B-310-3: the latest choice survives a restart: unticked, closed before the DELETE landed, sent on the next launch', async () => {
    const withdrawRomanConsent = jest
      .fn<Promise<AiConsentOutcome>, []>()
      .mockImplementationOnce(() => new Promise<AiConsentOutcome>(() => undefined))
      .mockResolvedValue({ kind: 'ok', status: aiStatus({ state: 'withdrawn', version: 'client-ai-v3' }) });
    const api = makeApi({ withdrawRomanConsent });
    await seedLocal({ P0: fullAnswers().P0 }, 'G1', { aiRoman: true });
    const r = await renderFlow(api);
    await waitFor(() => r.getByTestId('consult-screen-G1'));
    await fireEvent.press(r.getByTestId('consult-back'));
    await waitFor(() => r.getByTestId('consult-screen-P0'));
    await fireEvent.press(r.getByTestId('consent-ai-checkbox'));
    await fireEvent.press(r.getByTestId('consult-continue'));
    await waitFor(() => r.getByTestId('consult-screen-G1'));
    await waitFor(() => expect(withdrawRomanConsent).toHaveBeenCalledTimes(1));
    await tick();
    expect((await readLocalState('u1', NOW))?.aiWant).toBe(false);
    await restartFlow(r, api);
    await waitFor(() => expect(withdrawRomanConsent).toHaveBeenCalledTimes(2));
    await tick();
    await tick();
    const saved = await readLocalState('u1', NOW);
    expect(saved?.aiRoman).toBe(false);
    expect(saved?.aiWant).toBeUndefined();
    expect(api.grantRomanConsent).not.toHaveBeenCalled();
  });

  it('C-310-6: a grant that could not be saved says so calmly and points to Settings', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const api = makeApi({ grantRomanConsent: jest.fn(async (): Promise<AiConsentOutcome> => ({ kind: 'error', status: 500 })) });
    const r = await continueWithBothBoxes(api);
    await waitFor(() => expect(alert).toHaveBeenCalledWith(AI_GRANT_NOTICE.title, AI_GRANT_NOTICE.body));
    expect(api.grantRomanConsent).toHaveBeenCalledTimes(2);
    expect(AI_GRANT_NOTICE.body).toMatch(/not allowed yet.*Settings > Privacy > Roman and AI\.$/);
    expect(AI_GRANT_NOTICE.body).not.toMatch(/!|went wrong/);
    // Box 2 falls back to the confirmed state.
    await fireEvent.press(r.getByTestId('consult-back'));
    await waitFor(() => r.getByTestId('consult-screen-P0'));
    expect(aiBox(r)).toBe(false);
    alert.mockRestore();
  });

  it.each([404, 503] as const)('C-310-6: ledger %s stays silent (D2: skipped, left for Settings)', async (status) => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const api = makeApi({ grantRomanConsent: jest.fn(async (): Promise<AiConsentOutcome> => ({ kind: 'unavailable', status })) });
    await continueWithBothBoxes(api);
    await waitFor(() => expect(api.grantRomanConsent).toHaveBeenCalledTimes(1));
    await tick();
    await tick();
    expect(alert).not.toHaveBeenCalled();
    alert.mockRestore();
  });

  it('C-310-7: with nothing known on this phone, box 2 waits for GET /me/ai-consent; taps do nothing until it answers', async () => {
    let answer: (v: AiConsentOutcome) => void = () => undefined;
    const api = makeApi({ getRomanConsent: jest.fn(() => new Promise<AiConsentOutcome>((res) => { answer = res; })) });
    await seedLocal({}, 'P0');
    const r = await renderFlow(api);
    await waitFor(() => r.getByTestId('consult-screen-P0'));
    const box = () => r.getByTestId('consent-ai-checkbox').props.accessibilityState;
    expect(box()).toMatchObject({ checked: false, disabled: true, busy: true });
    await fireEvent.press(r.getByTestId('consent-ai-checkbox'));
    expect(box().checked).toBe(false);
    // Box 1 is never held up.
    await fireEvent.press(r.getByTestId('consent-checkbox'));
    expect(r.getByTestId('consent-checkbox').props.accessibilityState?.checked).toBe(true);
    await act(async () => answer({ kind: 'ok', status: AI_ALLOWED }));
    await waitFor(() => expect(box()).toMatchObject({ checked: true }));
    expect(box().disabled).toBeFalsy();
  });

  it('C-310-7: if GET /me/ai-consent does not answer, box 2 becomes tappable after the wait', async () => {
    const api = makeApi({ getRomanConsent: jest.fn(() => new Promise<AiConsentOutcome>(() => undefined)) });
    await seedLocal({}, 'P0');
    const r = await renderFlow(api);
    await waitFor(() => r.getByTestId('consult-screen-P0'));
    expect(r.getByTestId('consent-ai-checkbox').props.accessibilityState?.disabled).toBe(true);
    await act(async () => {
      await new Promise((res) => setTimeout(res, AI_STATUS_WAIT_MS + 50));
    });
    expect(r.getByTestId('consent-ai-checkbox').props.accessibilityState?.disabled).toBeFalsy();
    await fireEvent.press(r.getByTestId('consent-ai-checkbox'));
    expect(aiBox(r)).toBe(true);
  }, 15000);

  it('C-310-7: a phone that already knows the choice shows box 2 tappable at once', async () => {
    const api = makeApi({ getRomanConsent: jest.fn(() => new Promise<AiConsentOutcome>(() => undefined)) });
    await seedLocal({ P0: fullAnswers().P0 }, 'P0', { aiRoman: true });
    const r = await renderFlow(api);
    await waitFor(() => r.getByTestId('consult-screen-P0'));
    expect(r.getByTestId('consent-ai-checkbox').props.accessibilityState).toMatchObject({ checked: true });
    expect(r.getByTestId('consent-ai-checkbox').props.accessibilityState?.disabled).toBeFalsy();
  });

  it.each([
    ['the same user is still signed in', 'u1', 2],
    ['a different user signed in', 'u2', 1],
    ['nobody is signed in', null, 1],
  ] as const)('after the hand-off, a queued box 2 step still runs only when %s', async (_label, sessionUser, grants) => {
    let releaseGrant: (v: AiConsentOutcome) => void = () => undefined;
    const grantRomanConsent = jest
      .fn<Promise<AiConsentOutcome>, []>()
      .mockImplementationOnce(() => new Promise<AiConsentOutcome>((res) => { releaseGrant = res; }))
      .mockResolvedValue({ kind: 'ok', status: AI_ALLOWED });
    const sessionUserId = jest.fn(() => sessionUser);
    const api = { ...makeApi({ grantRomanConsent }), sessionUserId };
    const onFinished = jest.fn();
    // The client chose yes on P0; the grant waits for the save at Prepare.
    await seedLocal(fullAnswers(), 'SUM', { aiWant: true });
    const r = await renderFlow(api, { onFinished });
    await waitFor(() => r.getByTestId('consult-screen-SUM'));
    await fireEvent.press(r.getByTestId('consult-prepare'));
    await waitFor(() => expect(grantRomanConsent).toHaveBeenCalledTimes(1));
    await waitFor(() => r.getByTestId('consult-screen-MACRO'));
    await fireEvent.press(r.getByTestId('consult-macro-next'));
    await waitFor(() => r.getByTestId('consult-screen-PLAN'));
    await fireEvent.press(r.getByTestId('consult-finish'));
    await waitFor(() => expect(onFinished).toHaveBeenCalled());
    // The app replaces the consultation with the client app.
    await r.rerender(<View testID="client-app" />);
    expect(r.queryByTestId('consult-screen-PLAN')).toBeNull();
    // The first attempt fails after the flow has gone; its one retry is sent
    // only while the same client is signed in.
    await act(async () => releaseGrant({ kind: 'error', status: null }));
    await tick();
    await tick();
    expect(grantRomanConsent).toHaveBeenCalledTimes(grants);
  });
});

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
    await waitFor(() => r.getByTestId('consult-problem-not_attached'));
    expect(r.getByTestId('consult-problem-action')).toBeTruthy();
    await fireEvent.press(r.getByTestId('consult-support'));
    expect(SUPPORT_EMAIL).toBe('Bradley@Bradleytgpcoaching.com');
    expect(open).toHaveBeenCalledWith(expect.stringMatching(/^mailto:Bradley@Bradleytgpcoaching\.com\?subject=/));
    await fireEvent.press(r.getByTestId('consult-sign-out'));
    expect(onSignOut).not.toHaveBeenCalled(); // asks first
    const buttons = (alert.mock.calls[alert.mock.calls.length - 1][2] ?? []) as AlertButton[];
    buttons.find((b) => b.style === 'destructive')?.onPress?.();
    expect(onSignOut).toHaveBeenCalledTimes(1);
    open.mockRestore();
    alert.mockRestore();
  });

  it('C-310-3: the paused screen has the same way out', async () => {
    const r = await continueWithBothBoxes(makeApi(), { onSignOut: jest.fn() });
    await fireEvent.press(r.getByTestId('consult-finish-later'));
    await waitFor(() => r.getByTestId('consult-paused'));
    expect(r.getByTestId('consult-resume')).toBeTruthy();
    expect(r.getByTestId('consult-support')).toBeTruthy();
    expect(r.getByTestId('consult-sign-out')).toBeTruthy();
  });

  it('C-310-3: without a sign-out handler only Contact support shows', async () => {
    const r = await continueWithBothBoxes(makeApi());
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
