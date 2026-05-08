/**
 * push-channels.test.ts — Phase 11 / Track B
 *
 * Asserts that registerPushChannels():
 *   1. Calls setNotificationChannelAsync for all four Android channels.
 *   2. Calls setNotificationCategoryAsync for all four iOS categories.
 *   3. Does not throw when expo-notifications is stubbed.
 */

const mockSetChannel = jest.fn().mockResolvedValue(null);
const mockSetCategory = jest.fn().mockResolvedValue(null);

jest.mock('expo-notifications', () => ({
  setNotificationChannelAsync: mockSetChannel,
  setNotificationCategoryAsync: mockSetCategory,
  AndroidImportance: {
    HIGH: 5,
    DEFAULT: 3,
    LOW: 2,
  },
  AndroidNotificationVisibility: {
    PRIVATE: 0,
    PUBLIC: 1,
    SECRET: -1,
  },
}));

import { Platform } from 'react-native';
import {
  registerPushChannels,
  PUSH_CHANNEL,
  IOS_CATEGORY,
} from '../../notifications/push-channels';

describe('registerPushChannels — Android', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // @ts-ignore — override Platform.OS for test
    Platform.OS = 'android';
  });

  it('registers all four Android channels', async () => {
    await registerPushChannels();

    const channelIds = mockSetChannel.mock.calls.map((c) => c[0]);
    expect(channelIds).toContain(PUSH_CHANNEL.COACH_MESSAGES);
    expect(channelIds).toContain(PUSH_CHANNEL.CLIENT_BOT);
    expect(channelIds).toContain(PUSH_CHANNEL.MILESTONES);
    expect(channelIds).toContain(PUSH_CHANNEL.SYSTEM);
  });

  it('sets coach-messages channel to HIGH importance', async () => {
    await registerPushChannels();

    const coachCall = mockSetChannel.mock.calls.find((c) => c[0] === PUSH_CHANNEL.COACH_MESSAGES);
    expect(coachCall).toBeDefined();
    // AndroidImportance.HIGH = 5 in our mock
    expect(coachCall![1].importance).toBe(5);
  });

  it('sets client-bot channel to LOW importance', async () => {
    await registerPushChannels();

    const botCall = mockSetChannel.mock.calls.find((c) => c[0] === PUSH_CHANNEL.CLIENT_BOT);
    expect(botCall).toBeDefined();
    expect(botCall![1].importance).toBe(2);
  });
});

describe('registerPushChannels — iOS', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // @ts-ignore — override Platform.OS for test
    Platform.OS = 'ios';
  });

  it('registers all four iOS categories', async () => {
    await registerPushChannels();

    const categoryIds = mockSetCategory.mock.calls.map((c) => c[0]);
    expect(categoryIds).toContain(IOS_CATEGORY.COACH_DIRECT);
    expect(categoryIds).toContain(IOS_CATEGORY.CLIENT_BOT);
    expect(categoryIds).toContain(IOS_CATEGORY.MILESTONE);
    expect(categoryIds).toContain(IOS_CATEGORY.SYSTEM);
  });

  it('registers REPLY action for coach_direct category', async () => {
    await registerPushChannels();

    const coachCall = mockSetCategory.mock.calls.find((c) => c[0] === IOS_CATEGORY.COACH_DIRECT);
    expect(coachCall).toBeDefined();
    const actions = coachCall![1] as { identifier: string }[];
    expect(actions.some((a) => a.identifier === 'REPLY')).toBe(true);
  });
});

describe('PUSH_CHANNEL constants', () => {
  it('has expected string values', () => {
    expect(PUSH_CHANNEL.COACH_MESSAGES).toBe('coach-messages');
    expect(PUSH_CHANNEL.CLIENT_BOT).toBe('client-bot');
    expect(PUSH_CHANNEL.MILESTONES).toBe('milestones');
    expect(PUSH_CHANNEL.SYSTEM).toBe('system');
  });
});
