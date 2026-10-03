/**
 * AiRefusalNotice + AiConsentSheet + openSupportFrom.
 *
 * Client consent: "Allow AI help" opens the box 2 choice with the SERVER copy,
 * a tap records the grant (version + copy sha256 + platform) and the refused
 * request is retried; "Not now" records nothing; every sheet failure says
 * what happened and offers a next step. Coach consent: no grant action (the
 * client decides), "Try again". Egress: Contact support + Copy reference,
 * never a consent prompt.
 */
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';
import AiRefusalNotice from '../AiRefusalNotice';
import { AI_CONSENT_SHEET_COPY, type AiConsentSheetApi } from '../AiConsentSheet';
import { openSupportFrom, type SupportNav } from '../useOpenSupport';
import type { AiConsentOutcome, AiConsentStatusResponse } from '../../../api/aiConsentApi';
import {
  AI_CONSENT_CHECKBOX_LABEL,
  AI_CONSENT_COPY_SHA256,
  AI_CONSENT_PARAGRAPH,
} from '../../../lib/consultation/copy';
import { AI_CONSENT_VERSION } from '../../../lib/consultation/consentVersion';
import { resetAiLedgerWritesForTests } from '../../../lib/consultation/aiConsent';
import { captureError } from '../../../services/sentry';

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));
jest.mock('../../../services/sentry', () => ({ captureError: jest.fn() }));

// The real client-ai-v4 copy, byte-identical to backend #635 (paragraph
// sha256 56d14fb9..., label 77da153d..., combined fbf82140...).
const PARAGRAPH = AI_CONSENT_PARAGRAPH;
const LABEL = AI_CONSENT_CHECKBOX_LABEL;
const V4 = AI_CONSENT_VERSION;
const UID = 'client-1';
const sessionUserId = () => UID;

function status(overrides: Partial<AiConsentStatusResponse> = {}): AiConsentStatusResponse {
  return {
    purpose: 'client_ai_processing',
    processor: 'anthropic',
    granted: false,
    state: 'not_granted',
    version: null,
    granted_at: null,
    withdrawn_at: null,
    current_version: V4,
    needs_reconsent: false,
    copy: {
      version: V4,
      paragraph: { text: PARAGRAPH, sha256: '56d14fb96b9f7b6abdd43242f5ce9eaee419bc0d9fb4302bc283ecc1529d430b' },
      box_label: { text: LABEL, sha256: '77da153df7f06a045e1abbbb83b771f8a33941d47268e276becc6b4ffe5e5eba' },
      sha256: AI_CONSENT_COPY_SHA256,
    },
    ...overrides,
  };
}

const GRANTED = status({ granted: true, state: 'granted', version: V4, granted_at: '2026-10-01T00:00:00Z' });

/** `getStatus` answers in order (the last answer repeats). */
function fakeApi(
  getStatus: AiConsentOutcome | AiConsentOutcome[],
  grant: AiConsentOutcome = { kind: 'ok', status: GRANTED },
) {
  const answers = Array.isArray(getStatus) ? [...getStatus] : [getStatus];
  const api = {
    getStatus: jest.fn(async () => (answers.length > 1 ? answers.shift()! : answers[0])),
    grantRoman: jest.fn(async () => grant),
  };
  return api as typeof api & AiConsentSheetApi;
}

describe('AiRefusalNotice — client consent_required', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetAiLedgerWritesForTests();
  });

  it('Allow AI help -> server copy -> grant with version, sha256 and platform -> retries the request', async () => {
    const api = fakeApi({ kind: 'ok', status: status() });
    const onRetry = jest.fn();
    const r = await render(
      <AiRefusalNotice
        refusal={{ kind: 'consent_required' }}
        audience="client"
        surface="roman"
        onRetry={onRetry}
        consentApi={api} consentSessionUserId={sessionUserId}
        testID="n"
      />,
    );
    expect(r.getByTestId('n-title').props.children).toBe('AI help is off');
    expect(r.getByTestId('n-body').props.children).toContain('Your coach still sees your training information as usual');
    await fireEvent.press(r.getByTestId('n-allow'));
    await waitFor(() => expect(r.getByTestId('n-consent-sheet-paragraph')).toBeTruthy());
    expect(r.getByTestId('n-consent-sheet-paragraph').props.children).toBe(PARAGRAPH);
    expect(r.getByTestId('n-consent-sheet-label').props.children).toBe(LABEL);
    expect(r.getByText(AI_CONSENT_SHEET_COPY.coachNote)).toBeTruthy();
    expect(api.grantRoman).not.toHaveBeenCalled();
    await fireEvent.press(r.getByTestId('n-consent-sheet-allow'));
    await waitFor(() => expect(onRetry).toHaveBeenCalledTimes(1));
    expect(api.grantRoman).toHaveBeenCalledWith({
      version: V4,
      copy_sha256: AI_CONSENT_COPY_SHA256,
      platform: expect.stringMatching(/^(ios|android|web)$/),
    });
  });

  it('Not now records nothing and does not retry', async () => {
    const api = fakeApi({ kind: 'ok', status: status() });
    const onRetry = jest.fn();
    const r = await render(
      <AiRefusalNotice refusal={{ kind: 'consent_required' }} audience="client" surface="guide" onRetry={onRetry} consentApi={api} consentSessionUserId={sessionUserId} testID="n" />,
    );
    await fireEvent.press(r.getByTestId('n-allow'));
    await waitFor(() => expect(r.getByTestId('n-consent-sheet-not-now')).toBeTruthy());
    await fireEvent.press(r.getByTestId('n-consent-sheet-not-now'));
    expect(api.grantRoman).not.toHaveBeenCalled();
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('already granted on the server: says so and the request can be retried', async () => {
    const api = fakeApi({ kind: 'ok', status: GRANTED });
    const onRetry = jest.fn();
    const r = await render(
      <AiRefusalNotice refusal={{ kind: 'consent_required' }} audience="client" surface="insight" onRetry={onRetry} consentApi={api} consentSessionUserId={sessionUserId} testID="n" />,
    );
    await fireEvent.press(r.getByTestId('n-allow'));
    await waitFor(() => expect(r.getByTestId('n-consent-sheet-already-on')).toBeTruthy());
    await fireEvent.press(r.getByTestId('n-consent-sheet-retry-request'));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(api.grantRoman).not.toHaveBeenCalled();
  });

  it.each<[string, AiConsentOutcome, string]>([
    ['ledger not deployed (404/503)', { kind: 'unavailable', status: 503 }, AI_CONSENT_SHEET_COPY.unavailable],
    ['wording changed (409)', { kind: 'version_mismatch' }, AI_CONSENT_SHEET_COPY.updateApp],
    ['load error with a reference', { kind: 'error', status: 500, requestId: 'ref-12345678-xyz' }, AI_CONSENT_SHEET_COPY.loadFailed],
  ])('status %s: specific copy, nothing granted', async (_name, outcome, text) => {
    const api = fakeApi(outcome);
    const r = await render(
      <AiRefusalNotice refusal={{ kind: 'consent_required' }} audience="client" surface="roman" consentApi={api} consentSessionUserId={sessionUserId} onContactSupport={jest.fn()} testID="n" />,
    );
    await fireEvent.press(r.getByTestId('n-allow'));
    await waitFor(() => expect(r.getByText(text)).toBeTruthy());
    expect(api.grantRoman).not.toHaveBeenCalled();
    if (outcome.kind === 'error') {
      expect(r.getByTestId('n-consent-sheet-reference').props.children).toBe('Reference: ref-1234');
      expect(r.getByTestId('n-consent-sheet-support')).toBeTruthy();
    }
  });

  it('a status without the current wording is never consented to (no fallback copy)', async () => {
    const api = fakeApi({ kind: 'ok', status: status({ copy: null }) });
    const r = await render(
      <AiRefusalNotice refusal={{ kind: 'consent_required' }} audience="client" surface="roman" consentApi={api} consentSessionUserId={sessionUserId} testID="n" />,
    );
    await fireEvent.press(r.getByTestId('n-allow'));
    await waitFor(() => expect(r.getByText(AI_CONSENT_SHEET_COPY.loadFailed)).toBeTruthy());
    expect(r.queryByTestId('n-consent-sheet-allow')).toBeNull();
  });

  async function openAndAllow(api: ReturnType<typeof fakeApi>, onRetry = jest.fn()) {
    const r = await render(
      <AiRefusalNotice refusal={{ kind: 'consent_required' }} audience="client" surface="roman" onRetry={onRetry} consentApi={api} consentSessionUserId={sessionUserId} onContactSupport={jest.fn()} testID="n" />,
    );
    await fireEvent.press(r.getByTestId('n-allow'));
    await waitFor(() => expect(r.getByTestId('n-consent-sheet-allow')).toBeTruthy());
    await fireEvent.press(r.getByTestId('n-consent-sheet-allow'));
    return { r, onRetry };
  }

  // Sol/Opus B-326-1: an error is not proof that nothing was written.
  it('committed but the reply was lost (500): re-reads the ledger, finds the live grant, retries once', async () => {
    const api = fakeApi([{ kind: 'ok', status: status() }, { kind: 'ok', status: GRANTED }], {
      kind: 'error',
      status: 500,
      requestId: 'grant-ref-99',
    });
    const { onRetry } = await openAndAllow(api);
    await waitFor(() => expect(onRetry).toHaveBeenCalledTimes(1));
    expect(api.getStatus).toHaveBeenCalledTimes(2);
  });

  it('no reply at all, ledger unreadable: "could not confirm", never "still off", with a reported reference', async () => {
    const api = fakeApi([{ kind: 'ok', status: status() }, { kind: 'error', status: null }], { kind: 'error', status: null });
    const { r, onRetry } = await openAndAllow(api);
    await waitFor(() => expect(r.getByText(AI_CONSENT_SHEET_COPY.unconfirmed)).toBeTruthy());
    expect(r.queryByText(AI_CONSENT_SHEET_COPY.saveFailed)).toBeNull();
    expect(onRetry).not.toHaveBeenCalled();
    const shown = String(r.getByTestId('n-consent-sheet-reference').props.children).replace('Reference: ', '');
    const reported = (captureError as jest.Mock).mock.calls.map((c) => (c[1] as { reference?: string }).reference);
    expect(reported.some((ref) => typeof ref === 'string' && ref.startsWith(shown))).toBe(true);
    expect(r.getByTestId('n-consent-sheet-try-again')).toBeTruthy();
    expect(r.getByTestId('n-consent-sheet-support')).toBeTruthy();
  });

  it('5xx and the ledger then says not granted: "still off" (proven by the server), Try again re-reads, no retry', async () => {
    const api = fakeApi([{ kind: 'ok', status: status() }, { kind: 'ok', status: status() }], { kind: 'error', status: 502 });
    const { r, onRetry } = await openAndAllow(api);
    await waitFor(() => expect(r.getByText(AI_CONSENT_SHEET_COPY.saveFailed)).toBeTruthy());
    expect(r.getByTestId('n-consent-sheet-reference')).toBeTruthy();
    expect(onRetry).not.toHaveBeenCalled();
    expect(api.grantRoman).toHaveBeenCalledTimes(1);
  });

  it('a success with no readable status is NOT a live grant: it is checked first', async () => {
    const api = fakeApi([{ kind: 'ok', status: status() }, { kind: 'ok', status: status() }], { kind: 'ok', status: null });
    const { r, onRetry } = await openAndAllow(api);
    await waitFor(() => expect(r.getByText(AI_CONSENT_SHEET_COPY.saveFailed)).toBeTruthy());
    expect(onRetry).not.toHaveBeenCalled();
    expect(api.getStatus).toHaveBeenCalledTimes(2);
  });

  it('a success whose status is not a live grant (withdrawn meanwhile) is checked, then reported off', async () => {
    const withdrawn = status({ state: 'withdrawn', version: V4, withdrawn_at: '2026-10-02T00:00:00Z' });
    const api = fakeApi([{ kind: 'ok', status: status() }, { kind: 'ok', status: withdrawn }], { kind: 'ok', status: withdrawn });
    const { r, onRetry } = await openAndAllow(api);
    await waitFor(() => expect(r.getByText(AI_CONSENT_SHEET_COPY.saveFailed)).toBeTruthy());
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('the wording changed under the request: shows the new wording with the reconsent line, no retry', async () => {
    const v5 = status({
      current_version: 'client-ai-v5',
      copy: { version: 'client-ai-v5', paragraph: { text: 'New paragraph.', sha256: 'd'.repeat(64) }, box_label: { text: 'New label.', sha256: 'e'.repeat(64) }, sha256: 'f'.repeat(64) },
    });
    const api = fakeApi([{ kind: 'ok', status: status() }, { kind: 'ok', status: v5 }], { kind: 'error', status: 504 });
    const { r, onRetry } = await openAndAllow(api);
    await waitFor(() => expect(r.getByTestId('n-consent-sheet-paragraph').props.children).toBe('New paragraph.'));
    expect(r.getByTestId('n-consent-sheet-reconsent').props.children).toBe(AI_CONSENT_SHEET_COPY.reconsent);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('a definitive 4xx refusal: still off with a reference, no ledger re-read needed', async () => {
    const api = fakeApi({ kind: 'ok', status: status() }, { kind: 'error', status: 400, code: 'BAD_REQUEST' });
    const { r, onRetry } = await openAndAllow(api);
    await waitFor(() => expect(r.getByText(AI_CONSENT_SHEET_COPY.saveFailed)).toBeTruthy());
    expect(r.getByTestId('n-consent-sheet-reference')).toBeTruthy();
    expect(api.getStatus).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('needs_reconsent (an older version was allowed): the sheet says the wording changed (C-326-2)', async () => {
    const api = fakeApi({ kind: 'ok', status: status({ state: 'needs_reconsent', needs_reconsent: true, version: 'client-ai-v3' }) });
    const r = await render(
      <AiRefusalNotice refusal={{ kind: 'consent_required' }} audience="client" surface="roman" consentApi={api} consentSessionUserId={sessionUserId} testID="n" />,
    );
    await fireEvent.press(r.getByTestId('n-allow'));
    await waitFor(() => expect(r.getByTestId('n-consent-sheet-reconsent')).toBeTruthy());
    expect(r.getByTestId('n-consent-sheet-paragraph').props.children).toBe(PARAGRAPH);
  });

  // Sol B-326-4: every unknown branch shows a reference that is also reported.
  it.each<[string, AiConsentOutcome]>([
    ['load error without any request reference', { kind: 'error', status: 500 }],
    ['status without the current wording', { kind: 'ok', status: status({ copy: null }) }],
  ])('%s: a generated reference is shown and is the one on the Sentry event', async (_n, outcome) => {
    const api = fakeApi(outcome);
    const r = await render(
      <AiRefusalNotice refusal={{ kind: 'consent_required' }} audience="client" surface="roman" consentApi={api} consentSessionUserId={sessionUserId} onContactSupport={jest.fn()} testID="n" />,
    );
    await fireEvent.press(r.getByTestId('n-allow'));
    await waitFor(() => expect(r.getByTestId('n-consent-sheet-reference')).toBeTruthy());
    const shown = String(r.getByTestId('n-consent-sheet-reference').props.children).replace('Reference: ', '');
    expect(shown).toMatch(/^[A-Za-z0-9-]{8}$/);
    const reported = (captureError as jest.Mock).mock.calls.map((c) => (c[1] as { reference?: string }).reference);
    expect(reported.some((ref) => typeof ref === 'string' && ref.startsWith(shown))).toBe(true);
    expect(r.getByTestId('n-consent-sheet-support')).toBeTruthy();
  });
});

describe('AiRefusalNotice — coach consent_required', () => {
  it('no grant action for the coach; Try again re-runs the request', async () => {
    const onRetry = jest.fn();
    const r = await render(
      <AiRefusalNotice refusal={{ kind: 'consent_required' }} audience="coach" surface="draft" onRetry={onRetry} testID="n" />,
    );
    expect(r.getByTestId('n-title').props.children).toBe('AI help is off for this client');
    expect(r.getByTestId('n-body').props.children).toContain('You still see their data and can coach them as usual');
    expect(r.queryByTestId('n-allow')).toBeNull();
    await fireEvent.press(r.getByTestId('n-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('AiRefusalNotice — egress_blocked', () => {
  it('Contact support + Copy reference (full id), short reference shown, no consent prompt', async () => {
    const onContactSupport = jest.fn();
    const r = await render(
      <AiRefusalNotice
        refusal={{ kind: 'egress_blocked', reference: '7f3a9c21-0000-4000-8000-abcdefabcdef', serverMessage: 'x' }}
        audience="client"
        surface="roman"
        onContactSupport={onContactSupport}
        testID="n"
      />,
    );
    expect(r.getByTestId('n-title').props.children).toBe('AI help is paused by a service problem');
    expect(r.getByTestId('n-reference').props.children).toBe('Reference: 7f3a9c21');
    expect(r.queryByTestId('n-allow')).toBeNull();
    await fireEvent.press(r.getByTestId('n-support'));
    expect(onContactSupport).toHaveBeenCalledTimes(1);
    await fireEvent.press(r.getByTestId('n-copy-reference'));
    await waitFor(() => expect(Clipboard.setStringAsync).toHaveBeenCalledWith('7f3a9c21-0000-4000-8000-abcdefabcdef'));
    await waitFor(() => expect(r.getByText('Reference copied')).toBeTruthy());
  });

  it('outside a navigator: shows the server message (it names the support address) as the support path', async () => {
    const r = await render(
      <AiRefusalNotice
        refusal={{ kind: 'egress_blocked', reference: 'abc12345', serverMessage: 'Contact support at help@example.test and include the reference.' }}
        audience="coach"
        surface="draft"
        testID="n"
      />,
    );
    expect(r.queryByTestId('n-support')).toBeNull();
    expect(r.getByTestId('n-server-message').props.children).toContain('Contact support at');
    expect(r.getByTestId('n-copy-reference')).toBeTruthy();
  });
});

describe('openSupportFrom', () => {
  interface FakeNav extends SupportNav {
    navigate: jest.Mock;
    getParent: () => FakeNav | undefined;
  }
  function nav(routeNames: string[], parent?: FakeNav): FakeNav {
    return {
      navigate: jest.fn(),
      getState: () => ({ routeNames }),
      getParent: () => parent,
    };
  }

  it('same stack: navigates to SupportInbox directly', async () => {
    const n = nav(['RomanChat', 'SupportInbox']);
    expect(openSupportFrom(n)).toBe(true);
    expect(n.navigate).toHaveBeenCalledWith('SupportInbox');
  });

  it('client tab elsewhere: goes through MoreTab', async () => {
    const tabs = nav(['HomeTab', 'MoreTab']);
    const progress = nav(['Progress', 'Wearables'], tabs);
    expect(openSupportFrom(progress)).toBe(true);
    expect(tabs.navigate).toHaveBeenCalledWith('MoreTab', { screen: 'SupportInbox' });
  });

  it('coach tab elsewhere: goes through SettingsStack', async () => {
    const tabs = nav(['ClientsStack', 'SettingsStack']);
    const clients = nav(['ClientDetail'], tabs);
    expect(openSupportFrom(clients)).toBe(true);
    expect(tabs.navigate).toHaveBeenCalledWith('SettingsStack', { screen: 'SupportInbox' });
  });

  it('no navigator holds it: false', async () => {
    expect(openSupportFrom(nav(['A']))).toBe(false);
    expect(openSupportFrom(undefined)).toBe(false);
  });
});
