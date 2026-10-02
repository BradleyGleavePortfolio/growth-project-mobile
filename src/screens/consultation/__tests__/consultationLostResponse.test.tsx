/**
 * Sol B-310-5: a lost grant response must not defeat a newer "no" to box 2.
 *
 * The ledger is modelled as a small server: a grant commits before its
 * response is lost (no response at all, as when the connection drops after
 * the server wrote), a DELETE is idempotent. Every case ends by checking the
 * server's own state, not only what the app shows: after the client's latest
 * "no", the server must hold no grant, whatever happened to the responses,
 * across completion and unmount, an app restart, the client app opening, and
 * Settings > Privacy > Roman and AI.
 */
import React from 'react';
import { Alert, Text, type AlertButton } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import ConsultationFlow, { ConsultationApi } from '../ConsultationFlow';
import RomanAiConsentScreen, { ROMAN_AI_COPY } from '../../settings/RomanAiConsentScreen';
import type { AiConsentOutcome } from '../../../api/aiConsentApi';
import { fullAnswers, NOW } from '../../../lib/consultation/__fixtures__/consultFixtures';
import { AI_ALLOWED, aiStatus, makeApi, resetStores, seedLocal } from '../../../lib/consultation/__fixtures__/flowHarness';
import { readLocalState } from '../../../lib/consultation/storage';
import {
  aiWithdrawalPendingKey,
  grantRomanWithRetry,
  isAmbiguousWriteOutcome,
  markAiWithdrawalPending,
  resetAiLedgerWritesForTests,
} from '../../../lib/consultation/aiConsent';
import {
  AI_GRANT_UNCONFIRMED_NOTICE,
  AI_WITHDRAW_NOTICE,
  AI_WITHDRAW_UNCONFIRMED_LINE,
} from '../../../lib/consultation/copy';
import { useAiWithdrawalDrain, type AiWithdrawalDrainDeps } from '../../../hooks/useAiWithdrawalDrain';

jest.mock('../../../services/api', () => ({ __esModule: true, default: {} }));
jest.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('../../../services/sentry', () => ({ setSentryUser: jest.fn(), captureError: jest.fn() }));
jest.mock('../../../lib/userCache', () => ({
  readUserCacheSync: jest.fn(() => ({ id: 'u1' })),
  readUserCache: jest.fn(async () => null),
}));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'u1' }) }));
jest.mock('../../../tutorial/tutorialStore', () => ({ startClientTutorial: jest.fn(() => true) }));

const LOST: AiConsentOutcome = { kind: 'error', status: null };
const WITHDRAWN: AiConsentOutcome = { kind: 'ok', status: aiStatus({ state: 'withdrawn', version: 'client-ai-v3' }) };

/** The ledger as the server sees it. */
function ledger() {
  const server = { granted: false, grants: 0, withdrawals: 0 };
  return {
    server,
    /** Commits, then the response is lost. */
    lostGrant: async (): Promise<AiConsentOutcome> => {
      server.grants += 1;
      server.granted = true;
      return LOST;
    },
    okWithdraw: async (): Promise<AiConsentOutcome> => {
      server.withdrawals += 1;
      server.granted = false;
      return WITHDRAWN;
    },
  };
}

function flowElement(api: ConsultationApi, onFinished = jest.fn()) {
  return (
    <ConsultationFlow
      userId="u1"
      firstName="Maya"
      coachName="Bradley"
      api={api}
      onFinished={onFinished}
      now={() => NOW}
      autoAdvanceMs={0}
      prepMinMs={0}
    />
  );
}

const tick = () => act(async () => { await new Promise((res) => setTimeout(res, 0)); });
const aiBox = (r: { getByTestId: (id: string) => { props: { accessibilityState?: { checked?: boolean } } } }) =>
  r.getByTestId('consent-ai-checkbox').props.accessibilityState?.checked;
const pendingMarker = () => AsyncStorage.getItem(aiWithdrawalPendingKey('u1'));

/** Fresh install: tick both boxes on P0 and Continue to G1. */
async function continueWithBothBoxes(api: ConsultationApi) {
  await seedLocal({}, 'P0');
  const r = await render(flowElement(api));
  await waitFor(() => r.getByTestId('consult-screen-P0'));
  await fireEvent.press(r.getByTestId('consent-checkbox'));
  await fireEvent.press(r.getByTestId('consent-ai-checkbox'));
  await fireEvent.press(r.getByTestId('consult-continue'));
  await waitFor(() => r.getByTestId('consult-screen-G1'));
  return r;
}

/** Back to P0, untick box 2, Continue. */
async function untickOnReturn(r: Awaited<ReturnType<typeof continueWithBothBoxes>>) {
  await fireEvent.press(r.getByTestId('consult-back'));
  await waitFor(() => r.getByTestId('consult-screen-P0'));
  expect(aiBox(r)).toBe(true);
  await fireEvent.press(r.getByTestId('consent-ai-checkbox'));
  await fireEvent.press(r.getByTestId('consult-continue'));
  await waitFor(() => r.getByTestId('consult-screen-G1'));
}

let alert: jest.SpyInstance;
beforeEach(async () => {
  await resetStores();
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(() => alert.mockRestore());

describe('B-310-5 grant retry and the ambiguity rule (unit)', () => {
  it('a lost response, timeout, 5xx or conflict is ambiguous; a 4xx refusal is not', () => {
    expect(isAmbiguousWriteOutcome(LOST)).toBe(true);
    expect(isAmbiguousWriteOutcome({ kind: 'error', status: 408 })).toBe(true);
    expect(isAmbiguousWriteOutcome({ kind: 'error', status: 409, code: 'AI_CONSENT_CONFLICT' })).toBe(true);
    expect(isAmbiguousWriteOutcome({ kind: 'error', status: 502 })).toBe(true);
    for (const status of [400, 401, 403, 429]) expect(isAmbiguousWriteOutcome({ kind: 'error', status })).toBe(false);
    expect(isAmbiguousWriteOutcome({ kind: 'unavailable', status: 503 })).toBe(false);
    expect(isAmbiguousWriteOutcome({ kind: 'ok', status: null })).toBe(false);
  });

  it('a lost answer makes the result unconfirmed, even when the retry is then refused', async () => {
    const l = ledger();
    await expect(grantRomanWithRetry(jest.fn(l.lostGrant))).resolves.toBe('unconfirmed');
    const thenRefused = jest.fn<Promise<AiConsentOutcome>, []>().mockResolvedValueOnce(LOST).mockResolvedValueOnce({ kind: 'error', status: 400 });
    await expect(grantRomanWithRetry(thenRefused)).resolves.toBe('unconfirmed');
    const thenOk = jest.fn<Promise<AiConsentOutcome>, []>().mockResolvedValueOnce(LOST).mockResolvedValueOnce({ kind: 'ok', status: AI_ALLOWED });
    await expect(grantRomanWithRetry(thenOk)).resolves.toBe('granted');
    await expect(grantRomanWithRetry(jest.fn(async (): Promise<AiConsentOutcome> => ({ kind: 'error', status: 403 })))).resolves.toBe('failed');
  });

  it('the retry never goes out once a newer choice stops it; the sent attempt still counts', async () => {
    let wantYes = true;
    const grant = jest.fn(async (): Promise<AiConsentOutcome> => {
      wantYes = false;
      return LOST;
    });
    await expect(grantRomanWithRetry(grant, () => wantYes)).resolves.toBe('unconfirmed');
    expect(grant).toHaveBeenCalledTimes(1);
  });
});

describe('B-310-5 a lost grant response never defeats a newer no', () => {
  it("Sol's probe: grant committed, response lost, client unticks on a return: no retry after the no, one DELETE behind the POST, server holds no grant", async () => {
    const l = ledger();
    let release: () => void = () => undefined;
    const grantRomanConsent = jest.fn(
      () => new Promise<AiConsentOutcome>((res) => { release = () => void l.lostGrant().then(res); }),
    );
    const withdrawRomanConsent = jest.fn(l.okWithdraw);
    const api = makeApi({ grantRomanConsent, withdrawRomanConsent });
    const r = await continueWithBothBoxes(api);
    await waitFor(() => expect(grantRomanConsent).toHaveBeenCalledTimes(1));
    await untickOnReturn(r);
    expect(withdrawRomanConsent).not.toHaveBeenCalled();
    await act(async () => release());
    await waitFor(() => expect(withdrawRomanConsent).toHaveBeenCalledTimes(1));
    await tick();
    await tick();
    // The no came after the first attempt: its retry is never sent.
    expect(grantRomanConsent).toHaveBeenCalledTimes(1);
    expect(grantRomanConsent.mock.invocationCallOrder[0]).toBeLessThan(withdrawRomanConsent.mock.invocationCallOrder[0]);
    expect(l.server).toEqual({ granted: false, grants: 1, withdrawals: 1 });
    const saved = await readLocalState('u1', NOW);
    expect(saved?.aiRoman).toBe(false);
    expect(saved?.aiWant).toBeUndefined();
    expect(saved?.aiAttempted).toBeUndefined();
    expect(await pendingMarker()).toBeNull();
    expect(alert).not.toHaveBeenCalled();
    await fireEvent.press(r.getByTestId('consult-back'));
    await waitFor(() => r.getByTestId('consult-screen-P0'));
    expect(aiBox(r)).toBe(false);
    expect(r.queryByTestId('consent-ai-unconfirmed')).toBeNull();
  });

  it('both grant answers lost before the return: box 2 still shows yes (never unticked over a possible grant); unticking withdraws it', async () => {
    const l = ledger();
    const grantRomanConsent = jest.fn(l.lostGrant);
    const withdrawRomanConsent = jest.fn(l.okWithdraw);
    const api = makeApi({ grantRomanConsent, withdrawRomanConsent });
    const r = await continueWithBothBoxes(api);
    await waitFor(() => expect(grantRomanConsent).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(alert).toHaveBeenCalledWith(AI_GRANT_UNCONFIRMED_NOTICE.title, AI_GRANT_UNCONFIRMED_NOTICE.body));
    expect(l.server.granted).toBe(true);
    await untickOnReturn(r);
    await waitFor(() => expect(withdrawRomanConsent).toHaveBeenCalledTimes(1));
    await tick();
    expect(grantRomanConsent).toHaveBeenCalledTimes(2);
    expect(l.server.granted).toBe(false);
    expect(await pendingMarker()).toBeNull();
  });

  it('a no while nothing can be on file sends nothing (no grant attempted, none confirmed)', async () => {
    const api = makeApi();
    await seedLocal({ P0: fullAnswers().P0 }, 'G1', { aiRoman: false });
    const r = await render(flowElement(api));
    await waitFor(() => r.getByTestId('consult-screen-G1'));
    await fireEvent.press(r.getByTestId('consult-back'));
    await waitFor(() => r.getByTestId('consult-screen-P0'));
    await fireEvent.press(r.getByTestId('consent-ai-checkbox'));
    await fireEvent.press(r.getByTestId('consent-ai-checkbox'));
    await fireEvent.press(r.getByTestId('consult-continue'));
    await waitFor(() => r.getByTestId('consult-screen-G1'));
    await tick();
    expect(api.withdrawRomanConsent).not.toHaveBeenCalled();
    expect(api.grantRomanConsent).not.toHaveBeenCalled();
  });

  it('withdrawal not confirmed: kept as wanted, P0 says "not confirmed", one notice; a save that lands once online retries it', async () => {
    const l = ledger();
    let online = false;
    const withdrawRomanConsent = jest.fn(async (): Promise<AiConsentOutcome> => {
      if (!online) return { kind: 'error', status: 500 };
      return l.okWithdraw();
    });
    const api = makeApi({ grantRomanConsent: jest.fn(l.lostGrant), withdrawRomanConsent });
    const r = await continueWithBothBoxes(api);
    await waitFor(() => expect(api.grantRomanConsent).toHaveBeenCalledTimes(2));
    await untickOnReturn(r);
    await waitFor(() => expect(alert).toHaveBeenCalledWith(AI_WITHDRAW_NOTICE.title, AI_WITHDRAW_NOTICE.body));
    await tick();
    await tick();
    // DELETE with exactly one retry; the P0 save that landed meanwhile does not double it.
    expect(withdrawRomanConsent).toHaveBeenCalledTimes(2);
    expect(l.server.granted).toBe(true);
    expect((await readLocalState('u1', NOW))?.aiWant).toBe(false);
    expect(await pendingMarker()).not.toBeNull();
    await fireEvent.press(r.getByTestId('consult-back'));
    await waitFor(() => r.getByTestId('consult-screen-P0'));
    expect(aiBox(r)).toBe(false);
    expect(r.getByTestId('consent-ai-unconfirmed').props.children).toBe(AI_WITHDRAW_UNCONFIRMED_LINE);
    expect(AI_WITHDRAW_UNCONFIRMED_LINE).not.toMatch(/!|\bis off\b|went wrong/);
    // Back online: Continue saves P0 again, the save lands and the withdrawal goes out.
    online = true;
    await fireEvent.press(r.getByTestId('consult-continue'));
    await waitFor(() => r.getByTestId('consult-screen-G1'));
    await waitFor(() => expect(withdrawRomanConsent).toHaveBeenCalledTimes(3));
    await tick();
    await tick();
    expect(l.server.granted).toBe(false);
    expect(await pendingMarker()).toBeNull();
    expect((await readLocalState('u1', NOW))?.aiWant).toBeUndefined();
    // The notice was shown once, not again for each failure.
    expect(alert.mock.calls.filter((c) => c[0] === AI_WITHDRAW_NOTICE.title && c[1] === AI_WITHDRAW_NOTICE.body)).toHaveLength(1);
  });

  it('restart: closed before the DELETE landed; the next launch withdraws (grant attempted, never confirmed)', async () => {
    const l = ledger();
    // The first DELETE is still on the wire when the app is closed; its answer never reaches this process.
    let lostDelete: (v: AiConsentOutcome) => void = () => undefined;
    const withdrawRomanConsent = jest
      .fn<Promise<AiConsentOutcome>, []>()
      .mockImplementationOnce(() => new Promise<AiConsentOutcome>((res) => { lostDelete = res; }))
      .mockImplementation(l.okWithdraw);
    const api = makeApi({ grantRomanConsent: jest.fn(l.lostGrant), withdrawRomanConsent });
    const r = await continueWithBothBoxes(api);
    await waitFor(() => expect(api.grantRomanConsent).toHaveBeenCalledTimes(2));
    await untickOnReturn(r);
    await waitFor(() => expect(withdrawRomanConsent).toHaveBeenCalledTimes(1));
    await tick();
    const before = await readLocalState('u1', NOW);
    expect(before?.aiWant).toBe(false);
    expect(before?.aiAttempted).toBe(true);
    expect(before?.aiRoman).toBeUndefined();
    // App restart: a new process (empty write queue), the flow mounts afresh.
    await r.unmount();
    resetAiLedgerWritesForTests();
    const r2 = await render(flowElement(api));
    await waitFor(() => expect(withdrawRomanConsent).toHaveBeenCalledTimes(2));
    await tick();
    await tick();
    expect(l.server.granted).toBe(false);
    expect(api.grantRomanConsent).toHaveBeenCalledTimes(2);
    const after = await readLocalState('u1', NOW);
    expect(after?.aiRoman).toBe(false);
    expect(after?.aiWant).toBeUndefined();
    expect(after?.aiAttempted).toBeUndefined();
    expect(await pendingMarker()).toBeNull();
    await r2.unmount();
    await act(async () => lostDelete(LOST));
  });

  it('restart: a draft that lost its last write still withdraws from the per-user marker', async () => {
    const l = ledger();
    l.server.granted = true;
    const api = makeApi({ withdrawRomanConsent: jest.fn(l.okWithdraw) });
    await seedLocal({ P0: fullAnswers().P0 }, 'G1');
    await markAiWithdrawalPending('u1');
    const r = await render(flowElement(api));
    await waitFor(() => expect(api.withdrawRomanConsent).toHaveBeenCalledTimes(1));
    await tick();
    expect(l.server.granted).toBe(false);
    expect(await pendingMarker()).toBeNull();
    await r.unmount();
  });

  it('a newer yes supersedes a pending no: the marker is cleared and the old no is never sent', async () => {
    const api = makeApi({ grantRomanConsent: jest.fn(async (): Promise<AiConsentOutcome> => ({ kind: 'ok', status: AI_ALLOWED })) });
    await seedLocal({ P0: fullAnswers().P0 }, 'G1', { aiWant: false, aiAttempted: true });
    await markAiWithdrawalPending('u1');
    let releaseDelete: (v: AiConsentOutcome) => void = () => undefined;
    api.withdrawRomanConsent.mockImplementationOnce(() => new Promise<AiConsentOutcome>((res) => { releaseDelete = res; }));
    const r = await render(flowElement(api));
    await waitFor(() => expect(api.withdrawRomanConsent).toHaveBeenCalledTimes(1));
    await waitFor(() => r.getByTestId('consult-screen-G1'));
    await fireEvent.press(r.getByTestId('consult-back'));
    await waitFor(() => r.getByTestId('consult-screen-P0'));
    expect(aiBox(r)).toBe(false);
    await fireEvent.press(r.getByTestId('consent-ai-checkbox'));
    await fireEvent.press(r.getByTestId('consult-continue'));
    await waitFor(() => r.getByTestId('consult-screen-G1'));
    await tick();
    expect(await pendingMarker()).toBeNull();
    await act(async () => releaseDelete({ kind: 'error', status: 500 }));
    // The DELETE retry is not sent (the latest choice is yes); the grant goes out after it.
    await waitFor(() => expect(api.grantRomanConsent).toHaveBeenCalledTimes(1));
    await tick();
    expect(api.withdrawRomanConsent).toHaveBeenCalledTimes(1);
    expect(api.withdrawRomanConsent.mock.invocationCallOrder[0]).toBeLessThan(api.grantRomanConsent.mock.invocationCallOrder[0]);
    expect(await pendingMarker()).toBeNull();
    await r.unmount();
  });
});

describe('B-310-5 completion and unmount', () => {
  function Drain({ deps }: { deps: AiWithdrawalDrainDeps }) {
    useAiWithdrawalDrain(deps);
    return <Text>app</Text>;
  }

  async function finishWithPendingNo(api: ConsultationApi) {
    // A grant was sent and its answer lost, then the client said no.
    await seedLocal(fullAnswers(), 'SUM', { aiWant: false, aiAttempted: true });
    const onFinished = jest.fn();
    const r = await render(flowElement(api, onFinished));
    await waitFor(() => r.getByTestId('consult-screen-SUM'));
    await waitFor(() => expect(api.withdrawRomanConsent).toHaveBeenCalled());
    await fireEvent.press(r.getByTestId('consult-prepare'));
    await waitFor(() => r.getByTestId('consult-screen-MACRO'));
    await fireEvent.press(r.getByTestId('consult-macro-next'));
    await waitFor(() => r.getByTestId('consult-screen-PLAN'));
    await fireEvent.press(r.getByTestId('consult-finish'));
    expect(onFinished).toHaveBeenCalledTimes(1);
    await r.unmount();
    return r;
  }

  it('the DELETE in flight at finish still lands after the flow unmounts (same user); the marker is cleared', async () => {
    const l = ledger();
    l.server.granted = true;
    let release: () => void = () => undefined;
    const withdrawRomanConsent = jest.fn(
      () => new Promise<AiConsentOutcome>((res) => { release = () => void l.okWithdraw().then(res); }),
    );
    const api = makeApi({ withdrawRomanConsent, sessionUserId: jest.fn(() => 'u1') });
    await finishWithPendingNo(api);
    expect(await pendingMarker()).not.toBeNull();
    await act(async () => release());
    await tick();
    await tick();
    expect(l.server.granted).toBe(false);
    expect(await pendingMarker()).toBeNull();
  });

  it('the DELETE fails after finish: the marker outlives the purged draft and the client app sends it when it opens, then on restart', async () => {
    const l = ledger();
    l.server.granted = true;
    const withdrawRomanConsent = jest.fn(async (): Promise<AiConsentOutcome> => ({ kind: 'error', status: 503 }));
    const api = makeApi({ withdrawRomanConsent, sessionUserId: jest.fn(() => 'u1') });
    await finishWithPendingNo(api);
    await waitFor(() => expect(withdrawRomanConsent.mock.calls.length).toBeGreaterThanOrEqual(2));
    await tick();
    expect(await readLocalState('u1', NOW)).toBeNull(); // the draft is purged at finish
    expect(await pendingMarker()).not.toBeNull();
    // The client app opens, still offline: kept.
    const offline = jest.fn(async (): Promise<AiConsentOutcome> => LOST);
    const a1 = await render(<Drain deps={{ withdraw: offline, sessionUserId: () => 'u1' }} />);
    await waitFor(() => expect(offline).toHaveBeenCalledTimes(2));
    await tick();
    expect(await pendingMarker()).not.toBeNull();
    await a1.unmount();
    // Restart, back online: sent, confirmed, cleared.
    resetAiLedgerWritesForTests();
    const online = jest.fn(l.okWithdraw);
    const a2 = await render(<Drain deps={{ withdraw: online, sessionUserId: () => 'u1' }} />);
    await waitFor(() => expect(online).toHaveBeenCalledTimes(1));
    await tick();
    expect(l.server.granted).toBe(false);
    expect(await pendingMarker()).toBeNull();
    await a2.unmount();
  });

  it('the client app never sends another user\u2019s pending no', async () => {
    await markAiWithdrawalPending('u1');
    const withdraw = jest.fn(async (): Promise<AiConsentOutcome> => WITHDRAWN);
    const a = await render(<Drain deps={{ withdraw, sessionUserId: () => 'someone-else' }} />);
    await tick();
    await tick();
    expect(withdraw).not.toHaveBeenCalled();
    expect(await pendingMarker()).not.toBeNull();
    await a.unmount();
  });
});

describe('B-310-5 Settings > Privacy > Roman and AI', () => {
  const nav = { goBack: jest.fn(), navigate: jest.fn() };

  function settingsApi(over: Partial<Record<'getStatus' | 'grantRoman' | 'withdrawRoman', jest.Mock>> = {}) {
    return {
      getStatus: jest.fn(async (): Promise<AiConsentOutcome> => ({ kind: 'ok', status: AI_ALLOWED })),
      grantRoman: jest.fn(async (): Promise<AiConsentOutcome> => ({ kind: 'ok', status: AI_ALLOWED })),
      withdrawRoman: jest.fn(async (): Promise<AiConsentOutcome> => WITHDRAWN),
      ...over,
    };
  }

  it('opening Settings sends a pending onboarding no first, then reads the result', async () => {
    await markAiWithdrawalPending('u1');
    const api = settingsApi({ getStatus: jest.fn(async (): Promise<AiConsentOutcome> => WITHDRAWN) });
    const r = await render(<RomanAiConsentScreen navigation={nav as never} api={api} sessionUserId={() => 'u1'} />);
    await waitFor(() => r.getByTestId('roman-ai-not_allowed'));
    expect(api.withdrawRoman).toHaveBeenCalledTimes(1);
    expect(api.withdrawRoman.mock.invocationCallOrder[0]).toBeLessThan(api.getStatus.mock.invocationCallOrder[0]);
    expect(await pendingMarker()).toBeNull();
    expect(r.queryByTestId('roman-ai-pending-withdraw')).toBeNull();
  });

  it('still not confirmed: Settings says so next to Withdraw, never "Not allowed"', async () => {
    await markAiWithdrawalPending('u1');
    const api = settingsApi({ withdrawRoman: jest.fn(async (): Promise<AiConsentOutcome> => LOST) });
    const r = await render(<RomanAiConsentScreen navigation={nav as never} api={api} sessionUserId={() => 'u1'} />);
    await waitFor(() => r.getByTestId('roman-ai-allowed'));
    expect(r.getByTestId('roman-ai-pending-withdraw').props.children).toBe(ROMAN_AI_COPY.pendingWithdraw);
    expect(ROMAN_AI_COPY.pendingWithdraw).not.toMatch(/!|went wrong/);
    expect(r.getByTestId('roman-ai-state').props.children).toBe(ROMAN_AI_COPY.allowedHead);
    expect(await pendingMarker()).not.toBeNull();
  });

  it('Allow in Settings is newer than a pending no: the marker is cleared before the grant is sent', async () => {
    await markAiWithdrawalPending('u1');
    const api = settingsApi({
      withdrawRoman: jest.fn(async (): Promise<AiConsentOutcome> => LOST),
      getStatus: jest.fn(async (): Promise<AiConsentOutcome> => ({ kind: 'ok', status: aiStatus() })),
    });
    const r = await render(<RomanAiConsentScreen navigation={nav as never} api={api} sessionUserId={() => 'u1'} />);
    await waitFor(() => r.getByTestId('roman-ai-not_allowed'));
    alert.mockImplementation((_t?: string, _b?: string, buttons?: AlertButton[]) => {
      const allow = buttons?.find((b: AlertButton) => b.text === ROMAN_AI_COPY.allow);
      allow?.onPress?.();
    });
    await fireEvent.press(r.getByTestId('roman-ai-allow'));
    await waitFor(() => expect(api.grantRoman).toHaveBeenCalledTimes(1));
    expect(await pendingMarker()).toBeNull();
    // The client app opening later sends nothing: the newer yes stands.
    const withdraw = jest.fn(async (): Promise<AiConsentOutcome> => WITHDRAWN);
    function Drain() {
      useAiWithdrawalDrain({ withdraw, sessionUserId: () => 'u1' });
      return null;
    }
    const a = await render(<Drain />);
    await tick();
    expect(withdraw).not.toHaveBeenCalled();
    await a.unmount();
  });
});
