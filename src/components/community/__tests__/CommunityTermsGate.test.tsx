/**
 * CommunityTermsGate (Apple Guideline 1.2, B-IOSREV-2).
 *
 *  - A person who has not agreed sees the guidelines, the zero-tolerance
 *    sentence, "Agree and continue" and "Read the Terms of Service"; Community
 *    itself is not rendered.
 *  - "Agree and continue" opens Community and stores the agreement under the
 *    person's own key; next time Community opens straight away.
 *  - Another account's agreement on the same phone does not count.
 *  - "Read the Terms of Service" opens /terms; a link that does not open names
 *    the page and gives its web address.
 *  - The client and coach Community stacks and More > Community sit behind it.
 */
import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import { Alert, Linking, Text } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

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
jest.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => (mockUserId ? { id: mockUserId, email: 'me@example.test' } : null),
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

import CommunityTermsGate, {
  COMMUNITY_TERMS_COPY,
  communityTermsKey,
} from '../CommunityTermsGate';
import { COMMUNITY_GUIDELINES } from '../../../api/communitySafetyApi';
import { TERMS_URL } from '../../../config/env';

const ROOT = path.join(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function renderGate() {
  return render(
    <CommunityTermsGate>
      <Text testID="community-content">Community feed</Text>
    </CommunityTermsGate>,
  );
}

let openUrl: jest.SpyInstance;
let alertSpy: jest.SpyInstance;
beforeEach(() => {
  mockStore.clear();
  mockSet.mockClear();
  mockUserId = 'u-me';
  openUrl = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(() => {
  openUrl.mockRestore();
  alertSpy.mockRestore();
});

describe('CommunityTermsGate', () => {
  it('asks before first use and keeps Community closed until the person agrees', async () => {
    const screen = await renderGate();
    expect(await screen.findByTestId('community-terms-gate')).toBeTruthy();
    expect(screen.queryByTestId('community-content')).toBeNull();
    expect(screen.getByText(COMMUNITY_TERMS_COPY.title)).toBeTruthy();
    for (const line of COMMUNITY_GUIDELINES) {
      expect(screen.getByText(`\u2022 ${line}`)).toBeTruthy();
    }
    expect(screen.getByTestId('community-terms-zero-tolerance').props.children).toBe(
      'There is no tolerance for objectionable content or abusive users. Content that breaks these guidelines is removed, and the account that posted it can be removed.',
    );
    expect(screen.getByText('Agree and continue')).toBeTruthy();
    expect(screen.getByText('Read the Terms of Service')).toBeTruthy();
  });

  it('"Agree and continue" opens Community and stores the agreement for this person only', async () => {
    const screen = await renderGate();
    await fireEvent.press(await screen.findByTestId('community-terms-agree'));
    expect(await screen.findByTestId('community-content')).toBeTruthy();
    expect(mockSet).toHaveBeenCalledWith(communityTermsKey('u-me'), expect.any(String));
    expect(communityTermsKey('u-me')).toBe('community_terms_agreed:v1:u-me');
    expect(mockStore.has('community_terms_agreed:v1:u-me')).toBe(true);
  });

  it('after agreeing once, Community opens straight away', async () => {
    mockStore.set(communityTermsKey('u-me'), '2026-10-05T00:00:00.000Z');
    const screen = await renderGate();
    expect(await screen.findByTestId('community-content')).toBeTruthy();
    expect(screen.queryByTestId('community-terms-gate')).toBeNull();
  });

  it("another account's agreement on the same phone does not count", async () => {
    mockStore.set(communityTermsKey('u-other'), '2026-10-05T00:00:00.000Z');
    const screen = await renderGate();
    expect(await screen.findByTestId('community-terms-gate')).toBeTruthy();
    expect(screen.queryByTestId('community-content')).toBeNull();
  });

  it('waits for the signed-in user before deciding', async () => {
    mockUserId = null;
    const screen = await renderGate();
    expect(screen.getByTestId('community-terms-loading')).toBeTruthy();
    expect(screen.queryByTestId('community-content')).toBeNull();
    expect(screen.queryByTestId('community-terms-agree')).toBeNull();
  });

  it('"Read the Terms of Service" opens the public terms page', async () => {
    const screen = await renderGate();
    await fireEvent.press(await screen.findByTestId('community-terms-read-terms'));
    expect(openUrl).toHaveBeenCalledWith(TERMS_URL);
    expect(TERMS_URL).toBe('https://app.trygrowthproject.com/terms');
  });

  it('a terms link that does not open names the page and gives its address', async () => {
    openUrl.mockRejectedValueOnce(new Error('no browser'));
    const screen = await renderGate();
    await act(async () => {
      await fireEvent.press(await screen.findByTestId('community-terms-read-terms'));
    });
    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith(
        'Terms of Service',
        'This phone could not open the link. Open app.trygrowthproject.com/terms in any web browser to read the Terms of Service.',
      ),
    );
  });

  it('copy has no first person and no exclamation marks', () => {
    for (const text of Object.values(COMMUNITY_TERMS_COPY)) {
      expect(text).not.toMatch(/!|\b(we|our|us|I)\b/);
    }
  });
});

describe('every Community entry sits behind the gate', () => {
  it('client Community stack', () => {
    const src = read('navigation/CommunityNavigator.tsx');
    expect(src).toMatch(
      /export default function CommunityNavigator\(\): React\.ReactElement \{\s*return \(\s*<CommunityTermsGate>\s*<CommunityNavigatorStack \/>\s*<\/CommunityTermsGate>/,
    );
  });

  it('coach Community stack', () => {
    const src = read('navigation/CoachCommunityNavigator.tsx');
    expect(src).toMatch(
      /export default function CoachCommunityNavigator\(\): React\.ReactElement \{\s*return \(\s*<CommunityTermsGate>\s*<CoachCommunityNavigatorStack \/>\s*<\/CommunityTermsGate>/,
    );
  });

  it('More > Community wins feed', () => {
    const src = read('navigation/ClientNavigator.tsx');
    expect(src).toContain('withProtectedScreen(withCommunityTerms(CommunityScreen))');
  });
});
