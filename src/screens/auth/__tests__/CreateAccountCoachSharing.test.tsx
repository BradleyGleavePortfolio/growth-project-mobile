/** B-SHARE-127: with a code, Create account / Google / Apple is the join; sentence and field only when advertised. */
import React, { type ComponentProps } from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockPolicy = jest.fn();
const mockSignup = jest.fn();
jest.mock('../../../services/api', () => ({
  authApi: {
    getSignupPolicy: () => mockPolicy(),
    signupWithCode: (...a: unknown[]) => mockSignup(...a),
    getInvitePreview: async () => ({ data: { valid: true, coach_name: 'Bradley' } }),
    validateInviteCode: async () => ({ data: { valid: true, coach_name: 'Bradley' } }),
    login: jest.fn(),
    register: jest.fn(),
  },
}));
jest.mock('expo-clipboard', () => ({ getStringAsync: jest.fn(), setStringAsync: jest.fn() }));
const mockApple = jest.fn();
jest.mock('../../../utils/appleAuth', () => ({ signInWithApple: (...a: unknown[]) => mockApple(...a) }));
const mockGoogle = jest.fn();
jest.mock('../../../utils/googleAuth', () => ({ signInWithGoogle: (...a: unknown[]) => mockGoogle(...a) }));
jest.mock('../../../components/AppleSignInButton', () => {
  const { TouchableOpacity } = jest.requireActual('react-native');
  return { __esModule: true, default: ({ onPress }: { onPress: () => void }) => <TouchableOpacity testID="apple-button" onPress={onPress} /> };
});
jest.mock('../../../services/secureStorage', () => ({
  secureStorage: { setItem: jest.fn(async () => undefined), getItem: jest.fn(async () => null), removeItem: jest.fn(async () => undefined) },
}));
jest.mock('../../../lib/userCache', () => ({ setUserCache: jest.fn(async () => undefined) }));
jest.mock('../../../services/queryClient', () => ({ purgePersistedQueryCacheForAllUsers: jest.fn(async () => undefined) }));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../theme/ThemeProvider', () => ({ useTheme: () => ({
    colors: new Proxy({}, { get: () => '#000000' }),
    semanticColors: jest.requireActual('../../../theme/tokens').lightTokens,
  }) }));
jest.mock('../../../utils/authEvents', () => ({ authEvents: { emit: jest.fn() } }));

import CreateAccountScreen from '../CreateAccountScreen';
import { __resetSignupPolicyCacheForTests } from '../../../lib/signupPolicy';
import { resetCoachSharingNoticeForTests } from '../../../lib/coachSharingNotice';

const V1 = 'coach_sharing_join_v1';
const PRODUCTION = { invite_code_required: false, providers: ['email', 'google', 'apple'] };
const fakeNav = <T extends object>(): T => new Proxy({}, { get: () => jest.fn() }) as T;

async function signUpEverywhere(sentenceShown: boolean) {
  const utils = await render(
    <CreateAccountScreen
      navigation={fakeNav<ComponentProps<typeof CreateAccountScreen>['navigation']>()}
      route={{ params: { invite_code: 'GP-TEST1' } }}
    />,
  );
  await waitFor(() => expect(utils.queryByTestId('signup-policy-loading')).toBeNull());
  expect(await utils.findByText(/You will be paired with/)).toBeTruthy();
  await waitFor(() => expect(mockPolicy.mock.calls.length).toBeGreaterThanOrEqual(2));
  const notice = sentenceShown ? await utils.findByTestId('coach-sharing-notice') : utils.queryByTestId('coach-sharing-notice');
  await fireEvent.press(utils.getByLabelText('Continue with Google'));
  await waitFor(() => expect(mockGoogle).toHaveBeenCalledTimes(1));
  await fireEvent.press(utils.getByTestId('apple-button'));
  await waitFor(() => expect(mockApple).toHaveBeenCalledTimes(1));
  await fireEvent.changeText(utils.getByLabelText('Full name'), 'Pat Client');
  await fireEvent.changeText(utils.getByLabelText('Email'), 'pat@example.com');
  await fireEvent.changeText(utils.getByLabelText('Password'), 'Str0ng!pass');
  await fireEvent.press(utils.getByLabelText('Create account'));
  await waitFor(() => expect(mockSignup).toHaveBeenCalledTimes(1));
  const [email, google, apple] = [mockSignup, mockGoogle, mockApple].map((m) => m.mock.calls[0][0]);
  return { notice: notice?.props.children ?? null, email, google, apple };
}

beforeEach(async () => {
  jest.clearAllMocks();
  __resetSignupPolicyCacheForTests();
  resetCoachSharingNoticeForTests();
  await AsyncStorage.clear();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockSignup.mockResolvedValue({ data: { requires_verification: true, invite_attached: true } });
  mockGoogle.mockResolvedValue({ success: false, error: 'Google sign-in did not finish.' });
  mockApple.mockResolvedValue({ success: false, cancelled: true });
});

it('current production policy: no sentence, and no sign-up sends the notice', async () => {
  mockPolicy.mockResolvedValue({ data: PRODUCTION });
  const r = await signUpEverywhere(false);
  expect(r.notice).toBeNull();
  expect(r.email).toMatchObject({ invite_code: 'GP-TEST1' });
  for (const sent of [r.email, r.google, r.apple]) {
    expect(sent).not.toHaveProperty('coach_sharing_notice');
    expect(sent).not.toHaveProperty('coachSharingNotice');
  }
});

it('advertised version: the sentence names the coach and every sign-up sends the version', async () => {
  mockPolicy.mockResolvedValue({ data: { ...PRODUCTION, coach_sharing_notice: V1 } });
  const r = await signUpEverywhere(true);
  expect(r.notice).toBe(
    'Joining shares your workouts, food logs, weigh-ins and check-ins with Bradley. Change this any time in Settings > Privacy.',
  );
  expect(r.email).toMatchObject({ invite_code: 'GP-TEST1', coach_sharing_notice: V1 });
  expect(r.google).toMatchObject({ inviteCode: 'GP-TEST1', coachSharingNotice: V1 });
  expect(r.apple).toMatchObject({ inviteCode: 'GP-TEST1', coachSharingNotice: V1 });
});
