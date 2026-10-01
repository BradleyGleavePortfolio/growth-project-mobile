/**
 * Template render tests (wheels, unit tabs, T3 detail, summary edit) plus
 * the API client contract and the rollback flag.
 */
import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import ConsultationFlow, { ConsultationApi } from '../ConsultationFlow';
import { answersBeforeSafety, fullAnswers, NOW } from '../../../lib/consultation/__fixtures__/consultFixtures';
import { makeApi as harnessApi, resetStores, seedLocal } from '../../../lib/consultation/__fixtures__/flowHarness';
import type { Answers } from '../../../lib/consultation/types';

const mockPut = jest.fn();
const mockGet = jest.fn();
const mockPost = jest.fn();
const mockDelete = jest.fn();
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: {
    put: (...a: unknown[]) => mockPut(...a),
    get: (...a: unknown[]) => mockGet(...a),
    post: (...a: unknown[]) => mockPost(...a),
    delete: (...a: unknown[]) => mockDelete(...a),
  },
}));
jest.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));

function makeApi(): ConsultationApi {
  return harnessApi({ complete: jest.fn(async () => ({ kind: 'error' as const, status: 500 })) });
}

async function seed(answers: Answers, screenId: string) {
  await seedLocal(answers, screenId);
}

const renderFlow = (api = makeApi()) =>
  render(<ConsultationFlow userId="u1" firstName="Maya" api={api} onFinished={jest.fn()} now={() => NOW} autoAdvanceMs={0} prepMinMs={0} />);

beforeEach(async () => {
  await resetStores();
  mockPut.mockReset();
  mockGet.mockReset();
  mockPost.mockReset();
  mockDelete.mockReset();
});

describe('templates', () => {
  it('B2 wheels are adjustable and stop under-16s with a calm message', async () => {
    const a = fullAnswers();
    delete a.B2;
    await seed(a, 'B2');
    const r = await renderFlow();
    await waitFor(() => r.getByTestId('consult-screen-B2'));
    const year = r.getByTestId('wheel-dob-year');
    expect(year.props.accessibilityRole).toBe('adjustable');
    expect(year.props.accessibilityValue).toEqual({ text: '1996' });
    // Move the year to 2012 (age 14).
    for (let i = 0; i < 16; i += 1) {
      await fireEvent(r.getByTestId('wheel-dob-year'), 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    }
    expect(r.getByTestId('wheel-dob-year').props.accessibilityValue).toEqual({ text: '2012' });
    expect(r.getByTestId('consult-validation').props.children).toMatch(/16 and over/);
    expect(r.getByTestId('consult-continue').props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('B3 converts units in place without resetting', async () => {
    await seed(fullAnswers(), 'B3');
    const r = await renderFlow();
    await waitFor(() => r.getByTestId('consult-screen-B3'));
    expect(r.getByTestId('wheel-height').props.accessibilityValue).toEqual({ text: '5 ft 6 in' });
    await fireEvent.press(r.getByTestId('unit-metric'));
    expect(r.getByTestId('wheel-height').props.accessibilityValue).toEqual({ text: '168 cm' });
    expect(r.getByTestId('wheel-weight').props.accessibilityValue).toEqual({ text: '78 kg' });
    expect(r.getByTestId('unit-metric').props.accessibilityState).toMatchObject({ selected: true });
  });

  it('B4 shows a soft note, never a block', async () => {
    await seed(fullAnswers({ B4: 230 }), 'B4');
    const r = await renderFlow();
    await waitFor(() => r.getByTestId('consult-screen-B4'));
    expect(r.getByTestId('goal-weight-note').props.children).toMatch(/above your current weight/);
    expect(r.getByTestId('consult-continue').props.accessibilityState).toMatchObject({ disabled: false });
  });

  it('T3 yes expands on the same screen and needs an area', async () => {
    const a = answersBeforeSafety();
    delete a.T3;
    await seed(a, 'T3');
    const r = await renderFlow();
    await waitFor(() => r.getByTestId('consult-screen-T3'));
    await fireEvent.press(r.getByTestId('consult-option-yes'));
    expect(r.getByText('Where?')).toBeTruthy();
    expect(r.getByTestId('consult-continue').props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(r.getByTestId('consult-detail-chip-knee'));
    expect(r.getByTestId('consult-continue').props.accessibilityState).toMatchObject({ disabled: false });
    await fireEvent.press(r.getByTestId('consult-continue'));
    await waitFor(() => r.getByTestId('consult-screen-T4'));
  });

  it('summary Edit jumps to the chapter and its last Continue returns to the summary', async () => {
    await seed(fullAnswers(), 'SUM');
    const r = await renderFlow();
    await waitFor(() => r.getByTestId('consult-screen-SUM'));
    await fireEvent.press(r.getByTestId('summary-edit-1'));
    await waitFor(() => r.getByTestId('consult-screen-G1'));
    await fireEvent.press(r.getByTestId('consult-option-muscle_gain'));
    await waitFor(() => r.getByTestId('consult-screen-G2'));
    await fireEvent.press(r.getByTestId('consult-continue'));
    await waitFor(() => r.getByTestId('consult-screen-SUM'));
    expect(r.getByText(/^Build muscle and strength/)).toBeTruthy();
  });
});

describe('consultationApi', () => {
  // Loaded lazily so the services/api mock above applies.
  const { consultationApi, conflictCodeOf } = jest.requireActual('../../../api/consultationApi') as typeof import('../../../api/consultationApi');

  it('uses the contract routes and body', async () => {
    mockPut.mockResolvedValue({ data: { saved_at: 't', completed_chapters: [1, 2] } });
    await expect(consultationApi.save({ version: 'consult-v1', answers: { G1: 'fat_loss' } })).resolves.toEqual({ saved_at: 't', completed_chapters: [1, 2] });
    expect(mockPut).toHaveBeenCalledWith('/me/onboarding/consultation', { version: 'consult-v1', answers: { G1: 'fat_loss' } });

    mockPost.mockResolvedValue({ data: { macros: {} } });
    await expect(consultationApi.complete()).resolves.toEqual({ kind: 'ok', data: { macros: {} } });
    expect(mockPost).toHaveBeenCalledWith('/me/onboarding/complete', {});

  });

  it('no longer calls the combined onboarding grant (D2: box 1 is the intake P0)', () => {
    expect(Object.keys(consultationApi).sort()).toEqual(['complete', 'getState', 'save']);
    expect(conflictCodeOf({ response: { data: { code: 'CONSENT_VERSION_MISMATCH' } } })).toBe('consent_version_mismatch');
    expect(conflictCodeOf({ response: { data: { code: 'completion_in_progress' } } })).toBe('completion_in_progress');
    expect(conflictCodeOf({ response: { data: { code: 'clinic_not_configured' } } })).toBe('clinic_not_configured');
  });

  it('maps 409 machine codes and other failures', async () => {
    mockPost.mockRejectedValueOnce({ response: { status: 409, data: { code: 'consent_missing' } } });
    await expect(consultationApi.complete()).resolves.toEqual({ kind: 'conflict', code: 'consent_missing' });
    mockPost.mockRejectedValueOnce({ response: { status: 409, data: { error: 'not_attached' } } });
    await expect(consultationApi.complete()).resolves.toEqual({ kind: 'conflict', code: 'not_attached' });
    mockPost.mockRejectedValueOnce({ response: { status: 409, data: { message: 'something else' } } });
    await expect(consultationApi.complete()).resolves.toEqual({ kind: 'conflict', code: 'unknown' });
    mockPost.mockRejectedValueOnce(new Error('Network Error'));
    await expect(consultationApi.complete()).resolves.toEqual({ kind: 'error', status: null });
    expect(conflictCodeOf({ response: { data: { code: 'consultation_incomplete' } } })).toBe('consultation_incomplete');
  });

  it('GET /me/onboarding returns null when the endpoint is not deployed', async () => {
    mockGet.mockRejectedValueOnce({ response: { status: 404 } });
    await expect(consultationApi.getState()).resolves.toBeNull();
    mockGet.mockRejectedValueOnce({ response: { status: 500 } });
    await expect(consultationApi.getState()).rejects.toBeTruthy();
  });
});

describe('aiConsentApi (R2a contract: GET /me/ai-consent, POST and DELETE /me/ai-consent/roman)', () => {
  const { aiConsentApi, isLiveGrant } = jest.requireActual('../../../api/aiConsentApi') as typeof import('../../../api/aiConsentApi');
  const roman = { granted: true, version: 'client-ai-v3', granted_at: '2026-10-01T10:00:00Z', revoked_at: null, current_version: 'client-ai-v3' };

  it('uses the contract routes and body, and parses the status', async () => {
    mockGet.mockResolvedValueOnce({ status: 200, data: { roman, copy: { version: 'client-ai-v3', text: 't', sha256: 'a'.repeat(64), processor: 'anthropic' } } });
    const got = await aiConsentApi.getStatus();
    expect(mockGet).toHaveBeenLastCalledWith('/me/ai-consent');
    expect(got).toMatchObject({ kind: 'ok', status: { roman: { granted: true, version: 'client-ai-v3' }, copy: { version: 'client-ai-v3', sha256: 'a'.repeat(64) } } });

    const body = { version: 'client-ai-v3', copy_sha256: 'b'.repeat(64), platform: 'ios' as const };
    mockPost.mockResolvedValueOnce({ data: { roman } });
    await expect(aiConsentApi.grantRoman(body)).resolves.toMatchObject({ kind: 'ok' });
    expect(mockPost).toHaveBeenLastCalledWith('/me/ai-consent/roman', body);

    mockDelete.mockResolvedValueOnce({ data: { roman: { ...roman, granted: false, revoked_at: '2026-10-01T11:00:00Z' } } });
    await expect(aiConsentApi.withdrawRoman()).resolves.toMatchObject({ kind: 'ok', status: { roman: { granted: false } } });
    expect(mockDelete).toHaveBeenLastCalledWith('/me/ai-consent/roman');
  });

  it('404 and 503 are "unavailable"; 409 CONSENT_VERSION_MISMATCH is explicit; other failures are errors', async () => {
    for (const status of [404, 503]) {
      mockGet.mockRejectedValueOnce({ response: { status } });
      await expect(aiConsentApi.getStatus()).resolves.toEqual({ kind: 'unavailable' });
      mockPost.mockRejectedValueOnce({ response: { status } });
      await expect(aiConsentApi.grantRoman({ version: 'client-ai-v3' })).resolves.toEqual({ kind: 'unavailable' });
      mockDelete.mockRejectedValueOnce({ response: { status } });
      await expect(aiConsentApi.withdrawRoman()).resolves.toEqual({ kind: 'unavailable' });
    }
    mockPost.mockRejectedValueOnce({ response: { status: 409, data: { code: 'CONSENT_VERSION_MISMATCH', current_version: 'client-ai-v4' } } });
    await expect(aiConsentApi.grantRoman({ version: 'client-ai-v3' })).resolves.toEqual({ kind: 'version_mismatch', current_version: 'client-ai-v4' });
    mockPost.mockRejectedValueOnce(new Error('Network Error'));
    await expect(aiConsentApi.grantRoman({ version: 'client-ai-v3' })).resolves.toEqual({ kind: 'error', status: null });
    mockGet.mockResolvedValueOnce({ status: 200, data: { unexpected: true } });
    await expect(aiConsentApi.getStatus()).resolves.toEqual({ kind: 'error', status: 200 });
  });

  it('isLiveGrant needs a current, unrevoked grant of exactly that version', () => {
    expect(isLiveGrant(roman, 'client-ai-v3')).toBe(true);
    expect(isLiveGrant({ ...roman, revoked_at: '2026-10-01T11:00:00Z' }, 'client-ai-v3')).toBe(false);
    expect(isLiveGrant({ ...roman, revoked_at: '2026-10-01T09:00:00Z' }, 'client-ai-v3')).toBe(true);
    expect(isLiveGrant({ ...roman, version: 'client-ai-v2' }, 'client-ai-v3')).toBe(false);
    expect(isLiveGrant({ ...roman, needs_reconsent: true }, 'client-ai-v3')).toBe(false);
    expect(isLiveGrant({ ...roman, granted: false }, 'client-ai-v3')).toBe(false);
  });
});

describe('rollback flag', () => {
  const root = path.resolve(__dirname, '../../../..');

  it('defaults off in general builds', () => {
    jest.isolateModules(() => {
      const prev = process.env.EXPO_PUBLIC_FF_CONSULTATION_ONBOARDING;
      delete process.env.EXPO_PUBLIC_FF_CONSULTATION_ONBOARDING;
      const { featureFlags } = jest.requireActual('../../../config/featureFlags');
      expect(featureFlags.consultationOnboarding).toBe(false);
      if (prev !== undefined) process.env.EXPO_PUBLIC_FF_CONSULTATION_ONBOARDING = prev;
    });
  });

  it('is on only in the clinic EAS profile', () => {
    const eas = JSON.parse(fs.readFileSync(path.join(root, 'eas.json'), 'utf8'));
    expect(eas.build.clinic.env.EXPO_PUBLIC_FF_CONSULTATION_ONBOARDING).toBe('true');
    for (const name of Object.keys(eas.build).filter((n) => n !== 'clinic')) {
      expect(eas.build[name].env?.EXPO_PUBLIC_FF_CONSULTATION_ONBOARDING).toBeUndefined();
    }
  });

  it('RootNavigator mounts the consultation instead of the lean flow when on', () => {
    const src = fs.readFileSync(path.join(root, 'src/navigation/RootNavigator.tsx'), 'utf8');
    expect(src).toMatch(/featureFlags\.consultationOnboarding \? \(\s*<ConsultationOnboardingNavigator \/>\s*\) : \(\s*<LeanOnboardingNavigator \/>/);
  });
});
