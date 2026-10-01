/**
 * Test harness for ConsultationFlow: a mocked API whose consent record is a
 * live grant of the bound versions by default, a completion payload, and a
 * seeder that writes the encrypted local draft through the real storage.
 */
import type {
  CompleteOnboardingResponse,
  CompleteOutcome,
  ConsentStatusResponse,
  GrantConsentOutcome,
} from '../../../api/consultationApi';
import type { ConsultationApi } from '../../../screens/consultation/ConsultationFlow';
import { CONSENT_BINDING } from '../consentVersion';
import { writeLocalState } from '../storage';
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

export function consentStatus(over: Partial<ConsentStatusResponse['roman']> = {}): ConsentStatusResponse {
  return {
    roman: {
      granted: true,
      version: CONSENT_BINDING.ai_consent_version,
      granted_at: '2026-09-30T19:00:00.000Z',
      revoked_at: null,
      current_version: CONSENT_BINDING.ai_consent_version,
      needs_reconsent: false,
      waiver_version: CONSENT_BINDING.waiver_version,
      waiver_accepted_at: '2026-09-30T19:00:00.000Z',
      waiver_current_version: CONSENT_BINDING.waiver_version,
      ...over,
    },
  };
}

export const NOT_GRANTED = consentStatus({ granted: false, version: null, granted_at: null, waiver_version: null, waiver_accepted_at: null });

export function makeApi(overrides: Partial<Record<keyof ConsultationApi, jest.Mock>> = {}) {
  const api = {
    save: jest.fn(async () => ({ saved_at: '2026-09-30T19:00:00Z', completed_chapters: [1] })),
    getState: jest.fn(async () => null),
    complete: jest.fn(async (): Promise<CompleteOutcome> => ({ kind: 'ok', data: RESULT })),
    grantOnboardingConsent: jest.fn(async (): Promise<GrantConsentOutcome> => ({ kind: 'ok', status: consentStatus() })),
    getConsentStatus: jest.fn(async () => consentStatus()),
    ...overrides,
  };
  return api as unknown as ConsultationApi & typeof api;
}

/** Seed the encrypted draft. `dirty` defaults to true (unsynced local edits). */
export async function seedLocal(
  answers: Answers,
  screenId: string,
  opts: { userId?: string; dirty?: boolean; editedAt?: string; synced?: { saved_at: string | null; revision: number | null } | null } = {},
) {
  await writeLocalState(opts.userId ?? 'u1', {
    answers,
    screenId,
    dirty: opts.dirty ?? true,
    editedAt: opts.editedAt ?? '2026-09-30T19:00:00.000Z',
    synced: opts.synced ?? null,
  });
}

/** Clear AsyncStorage and the SecureStore mock between tests. */
export async function resetStores() {
  await AsyncStorage.clear();
  (SecureStore as unknown as { __store?: Map<string, string> }).__store?.clear();
}
