/**
 * B32 (prototype 68): "Before Roman answers". Without a live Roman grant the
 * consent sheet opens before anything can be sent; Allow records consent
 * through the existing ledger and keeps the room; Not now closes Roman. A
 * live grant, a coach, or an unreadable status never opens it (the server's
 * 403 ai_consent_required stays the safety net).
 */
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import RomanConsentGate from '../RomanConsentGate';
import { AI_CONSENT_SHEET_COPY, type AiConsentSheetApi } from '../../ai/AiConsentSheet';
import type { AiConsentOutcome, AiConsentStatusResponse } from '../../../api/aiConsentApi';
import { resetAiLedgerWritesForTests } from '../../../lib/consultation/aiConsent';
import { AI_CONSENT_CHECKBOX_LABEL, AI_CONSENT_COPY_SHA256, AI_CONSENT_PARAGRAPH } from '../../../lib/consultation/copy';
import { AI_CONSENT_VERSION } from '../../../lib/consultation/consentVersion';

const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  NavigationContext: jest.requireActual('react').createContext({ goBack: () => mockGoBack() }),
}));
jest.mock('../../../services/sentry', () => ({ captureError: jest.fn() }));
jest.mock('../../../lib/userCache', () => ({ readUserCacheSync: () => ({ id: 'client-me' }) }));
const mockOpenPrivacy = jest.fn();
jest.mock('../../../lib/legalLinks', () => ({ openPrivacyPolicyPage: () => mockOpenPrivacy() }));

const copy = {
  version: AI_CONSENT_VERSION,
  paragraph: { text: AI_CONSENT_PARAGRAPH, sha256: 'b'.repeat(64) },
  box_label: { text: AI_CONSENT_CHECKBOX_LABEL, sha256: 'a'.repeat(64) },
  sha256: AI_CONSENT_COPY_SHA256,
};
const OFF: AiConsentStatusResponse = {
  granted: false, state: 'not_granted', version: null, granted_at: null, withdrawn_at: null,
  current_version: AI_CONSENT_VERSION, needs_reconsent: false, copy,
};
const LIVE: AiConsentStatusResponse = {
  ...OFF, granted: true, state: 'granted', version: AI_CONSENT_VERSION, granted_at: '2026-10-08T18:00:00Z',
};

function makeApi(first: AiConsentOutcome): AiConsentSheetApi & { getStatus: jest.Mock; grantRoman: jest.Mock } {
  return {
    getStatus: jest.fn(async (): Promise<AiConsentOutcome> => first),
    grantRoman: jest.fn(async (): Promise<AiConsentOutcome> => ({ kind: 'ok', status: LIVE })),
  };
}

beforeEach(async () => {
  jest.clearAllMocks();
  resetAiLedgerWritesForTests();
  await AsyncStorage.clear();
});

it('opens before the first answer with the prototype title, paired actions and Privacy Policy', async () => {
  const api = makeApi({ kind: 'ok', status: OFF });
  const r = await render(<RomanConsentGate surface="client" api={api} />);
  await waitFor(() => expect(r.getByTestId('roman-consent-gate-allow')).toBeTruthy());
  expect(r.getByRole('header', { name: AI_CONSENT_SHEET_COPY.beforeAnswerTitle })).toBeTruthy();
  expect(r.getByText(AI_CONSENT_PARAGRAPH)).toBeTruthy();
  expect(r.getByTestId('roman-consent-gate-allow').props.accessibilityLabel).toBe('Allow and continue');
  await fireEvent.press(r.getByTestId('roman-consent-gate-privacy'));
  expect(mockOpenPrivacy).toHaveBeenCalledTimes(1);
  await fireEvent.press(r.getByTestId('roman-consent-gate-not-now'));
  expect(mockGoBack).toHaveBeenCalledTimes(1);
  expect(api.grantRoman).not.toHaveBeenCalled();
});

it('Allow records consent through the existing ledger and keeps the room open', async () => {
  const api = makeApi({ kind: 'ok', status: OFF });
  const r = await render(<RomanConsentGate surface="client" api={api} />);
  await waitFor(() => expect(r.getByTestId('roman-consent-gate-allow')).toBeTruthy());
  await fireEvent.press(r.getByTestId('roman-consent-gate-allow'));
  await waitFor(() => expect(r.queryByTestId('roman-consent-gate-allow')).toBeNull());
  expect(api.grantRoman).toHaveBeenCalledTimes(1);
  expect(mockGoBack).not.toHaveBeenCalled();
});

it.each([
  ['a live grant', { kind: 'ok', status: LIVE } as AiConsentOutcome],
  ['an unreadable status', { kind: 'error', status: 500 } as AiConsentOutcome],
])('stays closed for %s', async (_label, outcome) => {
  const api = makeApi(outcome);
  const r = await render(<RomanConsentGate surface="client" api={api} />);
  await waitFor(() => expect(api.getStatus).toHaveBeenCalledTimes(1));
  expect(r.queryByTestId('roman-consent-gate-allow')).toBeNull();
});

it('never asks a coach', async () => {
  const api = makeApi({ kind: 'ok', status: OFF });
  const r = await render(<RomanConsentGate surface="coach" api={api} />);
  expect(api.getStatus).not.toHaveBeenCalled();
  expect(r.toJSON()).toBeNull();
});
