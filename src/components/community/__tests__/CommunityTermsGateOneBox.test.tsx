/**
 * STORE-E4 (agent 185; owner #184-E5 / #184-E6 op 1): the one-box "Before we start" includes the
 * community guidelines, so the first Community visit does not ask again — for that client only.
 *
 *  - A client whose server record is a current one-box agreement (consult-consent-v19 or
 *    consult-consent-v18-coach-free) opens Community straight away, and the phone remembers it.
 *  - A client who agreed to an older screen, a client with no record, an unreadable record and a coach
 *    all still see the Community gate.
 */
import React from 'react';
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';

const mockStore = new Map<string, string>();
const mockSet = jest.fn(async (key: string, value: string) => {
  mockStore.set(key, value);
});
jest.mock('../../../storage/mmkv', () => ({
  prefsStorage: {
    getStringAsync: async (key: string) => mockStore.get(key),
    set: (key: string, value: string) => mockSet(key, value),
  },
}));

let mockUserId: string | null = 'u-me';
let mockRole: string | undefined = 'student';
jest.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => (mockUserId ? { id: mockUserId, email: 'me@example.test', role: mockRole } : null),
}));
jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return { useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }) };
});
jest.mock('react-native-safe-area-context', () => {
  const actual = jest.requireActual('react-native-safe-area-context');
  const { View } = require('react-native');
  return { ...actual, SafeAreaView: View };
});
jest.mock('../../HapticPressable', () => {
  const React = require('react');
  const { Pressable } = require('react-native');
  return {
    __esModule: true,
    default: ({
      children,
      onPress,
      testID,
    }: {
      children: React.ReactNode;
      onPress?: () => void;
      testID?: string;
    }) => React.createElement(Pressable, { onPress, testID }, children),
  };
});

import CommunityTermsGate, { communityTermsKey } from '../CommunityTermsGate';
import type { OnboardingStateResponse } from '../../../api/consultationApi';
import { agreedToCommunityInConsultation } from '../../../lib/consultation/communityAgreement';
import {
  CONSULT_CONSENT_COPY_VERSION,
  CONSULT_CONSENT_ONE_BOX_COPY_VERSION,
  CONSULT_CONSENT_ONE_BOX_COACH_FREE_COPY_VERSION,
} from '../../../lib/consultation/consentVersion';

function stateWith(copyVersion: string | null, recorded = true): OnboardingStateResponse {
  return {
    answers: copyVersion
      ? ({ P0: { agreed: true, agreed_at: '2026-10-30T03:00:00.000Z', copy_version: copyVersion } } as never)
      : null,
    completed: false,
    consent_recorded: recorded,
  };
}

async function renderGate(read: () => Promise<OnboardingStateResponse | null>) {
  return await render(
    <CommunityTermsGate readOnboarding={read}>
      <Text testID="community-content">Community feed</Text>
    </CommunityTermsGate>,
  );
}

beforeEach(() => {
  mockStore.clear();
  mockSet.mockClear();
  mockUserId = 'u-me';
  mockRole = 'student';
});

describe('CommunityTermsGate after the one-box Before we start (STORE-E4)', () => {
  it.each([CONSULT_CONSENT_ONE_BOX_COPY_VERSION, CONSULT_CONSENT_ONE_BOX_COACH_FREE_COPY_VERSION])(
    'a client who agreed to %s opens Community straight away and the phone remembers it',
    async (version) => {
      const read = jest.fn(async () => stateWith(version));
      const screen = await renderGate(read);
      expect(await screen.findByTestId('community-content')).toBeTruthy();
      expect(screen.queryByTestId('community-terms-gate')).toBeNull();
      expect(read).toHaveBeenCalledTimes(1);
      expect(mockSet).toHaveBeenCalledWith(communityTermsKey('u-me'), expect.any(String));
    },
  );

  it('a client who agreed to the older screen still sees the gate', async () => {
    const screen = await renderGate(async () => stateWith(CONSULT_CONSENT_COPY_VERSION));
    expect(await screen.findByTestId('community-terms-gate')).toBeTruthy();
    expect(screen.queryByTestId('community-content')).toBeNull();
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('no current agreement on file, no record, or an unreadable record: the gate shows', async () => {
    for (const read of [
      async () => stateWith(CONSULT_CONSENT_ONE_BOX_COPY_VERSION, false),
      async () => stateWith(null),
      async () => null,
      async () => {
        throw new Error('offline');
      },
    ]) {
      mockStore.clear();
      const screen = await renderGate(read);
      expect(await screen.findByTestId('community-terms-gate')).toBeTruthy();
      expect(screen.queryByTestId('community-content')).toBeNull();
      await screen.unmount();
    }
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('a coach keeps the gate and the record is not read', async () => {
    mockRole = 'coach';
    const read = jest.fn(async () => stateWith(CONSULT_CONSENT_ONE_BOX_COPY_VERSION));
    const screen = await renderGate(read);
    expect(await screen.findByTestId('community-terms-gate')).toBeTruthy();
    expect(read).not.toHaveBeenCalled();
  });

  it('a stored agreement opens Community without reading the record', async () => {
    mockStore.set(communityTermsKey('u-me'), '2026-10-01T00:00:00.000Z');
    const read = jest.fn(async () => null);
    const screen = await renderGate(read);
    expect(await screen.findByTestId('community-content')).toBeTruthy();
    expect(read).not.toHaveBeenCalled();
  });

  it('agreedToCommunityInConsultation needs agreed: true on a one-box version', () => {
    expect(agreedToCommunityInConsultation(stateWith(CONSULT_CONSENT_ONE_BOX_COPY_VERSION))).toBe(true);
    expect(agreedToCommunityInConsultation(stateWith(CONSULT_CONSENT_COPY_VERSION))).toBe(false);
    expect(agreedToCommunityInConsultation(null)).toBe(false);
    expect(
      agreedToCommunityInConsultation({
        answers: { P0: { agreed: false, copy_version: CONSULT_CONSENT_ONE_BOX_COPY_VERSION } } as never,
        completed: false,
        consent_recorded: true,
      }),
    ).toBe(false);
  });
});
