/**
 * Privacy regressions for the PR #310 fix round (Sol audit A-01 to A-04).
 * Each block re-runs the audit's probe against the fixed code and asserts
 * the fixed behaviour.
 *
 *   A-01  no consultation content reaches PostHog touch autocapture
 *   A-02  nothing is sent to the server before the P0 agreement is recorded
 *   A-03  consent must match the displayed copy version; stale, malformed and
 *         revoked records and server version bumps fail closed
 *   A-04  the draft is encrypted, bounded, and purged on sign-out with
 *         late writes fenced
 */
import * as path from 'path';
import React from 'react';
import { Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import ConsultationFlow, { ConsultationApi } from '../ConsultationFlow';
import type { CompleteOutcome } from '../../../api/consultationApi';
import { answersBeforeSafety, fullAnswers, NOW } from '../../../lib/consultation/__fixtures__/consultFixtures';
import { consentStatus, makeApi, NOT_GRANTED, resetStores, seedLocal } from '../../../lib/consultation/__fixtures__/flowHarness';
import {
  DRAFT_CHUNK_CHARS,
  DRAFT_RETENTION_MS,
  legacyStorageKey,
  manifestKey,
  openDraft,
  purgeConsultationDraft,
  readLocalState,
  writeDraft,
  writeLocalState,
} from '../../../lib/consultation/storage';
import { signOut } from '../../../services/authActions';
import { CONSULT_CONSENT_COPY_VERSION } from '../../../lib/consultation/copy';

jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: {},
  usersApi: { updatePushToken: jest.fn(async () => ({ data: {} })) },
  profileApi: { get: jest.fn(async () => ({ data: {} })) },
}));
jest.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('../../../services/sentry', () => ({ setSentryUser: jest.fn() }));
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

function renderFlow(api: ConsultationApi, props: Partial<React.ComponentProps<typeof ConsultationFlow>> = {}) {
  return render(
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
    />,
  );
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

describe('A-02 agreement before any upload', () => {
  it('first run: W1 leads to P0 and nothing is sent until the box is ticked and recorded', async () => {
    const api = makeApi();
    const r = await renderFlow(api);
    await waitFor(() => r.getByTestId('consult-screen-W1'));
    await fireEvent.press(r.getByTestId('consult-continue'));
    await waitFor(() => r.getByTestId('consult-screen-P0'));
    expect(api.save).not.toHaveBeenCalled();
    expect(api.grantOnboardingConsent).not.toHaveBeenCalled();
    await fireEvent.press(r.getByTestId('consent-checkbox'));
    await fireEvent.press(r.getByTestId('consult-continue'));
    await waitFor(() => r.getByTestId('consult-screen-G1'));
    expect(api.grantOnboardingConsent).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
    expect(api.grantOnboardingConsent.mock.invocationCallOrder[0]).toBeLessThan(api.save.mock.invocationCallOrder[0]);
  });

  it('a failed or missing consent endpoint keeps the client on P0 and sends nothing', async () => {
    for (const status of [null, 404, 500]) {
      await resetStores();
      const api = makeApi({ grantOnboardingConsent: jest.fn(async () => ({ kind: 'error' as const, status })) });
      await seedLocal({}, 'P0');
      const r = await renderFlow(api);
      await waitFor(() => r.getByTestId('consult-screen-P0'));
      await fireEvent.press(r.getByTestId('consent-checkbox'));
      await fireEvent.press(r.getByTestId('consult-continue'));
      await waitFor(() => r.getByTestId('consent-error'));
      expect(r.getByTestId('consult-screen-P0')).toBeTruthy();
      expect(api.save).not.toHaveBeenCalled();
      r.unmount();
    }
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

  it('an agreement that cannot be verified holds every chapter save', async () => {
    const api = makeApi({ getConsentStatus: jest.fn(async () => { throw new Error('offline'); }) });
    await seedLocal(answersBeforeSafety(), 'T4');
    const r = await renderFlow(api);
    await waitFor(() => r.getByTestId('consult-screen-T4'));
    await fireEvent.press(r.getByTestId('consult-chip-30_45'));
    await waitFor(() => r.getByTestId('consult-screen-S1'));
    await act(async () => { await new Promise((res) => setTimeout(res, 0)); });
    expect(api.save).not.toHaveBeenCalled();
  });
});

describe('A-02 consent-first PUT (backend #607)', () => {
  const conflict = (code: string) => Object.assign(new Error('409'), { response: { status: 409, data: { code } } });
  const P0 = fullAnswers().P0;

  it('the first PUT after W1 carries P0 alone, with the displayed copy version', async () => {
    const api = makeApi();
    const r = await renderFlow(api);
    await waitFor(() => r.getByTestId('consult-screen-W1'));
    await fireEvent.press(r.getByTestId('consult-continue'));
    await waitFor(() => r.getByTestId('consult-screen-P0'));
    await fireEvent.press(r.getByTestId('consent-checkbox'));
    await fireEvent.press(r.getByTestId('consult-continue'));
    await waitFor(() => r.getByTestId('consult-screen-G1'));
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
    const first = api.save.mock.calls[0][0];
    expect(Object.keys(first.answers)).toEqual(['P0']);
    expect(first.answers.P0).toMatchObject({ agreed: true, copy_version: 'consult-consent-v1' });
    expect(first.answers.P0.copy_version).toBe(CONSULT_CONSENT_COPY_VERSION);
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
    const api = makeApi({
      getState: jest.fn(async () => ({ answers: { P0 }, completed: false, consent_recorded: true, saved_at: '2026-09-30T18:00:00Z', revision: 1 })),
    });
    await seedLocal(answersBeforeSafety(), 'N3', { dirty: true, editedAt: '2026-09-30T19:00:00Z', synced: { saved_at: '2026-09-30T18:00:00Z', revision: 1 } });
    const r = await renderFlow(api);
    await waitFor(() => r.getByTestId('consult-screen-N3'));
    await fireEvent.press(r.getByTestId('consult-finish-later'));
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
    expect(Object.keys(api.save.mock.calls[0][0].answers).length).toBeGreaterThan(1);
  });

  it('409 consent_missing on a save routes back to the agreement, unticked, and stops uploading', async () => {
    const save = jest.fn(async () => { throw conflict('consent_missing'); });
    const api = makeApi({ save });
    await seedLocal(answersBeforeSafety(), 'N3');
    const r = await renderFlow(api);
    await waitFor(() => r.getByTestId('consult-screen-N3'));
    await fireEvent.press(r.getByTestId('consult-finish-later'));
    await waitFor(() => r.getByTestId('consult-screen-P0'));
    expect(r.getByTestId('consent-checkbox').props.accessibilityState).toMatchObject({ checked: false });
    expect(save).toHaveBeenCalledTimes(1);
    expect(Object.keys((save.mock.calls[0] as unknown as [{ answers: object }])[0].answers)).toEqual(['P0']);
    expect((await readLocalState('u1', NOW))?.answers.P0).toBeUndefined();
  });

  it('409 consent_missing on the final save at Prepare shows the agreement problem, not completion', async () => {
    const save = jest.fn(async () => { throw conflict('consent_missing'); });
    const api = makeApi({ save });
    await seedLocal(fullAnswers(), 'SUM');
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

  it('audit probe: a stale copy version resumes at P0 unticked and is never re-granted', async () => {
    const api = makeApi({
      complete: jest.fn(async (): Promise<CompleteOutcome> => ({ kind: 'conflict', code: 'consent_missing' })),
    });
    await seedLocal(fullAnswers({ P0: stale }), 'SUM');
    const r = await renderFlow(api);
    await waitFor(() => r.getByTestId('consult-screen-P0'));
    expect(r.queryByTestId('consult-screen-SUM')).toBeNull();
    expect(r.getByTestId('consent-checkbox').props.accessibilityState).toMatchObject({ checked: false });
    expect(r.getByTestId('consult-continue').props.accessibilityState).toMatchObject({ disabled: true });
    expect(api.grantOnboardingConsent).not.toHaveBeenCalled();
    expect(api.save).not.toHaveBeenCalled();
  });

  it('malformed records route to P0 unticked', async () => {
    for (const P0 of ['yes', { agreed: 'true' }, { agreed: true }, ['agreed']] as never[]) {
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

  it('a revoked grant on the server sends the client back to P0 and is not silently undone', async () => {
    const api = makeApi({
      getConsentStatus: jest.fn(async () =>
        consentStatus({ granted: false, revoked_at: '2026-09-30T19:30:00.000Z' }),
      ),
    });
    await seedLocal(fullAnswers(), 'SUM');
    const r = await renderFlow(api);
    await waitFor(() => r.getByTestId('consult-screen-P0'));
    expect(r.getByTestId('consent-checkbox').props.accessibilityState).toMatchObject({ checked: false });
    expect(api.grantOnboardingConsent).not.toHaveBeenCalled();
    expect(api.save).not.toHaveBeenCalled();
    expect(api.complete).not.toHaveBeenCalled();
  });

  it('a revocation made after resume is honoured at Prepare: nothing saved, completed or re-granted', async () => {
    const getConsentStatus = jest.fn().mockResolvedValueOnce(consentStatus()).mockResolvedValue(NOT_GRANTED);
    const api = makeApi({ getConsentStatus });
    await seedLocal(fullAnswers(), 'SUM');
    const r = await renderFlow(api);
    await waitFor(() => r.getByTestId('consult-screen-SUM'));
    await fireEvent.press(r.getByTestId('consult-prepare'));
    await waitFor(() => r.getByTestId('consult-problem-consent_missing'));
    expect(api.save).not.toHaveBeenCalled();
    expect(api.complete).not.toHaveBeenCalled();
    expect(api.grantOnboardingConsent).not.toHaveBeenCalled();
    await fireEvent.press(r.getByTestId('consult-problem-action'));
    await waitFor(() => r.getByTestId('consult-screen-P0'));
    expect(r.getByTestId('consent-checkbox').props.accessibilityState).toMatchObject({ checked: false });
  });

  it('a server version bump fails closed with an update message', async () => {
    const api = makeApi({ getConsentStatus: jest.fn(async () => consentStatus({ current_version: 'client-ai-v3', needs_reconsent: true })) });
    await seedLocal(fullAnswers(), 'SUM');
    const r = await renderFlow(api);
    await waitFor(() => r.getByTestId('consult-screen-P0'));
    expect(r.getByTestId('consent-error').props.children).toMatch(/update the app/);
    await fireEvent.press(r.getByTestId('consent-checkbox'));
    expect(r.getByTestId('consult-continue').props.accessibilityState).toMatchObject({ disabled: true });
    expect(api.grantOnboardingConsent).not.toHaveBeenCalled();
    expect(api.save).not.toHaveBeenCalled();
  });

  it('409 CONSENT_VERSION_MISMATCH on the grant clears the box and sends nothing', async () => {
    const api = makeApi({
      grantOnboardingConsent: jest.fn(async () => ({ kind: 'version_mismatch' as const, current_version: 'client-ai-v3', waiver_current_version: 'pt-waiver-v1' })),
    });
    await seedLocal({}, 'P0');
    const r = await renderFlow(api);
    await waitFor(() => r.getByTestId('consult-screen-P0'));
    await fireEvent.press(r.getByTestId('consent-checkbox'));
    await fireEvent.press(r.getByTestId('consult-continue'));
    await waitFor(() => r.getByTestId('consent-error'));
    expect(r.getByTestId('consent-checkbox').props.accessibilityState).toMatchObject({ checked: false });
    expect(r.getByTestId('consult-screen-P0')).toBeTruthy();
    expect(api.save).not.toHaveBeenCalled();
    const stored = await readLocalState('u1', NOW);
    expect(stored?.answers.P0).toBeUndefined();
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
    expect(api.grantOnboardingConsent).not.toHaveBeenCalled();
    await fireEvent.press(r.getByTestId('consult-problem-action'));
    await waitFor(() => r.getByTestId('consult-screen-P0'));
    expect(r.getByTestId('consent-checkbox').props.accessibilityState).toMatchObject({ checked: false });
  });
});

// ── A-04 ─────────────────────────────────────────────────────────────────────

describe('A-04 encrypted, bounded, purged draft', () => {
  const secure = SecureStore as unknown as { __store: Map<string, string> };
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
