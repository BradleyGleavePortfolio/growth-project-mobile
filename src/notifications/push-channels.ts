/**
 * push-channels.ts — Android notification channels + iOS notification categories.
 *
 * Phase 11 / Push Notification Taxonomy.
 *
 * Four-tier taxonomy:
 *   1. coach-messages (HIGH)    — direct messages from the assigned coach
 *   2. client-bot   (LOW)       — automated AI/bot nudges (meal, water, reminders)
 *   3. milestones   (DEFAULT)   — streak and PR milestones
 *   4. system       (DEFAULT)   — billing, app updates, critical alerts
 *
 * Called once at app bootstrap (App.tsx initApp) BEFORE notification permission
 * is requested, so channels are registered before the system permission prompt.
 * Android creates channels idempotently — safe to call on every cold start.
 * iOS categories configure actionable notification buttons.
 *
 * Does NOT request permissions — that is handled by requestNotificationPermissions
 * in src/utils/notifications.ts (Phase 9 wiring preserved).
 */

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// ─── Channel / category IDs ───────────────────────────────────────────────────

export const PUSH_CHANNEL = {
  COACH_MESSAGES: 'coach-messages',
  CLIENT_BOT: 'client-bot',
  MILESTONES: 'milestones',
  SYSTEM: 'system',
} as const;

export type PushChannelId = (typeof PUSH_CHANNEL)[keyof typeof PUSH_CHANNEL];

export const IOS_CATEGORY = {
  COACH_DIRECT: 'coach_direct',
  CLIENT_BOT: 'client_bot',
  MILESTONE: 'milestone',
  SYSTEM: 'system',
} as const;

export type IosCategoryId = (typeof IOS_CATEGORY)[keyof typeof IOS_CATEGORY];

// ─── Bootstrap ────────────────────────────────────────────────────────────────

/**
 * Register Android notification channels and iOS notification categories.
 *
 * Idempotent — safe to call on every app start.
 * Silently no-ops if expo-notifications is unavailable.
 */
export async function registerPushChannels(): Promise<void> {
  try {
    if (Platform.OS === 'android') {
      await _registerAndroidChannels();
    } else if (Platform.OS === 'ios') {
      await _registerIosCategories();
    }
  } catch (err) {
    // Never crash the bootstrap — push channel failure is non-fatal.
    if (__DEV__) {
      console.warn('[push-channels] registerPushChannels failed:', err);
    }
  }
}

// ─── Android channels ─────────────────────────────────────────────────────────

async function _registerAndroidChannels(): Promise<void> {
  // Channel 1: coach-messages — HIGH importance so coach DMs break through DND
  await Notifications.setNotificationChannelAsync(PUSH_CHANNEL.COACH_MESSAGES, {
    name: 'Coach Messages',
    description: 'Direct messages from your assigned coach.',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    enableLights: true,
    enableVibrate: true,
    showBadge: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  });

  // Channel 2: client-bot — LOW importance; automated nudges should be subtle
  await Notifications.setNotificationChannelAsync(PUSH_CHANNEL.CLIENT_BOT, {
    name: 'Reminders',
    description: 'Meal, water, and check-in reminders.',
    importance: Notifications.AndroidImportance.LOW,
    vibrationPattern: [0, 100],
    enableLights: false,
    enableVibrate: true,
    showBadge: false,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });

  // Channel 3: milestones — DEFAULT importance; celebratory but not urgent
  await Notifications.setNotificationChannelAsync(PUSH_CHANNEL.MILESTONES, {
    name: 'Milestones',
    description: 'Streak and personal-record notifications.',
    importance: Notifications.AndroidImportance.DEFAULT,
    vibrationPattern: [0, 200, 100, 200],
    enableLights: true,
    enableVibrate: true,
    showBadge: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });

  // Channel 4: system — DEFAULT importance; billing, critical updates
  await Notifications.setNotificationChannelAsync(PUSH_CHANNEL.SYSTEM, {
    name: 'System',
    description: 'App updates, billing, and critical alerts.',
    importance: Notifications.AndroidImportance.DEFAULT,
    vibrationPattern: [0, 250],
    enableLights: false,
    enableVibrate: false,
    showBadge: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  });
}

// ─── iOS categories ───────────────────────────────────────────────────────────

async function _registerIosCategories(): Promise<void> {
  await Notifications.setNotificationCategoryAsync(IOS_CATEGORY.COACH_DIRECT, [
    {
      identifier: 'REPLY',
      buttonTitle: 'Reply',
      options: {
        opensAppToForeground: true,
        isDestructive: false,
        isAuthenticationRequired: false,
      },
    },
    {
      identifier: 'OPEN_MESSAGES',
      buttonTitle: 'Open',
      options: {
        opensAppToForeground: true,
        isDestructive: false,
        isAuthenticationRequired: false,
      },
    },
  ]);

  await Notifications.setNotificationCategoryAsync(IOS_CATEGORY.CLIENT_BOT, [
    {
      identifier: 'LOG_NOW',
      buttonTitle: 'Log Now',
      options: {
        opensAppToForeground: true,
        isDestructive: false,
        isAuthenticationRequired: false,
      },
    },
    {
      identifier: 'DISMISS',
      buttonTitle: 'Dismiss',
      options: {
        opensAppToForeground: false,
        isDestructive: false,
        isAuthenticationRequired: false,
      },
    },
  ]);

  await Notifications.setNotificationCategoryAsync(IOS_CATEGORY.MILESTONE, [
    {
      identifier: 'SHARE',
      buttonTitle: 'Share',
      options: {
        opensAppToForeground: true,
        isDestructive: false,
        isAuthenticationRequired: false,
      },
    },
    {
      identifier: 'VIEW',
      buttonTitle: 'View',
      options: {
        opensAppToForeground: true,
        isDestructive: false,
        isAuthenticationRequired: false,
      },
    },
  ]);

  await Notifications.setNotificationCategoryAsync(IOS_CATEGORY.SYSTEM, [
    {
      identifier: 'VIEW',
      buttonTitle: 'View',
      options: {
        opensAppToForeground: true,
        isDestructive: false,
        isAuthenticationRequired: false,
      },
    },
  ]);
}
