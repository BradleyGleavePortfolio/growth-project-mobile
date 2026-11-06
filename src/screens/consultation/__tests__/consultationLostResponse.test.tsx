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
import { readUserCacheSync } from '../../../lib/userCache';
import {
  aiWithdrawalPendingKey,
  drainAiWithdrawal,
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
const WITHDRAWN: AiConsentOutcome = { kind: 'ok', status: aiStatus({ state: 'withdrawn', version: 'client-ai-v4' }) };

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

});

// Sol B-310-8: marker steps run in decision order and act only for the
// latest choice, so a superseded yes never removes a newer no's marker.
describe('B-310-8 delayed marker storage never loses the newest no', () => {
  /** Holds every write (or remove) of u1's marker until released. */
  function holdMarker(kind: 'setItem' | 'removeItem') {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = AsyncStorage[kind].bind(AsyncStorage) as (k: string, v?: string) => Promise<void>;
    const spy = jest
      .spyOn(AsyncStorage, kind)
      .mockImplementation((async (key: string, value?: string) => {
        if (key === aiWithdrawalPendingKey('u1')) await held;
        await original(key, value);
      }) as never);
    return { spy, release: () => release() };
  }
  async function visit(r: Awaited<ReturnType<typeof continueWithBothBoxes>>, toggle: boolean) {
    await fireEvent.press(r.getByTestId('consult-back'));
    await waitFor(() => r.getByTestId('consult-screen-P0'));
    if (toggle) await fireEvent.press(r.getByTestId('consent-ai-checkbox'));
    await fireEvent.press(r.getByTestId('consult-continue'));
    await waitFor(() => r.getByTestId('consult-screen-G1'));
  }




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
  // Owner 62x: the Allow / Withdraw choice is for a client with a coach.
  beforeEach(() => {
    jest.mocked(readUserCacheSync).mockReturnValue({ id: 'u1', email: '', coach_id: 'coach-1' });
  });
  afterEach(() => {
    jest.mocked(readUserCacheSync).mockReturnValue({ id: 'u1', email: '' });
  });
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
