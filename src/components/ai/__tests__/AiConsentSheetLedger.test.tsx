/**
 * Sol/Opus B-326-2: the AI help sheet's "yes" uses the same choice protocol as
 * P0 and Settings (#310): the one ledger queue, the identity fence, and at its
 * own turn it clears the signed-in account's pending onboarding "no".
 *
 * Regression for Opus's probe (pending P0 "no" whose DELETE reply was lost ->
 * sheet "yes" -> next foreground drain): the drain must find no marker and
 * send no DELETE, so the newer "yes" stands. Plus: a held sheet grant followed
 * by a Settings withdrawal goes out in order (the newer "no" wins), the marker
 * stays cleared after a restart, another account's marker is never touched,
 * and a grant whose account changed before its turn sends nothing.
 */
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import AiConsentSheet, { AI_CONSENT_SHEET_COPY, type AiConsentSheetApi } from '../AiConsentSheet';
import type { AiConsentOutcome, AiConsentStatusResponse } from '../../../api/aiConsentApi';
import {
  drainAiWithdrawal,
  markAiWithdrawalPending,
  readAiWithdrawalPending,
  resetAiLedgerWritesForTests,
  runAiLedgerWrite,
  withdrawAiChoiceAs,
} from '../../../lib/consultation/aiConsent';
import { AI_CONSENT_CHECKBOX_LABEL, AI_CONSENT_COPY_SHA256, AI_CONSENT_PARAGRAPH } from '../../../lib/consultation/copy';
import { AI_CONSENT_VERSION } from '../../../lib/consultation/consentVersion';

jest.mock('../../../services/sentry', () => ({ captureError: jest.fn() }));

const ME = 'client-me';
const OTHER = 'client-other';

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

function makeApi(grant: () => Promise<AiConsentOutcome>, wire: string[]) {
  const api = {
    getStatus: jest.fn(async (): Promise<AiConsentOutcome> => ({ kind: 'ok', status: status() })),
    grantRoman: jest.fn(async () => {
      wire.push('POST');
      return grant();
    }),
  };
  return api as typeof api & AiConsentSheetApi;
}

async function openSheet(api: AiConsentSheetApi, sessionUserId: () => string | null, onGranted = jest.fn()) {
  const r = await render(
    <AiConsentSheet visible onGranted={onGranted} onClose={jest.fn()} api={api} sessionUserId={sessionUserId} testID="s" />,
  );
  await waitFor(() => expect(r.getByTestId('s-allow')).toBeTruthy());
  return { r, onGranted };
}

beforeEach(async () => {
  jest.clearAllMocks();
  resetAiLedgerWritesForTests();
  await AsyncStorage.clear();
});

describe('AiConsentSheet uses the #310 choice protocol (B-326-2)', () => {
  it('pending onboarding "no" -> sheet "yes" -> foreground drain: no DELETE, the newer "yes" stands', async () => {
    await markAiWithdrawalPending(ME);
    const wire: string[] = [];
    const api = makeApi(async () => ({ kind: 'ok', status: LIVE }), wire);
    const { r, onGranted } = await openSheet(api, () => ME);
    await fireEvent.press(r.getByTestId('s-allow'));
    await waitFor(() => expect(onGranted).toHaveBeenCalledTimes(1));
    expect(await readAiWithdrawalPending(ME)).toBeNull();

    const withdraw = jest.fn(async (): Promise<AiConsentOutcome> => {
      wire.push('DELETE');
      return { kind: 'ok', status: null };
    });
    await expect(drainAiWithdrawal(ME, withdraw, () => true)).resolves.toBe('none');
    // After an app restart (fresh queue) the marker is still gone.
    resetAiLedgerWritesForTests();
    await expect(drainAiWithdrawal(ME, withdraw, () => true)).resolves.toBe('none');
    expect(withdraw).not.toHaveBeenCalled();
    expect(wire).toEqual(['POST']);
  });

  it('held sheet "yes" -> Settings "no": the DELETE waits for the POST, so the newer "no" wins', async () => {
    const wire: string[] = [];
    const held = deferred<AiConsentOutcome>();
    const api = makeApi(() => held.promise, wire);
    const { r, onGranted } = await openSheet(api, () => ME);
    await fireEvent.press(r.getByTestId('s-allow'));
    await waitFor(() => expect(api.grantRoman).toHaveBeenCalledTimes(1));

    const withdraw = jest.fn(async (): Promise<AiConsentOutcome> => {
      wire.push('DELETE');
      return { kind: 'ok', status: status({ state: 'withdrawn', version: AI_CONSENT_VERSION }) };
    });
    const settingsNo = withdrawAiChoiceAs(ME, () => ME, withdraw);
    await new Promise((res) => setTimeout(res, 20));
    expect(withdraw).not.toHaveBeenCalled();

    held.resolve({ kind: 'ok', status: LIVE });
    await settingsNo;
    expect(wire).toEqual(['POST', 'DELETE']);
    await waitFor(() => expect(onGranted).toHaveBeenCalledTimes(1));
  });

  it("another account's pending \"no\" is never cleared by this account's \"yes\"", async () => {
    await markAiWithdrawalPending(OTHER);
    const api = makeApi(async () => ({ kind: 'ok', status: LIVE }), []);
    const { r, onGranted } = await openSheet(api, () => ME);
    await fireEvent.press(r.getByTestId('s-allow'));
    await waitFor(() => expect(onGranted).toHaveBeenCalledTimes(1));
    expect(await readAiWithdrawalPending(OTHER)).not.toBeNull();
  });

  it('the account changed before the grant got its turn: nothing is sent, the marker stays, the sheet says so', async () => {
    await markAiWithdrawalPending(ME);
    let current: string | null = ME;
    const gate = deferred<void>();
    // An earlier ledger write (e.g. a drain) holds the queue.
    const earlier = runAiLedgerWrite(() => gate.promise);
    const api = makeApi(async () => ({ kind: 'ok', status: LIVE }), []);
    const { r, onGranted } = await openSheet(api, () => current);
    await fireEvent.press(r.getByTestId('s-allow'));
    current = OTHER;
    gate.resolve();
    await earlier;
    await waitFor(() => expect(r.getByText(AI_CONSENT_SHEET_COPY.notSent)).toBeTruthy());
    expect(api.grantRoman).not.toHaveBeenCalled();
    expect(onGranted).not.toHaveBeenCalled();
    expect(await readAiWithdrawalPending(ME)).not.toBeNull();
  });
});
