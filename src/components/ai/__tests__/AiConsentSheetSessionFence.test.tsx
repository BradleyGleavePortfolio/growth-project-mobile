/**
 * Sol B-326-2 (round 3): the AI help sheet's identity fence must cover the
 * whole operation, not only the dispatch. A grant (or the reconciliation GET
 * after an unconfirmed grant) that settles after the session that asked has
 * ended must do nothing: no `onGranted`, so the surface never retries the old
 * account's request; no phase change; no Sentry report; and no ledger read
 * under the new session.
 *
 * Two identity sources are exercised:
 *  - an injected `sessionUserId` that switches from account A to account B;
 *  - the PRODUCTION default getter over the real user cache, with a real
 *    `clearUserCache()` (what `signOut` does while authenticated screens are
 *    still mounted), and with the full `AiRefusalNotice` -> `onRetry` path.
 */
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import AiConsentSheet, { AI_CONSENT_SHEET_COPY, type AiConsentSheetApi } from '../AiConsentSheet';
import AiRefusalNotice from '../AiRefusalNotice';
import type { AiConsentOutcome, AiConsentStatusResponse } from '../../../api/aiConsentApi';
import { resetAiLedgerWritesForTests } from '../../../lib/consultation/aiConsent';
import { AI_CONSENT_CHECKBOX_LABEL, AI_CONSENT_COPY_SHA256, AI_CONSENT_PARAGRAPH } from '../../../lib/consultation/copy';
import { AI_CONSENT_VERSION } from '../../../lib/consultation/consentVersion';
import { clearUserCache, setUserCache } from '../../../lib/userCache';
import { captureError } from '../../../services/sentry';

jest.mock('../../../services/sentry', () => ({ captureError: jest.fn() }));

const A = 'client-a';
const B = 'client-b';

function status(overrides: Partial<AiConsentStatusResponse> = {}): AiConsentStatusResponse {
  return {
    granted: false,
    state: 'not_granted',
    version: null,
    granted_at: null,
    withdrawn_at: null,
    current_version: AI_CONSENT_VERSION,
    needs_reconsent: false,
    copy: {
      version: AI_CONSENT_VERSION,
      paragraph: { text: AI_CONSENT_PARAGRAPH, sha256: '56d14fb96b9f7b6abdd43242f5ce9eaee419bc0d9fb4302bc283ecc1529d430b' },
      box_label: { text: AI_CONSENT_CHECKBOX_LABEL, sha256: '77da153df7f06a045e1abbbb83b771f8a33941d47268e276becc6b4ffe5e5eba' },
      sha256: AI_CONSENT_COPY_SHA256,
    },
    ...overrides,
  };
}
const LIVE = status({ granted: true, state: 'granted', version: AI_CONSENT_VERSION });

function deferred<T>() {
  let resolve: (v: T) => void = () => undefined;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** getStatus: the first call loads the sheet; later calls come from `later` (held when deferred). */
function makeApi(grant: () => Promise<AiConsentOutcome>, later?: () => Promise<AiConsentOutcome>) {
  let calls = 0;
  const api = {
    getStatus: jest.fn(async (): Promise<AiConsentOutcome> => {
      calls += 1;
      if (calls === 1 || !later) return { kind: 'ok', status: status() };
      return later();
    }),
    grantRoman: jest.fn(grant),
  };
  return api as typeof api & AiConsentSheetApi;
}

async function openSheet(api: AiConsentSheetApi, sessionUserId?: () => string | null) {
  const onGranted = jest.fn();
  const onClose = jest.fn();
  const r = await render(
    <AiConsentSheet
      visible
      onGranted={onGranted}
      onClose={onClose}
      api={api}
      {...(sessionUserId ? { sessionUserId } : {})}
      testID="s"
    />,
  );
  await waitFor(() => expect(r.getByTestId('s-allow')).toBeTruthy());
  return { r, onGranted, onClose };
}

/** Let every pending microtask and timer-free promise chain settle. */
async function settle() {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await new Promise((res) => setImmediate(res));
  });
}

/** Visible terminal phases the sheet must NOT reach after a stale completion. */
function expectNoOutcomeShown(r: Awaited<ReturnType<typeof openSheet>>['r']) {
  for (const id of ['s-already-on', 's-not-sent', 's-update-app', 's-unavailable', 's-unconfirmed', 's-failed', 's-reconsent']) {
    expect(r.queryByTestId(id)).toBeNull();
  }
}

beforeEach(async () => {
  jest.clearAllMocks();
  resetAiLedgerWritesForTests();
  await AsyncStorage.clear();
  await clearUserCache();
});

describe('AiConsentSheet session fence after the grant settles (Sol B-326-2 round 3)', () => {
  it('grant dispatched as A, account switches to B, live grant settles: no onGranted, no state, no report', async () => {
    let current: string | null = A;
    const held = deferred<AiConsentOutcome>();
    const api = makeApi(() => held.promise);
    const { r, onGranted } = await openSheet(api, () => current);
    await fireEvent.press(r.getByTestId('s-allow'));
    await waitFor(() => expect(api.grantRoman).toHaveBeenCalledTimes(1));

    current = B;
    held.resolve({ kind: 'ok', status: LIVE });
    await settle();

    expect(onGranted).not.toHaveBeenCalled();
    expectNoOutcomeShown(r);
    // Still the in-flight view of A's choice: never relabelled "nothing changed".
    expect(r.queryByText(AI_CONSENT_SHEET_COPY.notSent)).toBeNull();
    expect(api.getStatus).toHaveBeenCalledTimes(1);
    expect(captureError).not.toHaveBeenCalled();
  });

  it('grant dispatched as A, sign-out (null session), ambiguous 500 settles: no reconciliation GET, no retry, no report', async () => {
    let current: string | null = A;
    const held = deferred<AiConsentOutcome>();
    const api = makeApi(() => held.promise);
    const { r, onGranted } = await openSheet(api, () => current);
    await fireEvent.press(r.getByTestId('s-allow'));
    await waitFor(() => expect(api.grantRoman).toHaveBeenCalledTimes(1));

    current = null;
    held.resolve({ kind: 'error', status: 500, requestId: 'req-500' });
    await settle();

    expect(onGranted).not.toHaveBeenCalled();
    expect(api.getStatus).toHaveBeenCalledTimes(1); // the reconciliation GET never went out under no session
    expectNoOutcomeShown(r);
    expect(r.queryByTestId('s-checking')).toBeNull();
    expect(captureError).not.toHaveBeenCalled();
  });

  it('a definitive 4xx that settles after the switch writes no "still off" state and reports nothing', async () => {
    let current: string | null = A;
    const held = deferred<AiConsentOutcome>();
    const api = makeApi(() => held.promise);
    const { r, onGranted } = await openSheet(api, () => current);
    await fireEvent.press(r.getByTestId('s-allow'));
    await waitFor(() => expect(api.grantRoman).toHaveBeenCalledTimes(1));
    current = B;
    held.resolve({ kind: 'error', status: 400, requestId: 'req-400', code: 'BAD' });
    await settle();
    expect(onGranted).not.toHaveBeenCalled();
    expectNoOutcomeShown(r);
    expect(captureError).not.toHaveBeenCalled();
  });

  it('control: the same account still signed in -> the live grant retries once', async () => {
    const held = deferred<AiConsentOutcome>();
    const api = makeApi(() => held.promise);
    const { r, onGranted } = await openSheet(api, () => A);
    await fireEvent.press(r.getByTestId('s-allow'));
    await waitFor(() => expect(api.grantRoman).toHaveBeenCalledTimes(1));
    held.resolve({ kind: 'ok', status: LIVE });
    await waitFor(() => expect(onGranted).toHaveBeenCalledTimes(1));
  });
});

describe('AiConsentSheet session fence on the reconciliation GET (Sol B-326-2 round 3)', () => {
  it('reconciliation GET held as A, account switches to B, GET says live: no onGranted, no state, no report', async () => {
    let current: string | null = A;
    const check = deferred<AiConsentOutcome>();
    const api = makeApi(
      async () => ({ kind: 'error', status: 503, requestId: 'req-503' }),
      () => check.promise,
    );
    const { r, onGranted } = await openSheet(api, () => current);
    await fireEvent.press(r.getByTestId('s-allow'));
    await waitFor(() => expect(r.getByTestId('s-checking')).toBeTruthy());
    expect(api.getStatus).toHaveBeenCalledTimes(2);

    current = B;
    check.resolve({ kind: 'ok', status: LIVE });
    await settle();

    expect(onGranted).not.toHaveBeenCalled();
    expectNoOutcomeShown(r);
    expect(captureError).not.toHaveBeenCalled();
  });

  it('reconciliation GET held as A, sign-out, GET fails: no "could not confirm" state and no report', async () => {
    let current: string | null = A;
    const check = deferred<AiConsentOutcome>();
    const api = makeApi(
      async () => ({ kind: 'error', status: null }),
      () => check.promise,
    );
    const { r, onGranted } = await openSheet(api, () => current);
    await fireEvent.press(r.getByTestId('s-allow'));
    await waitFor(() => expect(r.getByTestId('s-checking')).toBeTruthy());

    current = null;
    check.resolve({ kind: 'error', status: null });
    await settle();

    expect(onGranted).not.toHaveBeenCalled();
    expect(r.queryByTestId('s-unconfirmed')).toBeNull();
    expect(captureError).not.toHaveBeenCalled();
  });

  it('reconciliation GET held as A, GET says not granted after the switch: no "still off" state for B', async () => {
    let current: string | null = A;
    const check = deferred<AiConsentOutcome>();
    const api = makeApi(
      async () => ({ kind: 'error', status: 500, requestId: 'req-500' }),
      () => check.promise,
    );
    const { r, onGranted } = await openSheet(api, () => current);
    await fireEvent.press(r.getByTestId('s-allow'));
    await waitFor(() => expect(r.getByTestId('s-checking')).toBeTruthy());
    current = B;
    check.resolve({ kind: 'ok', status: status() });
    await settle();
    expect(onGranted).not.toHaveBeenCalled();
    expect(r.queryByTestId('s-failed')).toBeNull();
    expect(captureError).not.toHaveBeenCalled();
  });

  it('control: same account -> a held reconciliation GET that says live retries once', async () => {
    const check = deferred<AiConsentOutcome>();
    const api = makeApi(
      async () => ({ kind: 'error', status: 503, requestId: 'req-503' }),
      () => check.promise,
    );
    const { r, onGranted } = await openSheet(api, () => A);
    await fireEvent.press(r.getByTestId('s-allow'));
    await waitFor(() => expect(r.getByTestId('s-checking')).toBeTruthy());
    check.resolve({ kind: 'ok', status: LIVE });
    await waitFor(() => expect(onGranted).toHaveBeenCalledTimes(1));
  });
});

describe('AiConsentSheet session fence on load and "already on"', () => {
  it('status load held as A, account switches to B: the sheet never shows A\u2019s choice', async () => {
    let current: string | null = A;
    const held = deferred<AiConsentOutcome>();
    const api = {
      getStatus: jest.fn(() => held.promise),
      grantRoman: jest.fn(async (): Promise<AiConsentOutcome> => ({ kind: 'ok', status: LIVE })),
    };
    const onGranted = jest.fn();
    const r = await render(
      <AiConsentSheet visible onGranted={onGranted} onClose={jest.fn()} api={api} sessionUserId={() => current} testID="s" />,
    );
    current = B;
    held.resolve({ kind: 'ok', status: status() });
    await settle();
    expect(r.queryByTestId('s-allow')).toBeNull();
    expect(r.getByTestId('s-loading')).toBeTruthy();
    expect(captureError).not.toHaveBeenCalled();
  });

  it('"already on" shown for A, then B is signed in: Try again does not retry A\u2019s request', async () => {
    let current: string | null = A;
    const api = {
      getStatus: jest.fn(async (): Promise<AiConsentOutcome> => ({ kind: 'ok', status: LIVE })),
      grantRoman: jest.fn(async (): Promise<AiConsentOutcome> => ({ kind: 'ok', status: LIVE })),
    };
    const onGranted = jest.fn();
    const r = await render(
      <AiConsentSheet visible onGranted={onGranted} onClose={jest.fn()} api={api} sessionUserId={() => current} testID="s" />,
    );
    await waitFor(() => expect(r.getByTestId('s-already-on')).toBeTruthy());
    current = B;
    await fireEvent.press(r.getByText(AI_CONSENT_SHEET_COPY.tryAgain));
    expect(onGranted).not.toHaveBeenCalled();
    current = A;
    await fireEvent.press(r.getByText(AI_CONSENT_SHEET_COPY.tryAgain));
    expect(onGranted).toHaveBeenCalledTimes(1);
  });

  it('the sheet was loaded for A but B is signed in when Allow is tapped: nothing is sent', async () => {
    let current: string | null = A;
    const api = makeApi(async () => ({ kind: 'ok', status: LIVE }));
    const { r, onGranted } = await openSheet(api, () => current);
    current = B;
    await fireEvent.press(r.getByTestId('s-allow'));
    await waitFor(() => expect(r.getByTestId('s-not-sent')).toBeTruthy());
    expect(api.grantRoman).not.toHaveBeenCalled();
    expect(onGranted).not.toHaveBeenCalled();
  });
});

describe('production identity: real user cache + sign-out while the screen is mounted', () => {
  it('AiRefusalNotice: grant held, clearUserCache() (signOut), live grant settles -> onRetry is never called', async () => {
    await setUserCache({ id: A, email: 'a@example.invalid' });
    const held = deferred<AiConsentOutcome>();
    const api = makeApi(() => held.promise);
    const onRetry = jest.fn();
    // No consentSessionUserId: the sheet uses its production default getter.
    const r = await render(
      <AiRefusalNotice refusal={{ kind: 'consent_required' }} audience="client" surface="guide" onRetry={onRetry} consentApi={api} testID="n" />,
    );
    await fireEvent.press(r.getByTestId('n-allow'));
    await waitFor(() => expect(r.getByTestId('n-consent-sheet-allow')).toBeTruthy());
    await fireEvent.press(r.getByTestId('n-consent-sheet-allow'));
    await waitFor(() => expect(api.grantRoman).toHaveBeenCalledTimes(1));

    await clearUserCache(); // signOut empties the mirror while authenticated screens remain mounted
    held.resolve({ kind: 'ok', status: LIVE });
    await settle();

    expect(onRetry).not.toHaveBeenCalled();
    expect(api.getStatus).toHaveBeenCalledTimes(1);
    expect(captureError).not.toHaveBeenCalled();
  });

  it('AiRefusalNotice: reconciliation GET held, sign-out then B signs in, GET says live -> onRetry is never called', async () => {
    await setUserCache({ id: A, email: 'a@example.invalid' });
    const check = deferred<AiConsentOutcome>();
    const api = makeApi(
      async () => ({ kind: 'error', status: 502, requestId: 'req-502' }),
      () => check.promise,
    );
    const onRetry = jest.fn();
    const r = await render(
      <AiRefusalNotice refusal={{ kind: 'consent_required' }} audience="client" surface="roman" onRetry={onRetry} consentApi={api} testID="n" />,
    );
    await fireEvent.press(r.getByTestId('n-allow'));
    await waitFor(() => expect(r.getByTestId('n-consent-sheet-allow')).toBeTruthy());
    await fireEvent.press(r.getByTestId('n-consent-sheet-allow'));
    await waitFor(() => expect(r.getByTestId('n-consent-sheet-checking')).toBeTruthy());

    await clearUserCache();
    await setUserCache({ id: B, email: 'b@example.invalid' });
    check.resolve({ kind: 'ok', status: LIVE });
    await settle();

    expect(onRetry).not.toHaveBeenCalled();
    expect(captureError).not.toHaveBeenCalled();
  });

  it('control: real cache, same account throughout -> one retry', async () => {
    await setUserCache({ id: A, email: 'a@example.invalid' });
    const api = makeApi(async () => ({ kind: 'ok', status: LIVE }));
    const onRetry = jest.fn();
    const r = await render(
      <AiRefusalNotice refusal={{ kind: 'consent_required' }} audience="client" surface="guide" onRetry={onRetry} consentApi={api} testID="n" />,
    );
    await fireEvent.press(r.getByTestId('n-allow'));
    await waitFor(() => expect(r.getByTestId('n-consent-sheet-allow')).toBeTruthy());
    await fireEvent.press(r.getByTestId('n-consent-sheet-allow'));
    await waitFor(() => expect(onRetry).toHaveBeenCalledTimes(1));
  });
});
