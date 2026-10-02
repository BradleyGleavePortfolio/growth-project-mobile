/**
 * Test harness for ConsultationFlow: a mocked API (intake save / state /
 * complete, and the optional box 2 grant and withdraw on the AI consent
 * ledger), a completion payload, and a seeder that writes the encrypted
 * local draft through the real storage.
 */
import type { CompleteOnboardingResponse, CompleteOutcome } from '../../../api/consultationApi';
import type { AiConsentOutcome, AiConsentStatusResponse } from '../../../api/aiConsentApi';
import type { ConsultationApi } from '../../../screens/consultation/ConsultationFlow';
import { AI_CONSENT_VERSION } from '../consentVersion';
import { writeLocalState } from '../storage';
import { resetAiLedgerWritesForTests } from '../aiConsent';
import type { Answers } from '../types';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

export const RESULT: CompleteOnboardingResponse = {
  macros: { calories: 1789, protein_g: 150, carbs_g: 185, fat_g: 50, method: 'Mifflin-St Jeor', floor_applied: false },
  program: {
    id: 'prog-a',
    name: 'Foundations',
    days_per_week: 3,
    weeks: 4,
    why: ['You are new to structured training.', 'You train at home with dumbbells.', 'Three days fit your week.'],
  },
  spaces: [{ id: 'sp1', name: 'All members' }],
  coach: { id: 'coach-1', display_name: 'Bradley' },
};

/** A GET /me/ai-consent body (backend #622 shape). Defaults to "not granted". */
export function aiStatus(over: Partial<AiConsentStatusResponse> = {}): AiConsentStatusResponse {
  return {
    purpose: 'client_ai_processing',
    processor: 'anthropic',
    granted: false,
    state: 'not_granted',
    version: null,
    granted_at: null,
    withdrawn_at: null,
    current_version: AI_CONSENT_VERSION,
    needs_reconsent: false,
    copy: null,
    ...over,
  };
}

export const AI_ALLOWED = aiStatus({ granted: true, state: 'granted', version: AI_CONSENT_VERSION, granted_at: '2026-09-30T19:00:00.000Z' });

export function makeApi(overrides: Partial<Record<keyof ConsultationApi, jest.Mock>> = {}) {
  const api = {
    save: jest.fn(async () => ({ saved_at: '2026-09-30T19:00:00Z', completed_chapters: [1] })),
    getState: jest.fn(async () => null),
    complete: jest.fn(async (): Promise<CompleteOutcome> => ({ kind: 'ok', data: RESULT })),
    // GET /me/ai-consent: not deployed by default (box 2 starts from the draft).
    getRomanConsent: jest.fn(async (): Promise<AiConsentOutcome> => ({ kind: 'unavailable', status: 404 })),
    grantRomanConsent: jest.fn(async (): Promise<AiConsentOutcome> => ({ kind: 'ok', status: AI_ALLOWED })),
    withdrawRomanConsent: jest.fn(async (): Promise<AiConsentOutcome> => ({ kind: 'ok', status: aiStatus() })),
    ...overrides,
  };
  return api as ConsultationApi & typeof api;
}

/** Seed the encrypted draft. `dirty` defaults to true (unsynced local edits). */
export async function seedLocal(
  answers: Answers,
  screenId: string,
  opts: { userId?: string; dirty?: boolean; editedAt?: string; synced?: { saved_at: string | null; revision: number | null } | null; aiRoman?: boolean; aiWant?: boolean; aiAttempted?: boolean } = {},
) {
  await writeLocalState(opts.userId ?? 'u1', {
    answers,
    screenId,
    dirty: opts.dirty ?? true,
    editedAt: opts.editedAt ?? '2026-09-30T19:00:00.000Z',
    synced: opts.synced ?? null,
    ...(opts.aiRoman === undefined ? {} : { aiRoman: opts.aiRoman }),
    ...(opts.aiWant === undefined ? {} : { aiWant: opts.aiWant }),
    ...(opts.aiAttempted === undefined ? {} : { aiAttempted: opts.aiAttempted }),
  });
}

/** Clear AsyncStorage, the SecureStore mock and the ledger write queue between tests. */
export async function resetStores() {
  resetAiLedgerWritesForTests();
  await AsyncStorage.clear();
  const store: unknown = Reflect.get(SecureStore, '__store');
  if (store instanceof Map) store.clear();
}
