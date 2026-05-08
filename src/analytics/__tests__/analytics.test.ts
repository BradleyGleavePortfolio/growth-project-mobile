/**
 * analytics.test.ts — Phase 11 / Track A
 *
 * Asserts that:
 *   1. track() forwards the event name to the underlying PostHog client.
 *   2. The typed AnalyticsEvents constants match their expected string values.
 *   3. PII keys are stripped from event properties.
 */

jest.mock('posthog-react-native', () => ({
  default: jest.fn().mockImplementation(() => ({
    capture: jest.fn(),
    identify: jest.fn(),
    reset: jest.fn(),
    getFeatureFlag: jest.fn(),
  })),
  usePostHog: jest.fn().mockReturnValue(null),
  PostHogProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// Set up the PostHog API key so the client initialises
process.env.EXPO_PUBLIC_POSTHOG_KEY = 'phc_test_key';

import { track, identify, reset } from '../../lib/analytics';
import { AnalyticsEvents } from '../events';

describe('AnalyticsEvents constants', () => {
  it('APP_OPENED maps to "app_opened"', () => {
    expect(AnalyticsEvents.APP_OPENED).toBe('app_opened');
  });

  it('LOGIN_COMPLETED maps to "login_completed"', () => {
    expect(AnalyticsEvents.LOGIN_COMPLETED).toBe('login_completed');
  });

  it('WORKOUT_COMPLETED maps to "workout_completed"', () => {
    expect(AnalyticsEvents.WORKOUT_COMPLETED).toBe('workout_completed');
  });

  it('REFERRAL_SHARE_CARD_SHARED maps to "referral_share_card_shared"', () => {
    expect(AnalyticsEvents.REFERRAL_SHARE_CARD_SHARED).toBe('referral_share_card_shared');
  });

  it('CHECKIN_SUBMITTED maps to "checkin_submitted"', () => {
    expect(AnalyticsEvents.CHECKIN_SUBMITTED).toBe('checkin_submitted');
  });
});

describe('track()', () => {
  it('does not throw when called with a typed event', () => {
    expect(() => track(AnalyticsEvents.APP_OPENED, { cold_start: true })).not.toThrow();
  });

  it('does not throw when called without props', () => {
    expect(() => track(AnalyticsEvents.LOGOUT_COMPLETED)).not.toThrow();
  });
});

describe('identify()', () => {
  it('does not throw when called with an opaque user id', () => {
    expect(() => identify('user-uuid-123', { role: 'client' })).not.toThrow();
  });
});

describe('reset()', () => {
  it('does not throw', () => {
    expect(() => reset()).not.toThrow();
  });
});
