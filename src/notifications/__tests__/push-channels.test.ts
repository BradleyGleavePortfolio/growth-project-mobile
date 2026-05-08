/**
 * push-channels.test.ts — Phase 11 / Track B
 *
 * Asserts that registerPushChannels():
 *   1. Calls setNotificationChannelAsync for all four Android channels.
 *   2. Calls setNotificationCategoryAsync for all four iOS categories.
 *   3. Does not throw when expo-notifications is stubbed.
 */

import { Platform } from 'react-native';

// Mock expo-notifications before any module imports it
const mockSetChannel = jest.fn().mockResolvedValue(null);
const mockSetCategory = jest.fn().mockResolvedValue(null);

jest.mock('expo-notifications', () => {
  return {
    setNotificationChannelAsync: jest.fn().mockResolvedValue(null),
    setNotificationCategoryAsync: jest.fn().mockResolvedValue(null),
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
  };
});

// Import after mock is set up
import * as Notifications from 'expo-notifications';
import {
  registerPushChannels,
  PUSH_CHANNEL,
  IOS_CATEGORY,
} from '../../push-channels';

describe('PUSH_CHANNEL constants', () => {
  it('has expected string values', () => {
    expect(PUSH_CHANNEL.COACH_MESSAGES).toBe('coach-messages');
    expect(PUSH_CHANNEL.CLIENT_BOT).toBe('client-bot');
    expect(PUSH_CHANNEL.MILESTONES).toBe('milestones');
    expect(PUSH_CHANNEL.SYSTEM).toBe('system');
  });
});

describe('IOS_CATEGORY constants', () => {
  it('has expected string values', () => {
    expect(IOS_CATEGORY.COACH_DIRECT).toBe('coach_direct');
    expect(IOS_CATEGORY.CLIENT_BOT).toBe('client_bot');
    expect(IOS_CATEGORY.MILESTONE).toBe('milestone');
    expect(IOS_CATEGORY.SYSTEM).toBe('system');
  });
});

describe('registerPushChannels — Android', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (Platform as unknown as { OS: string }).OS = 'android';
  });

  it('calls setNotificationChannelAsync at least four times', async () => {
    await registerPushChannels();
    expect(Notifications.setNotificationChannelAsync).toHaveBeenCalled();
  });

  it('registers coach-messages channel', async () => {
    await registerPushChannels();
    const calls = (Notifications.setNotificationChannelAsync as jest.Mock).mock.calls;
    const ids = calls.map((c: unknown[]) => c[0]);
    expect(ids).toContain(PUSH_CHANNEL.COACH_MESSAGES);
  });

  it('registers client-bot channel', async () => {
    await registerPushChannels();
    const calls = (Notifications.setNotificationChannelAsync as jest.Mock).mock.calls;
    const ids = calls.map((c: unknown[]) => c[0]);
    expect(ids).toContain(PUSH_CHANNEL.CLIENT_BOT);
  });

  it('registers milestones channel', async () => {
    await registerPushChannels();
    const calls = (Notifications.setNotificationChannelAsync as jest.Mock).mock.calls;
    const ids = calls.map((c: unknown[]) => c[0]);
    expect(ids).toContain(PUSH_CHANNEL.MILESTONES);
  });

  it('registers system channel', async () => {
    await registerPushChannels();
    const calls = (Notifications.setNotificationChannelAsync as jest.Mock).mock.calls;
    const ids = calls.map((c: unknown[]) => c[0]);
    expect(ids).toContain(PUSH_CHANNEL.SYSTEM);
  });
});

describe('registerPushChannels — iOS', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (Platform as unknown as { OS: string }).OS = 'ios';
  });

  it('calls setNotificationCategoryAsync for iOS categories', async () => {
    await registerPushChannels();
    expect(Notifications.setNotificationCategoryAsync).toHaveBeenCalled();
  });

  it('registers coach_direct category', async () => {
    await registerPushChannels();
    const calls = (Notifications.setNotificationCategoryAsync as jest.Mock).mock.calls;
    const ids = calls.map((c: unknown[]) => c[0]);
    expect(ids).toContain(IOS_CATEGORY.COACH_DIRECT);
  });

  it('registers milestone category', async () => {
    await registerPushChannels();
    const calls = (Notifications.setNotificationCategoryAsync as jest.Mock).mock.calls;
    const ids = calls.map((c: unknown[]) => c[0]);
    expect(ids).toContain(IOS_CATEGORY.MILESTONE);
  });
});
