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

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));
jest.mock('../../../services/sentry', () => ({ captureError: jest.fn() }));

const PARAGRAPH = 'Roman, the assistant in this app, is powered by Anthropic, a third-party AI provider.';
const LABEL = 'Optional: I allow Roman and my coach’s AI tools to use my information, processed by Anthropic.';

function status(overrides: Partial<AiConsentStatusResponse> = {}): AiConsentStatusResponse {
  return {
    purpose: 'client_ai_processing',
    processor: 'anthropic',
    granted: false,
    state: 'not_granted',
    version: null,
    granted_at: null,
    withdrawn_at: null,
    current_version: 'client-ai-v3',
    needs_reconsent: false,
    copy: {
      version: 'client-ai-v3',
      paragraph: { text: PARAGRAPH, sha256: 'a'.repeat(64) },
      box_label: { text: LABEL, sha256: 'b'.repeat(64) },
      sha256: 'c'.repeat(64),
    },
    ...overrides,
  };
}

const GRANTED = status({ granted: true, state: 'granted', version: 'client-ai-v3', granted_at: '2026-10-01T00:00:00Z' });

function fakeApi(getStatus: AiConsentOutcome, grant: AiConsentOutcome = { kind: 'ok', status: GRANTED }) {
  const api = {
    getStatus: jest.fn(async () => getStatus),
    grantRoman: jest.fn(async () => grant),
  };
  return api as typeof api & AiConsentSheetApi;
}

describe('AiRefusalNotice — client consent_required', () => {
  it('Allow AI help -> server copy -> grant with version, sha256 and platform -> retries the request', async () => {
    const api = fakeApi({ kind: 'ok', status: status() });
    const onRetry = jest.fn();
    const r = await render(
      <AiRefusalNotice
        refusal={{ kind: 'consent_required' }}
        audience="client"
        surface="roman"
        onRetry={onRetry}
        consentApi={api}
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
      version: 'client-ai-v3',
      copy_sha256: 'c'.repeat(64),
      platform: expect.stringMatching(/^(ios|android|web)$/),
    });
  });

  it('Not now records nothing and does not retry', async () => {
    const api = fakeApi({ kind: 'ok', status: status() });
    const onRetry = jest.fn();
    const r = await render(
      <AiRefusalNotice refusal={{ kind: 'consent_required' }} audience="client" surface="guide" onRetry={onRetry} consentApi={api} testID="n" />,
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
      <AiRefusalNotice refusal={{ kind: 'consent_required' }} audience="client" surface="insight" onRetry={onRetry} consentApi={api} testID="n" />,
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
      <AiRefusalNotice refusal={{ kind: 'consent_required' }} audience="client" surface="roman" consentApi={api} onContactSupport={jest.fn()} testID="n" />,
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
      <AiRefusalNotice refusal={{ kind: 'consent_required' }} audience="client" surface="roman" consentApi={api} testID="n" />,
    );
    await fireEvent.press(r.getByTestId('n-allow'));
    await waitFor(() => expect(r.getByText(AI_CONSENT_SHEET_COPY.loadFailed)).toBeTruthy());
    expect(r.queryByTestId('n-consent-sheet-allow')).toBeNull();
  });

  it('a failed grant keeps AI help off, says so, and offers Try again', async () => {
    const api = fakeApi({ kind: 'ok', status: status() }, { kind: 'error', status: 500, requestId: 'grant-ref-99' });
    const onRetry = jest.fn();
    const r = await render(
      <AiRefusalNotice refusal={{ kind: 'consent_required' }} audience="client" surface="roman" onRetry={onRetry} consentApi={api} testID="n" />,
    );
    await fireEvent.press(r.getByTestId('n-allow'));
    await waitFor(() => expect(r.getByTestId('n-consent-sheet-allow')).toBeTruthy());
    await fireEvent.press(r.getByTestId('n-consent-sheet-allow'));
    await waitFor(() => expect(r.getByText(AI_CONSENT_SHEET_COPY.saveFailed)).toBeTruthy());
    expect(r.getByTestId('n-consent-sheet-try-again')).toBeTruthy();
    expect(onRetry).not.toHaveBeenCalled();
  });
});

describe('AiRefusalNotice — coach consent_required', () => {
  it('no grant action for the coach; Try again re-runs the request', async () => {
    const onRetry = jest.fn();
    const r = await render(
      <AiRefusalNotice refusal={{ kind: 'consent_required' }} audience="coach" surface="draft" onRetry={onRetry} testID="n" />,
    );
    expect(r.getByTestId('n-title').props.children).toBe('This client has not allowed AI help');
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
    expect(r.getByTestId('n-title').props.children).toBe('AI help is paused on our side');
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
