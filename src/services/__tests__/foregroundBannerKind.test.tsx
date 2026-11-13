/**
 * REFINE-966: the banner's mark comes only from the push data's own kind, else its type (strings only), by one exact
 * match in KIND_MARKS (ctx#523 style 1's frames; booking, nudge and community by family, operator 22:4x PST 11-12).
 * Through the real received listener (expo-notifications mocked at its edge, as foregroundBannerTap.test.tsx); each
 * row's data copied key for key from its sender at growth-project-backend 7f566a59c19abd9bb9df42c5680bd13db0b971d5
 * (cited), or the phone's own alert. The kind rides beside pushTapOf, never inside it: the tap mapping is unchanged.
 */
import React from 'react';
import { act, render } from '@testing-library/react-native';
import { Ionicons } from '@expo/vector-icons';

const mockAddResponse = jest.fn((_cb: unknown) => ({ remove: jest.fn() }));
const mockAddReceived = jest.fn((_cb: unknown) => ({ remove: jest.fn() }));
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  addNotificationReceivedListener: (cb: unknown) => mockAddReceived(cb),
  addNotificationResponseReceivedListener: (cb: unknown) => mockAddResponse(cb),
  getLastNotificationResponseAsync: () => Promise.resolve(null),
  clearLastNotificationResponseAsync: () => Promise.resolve(),
  AndroidImportance: { MAX: 5 },
}));
jest.mock('../../theme/ThemeProvider', () => {
  const tokens = jest.requireActual('../../theme/tokens');
  return { useTheme: () => ({ colors: {}, semanticColors: tokens.lightTokens, tokens: tokens.default }) };
});
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 47, bottom: 0, left: 0, right: 0 }) }));
jest.mock('../pushTapRouter', () => {
  const actual = jest.requireActual('../pushTapRouter');
  return { ...actual, routePushTap: jest.fn() };
});

import ForegroundNotificationBanner, { KIND_MARKS, NEUTRAL_MARK } from '../../components/ForegroundNotificationBanner';
import { foregroundBannerStore } from '../../store/foregroundBannerStore';
import { installForegroundHandler, installNotificationResponseHandler, pushTapOf } from '../pushNotifications';
import { routePushTap } from '../pushTapRouter';

const ID = '0b9a2a52-6f0e-4c39-9d43-2f1f3c1f6a01';
const GLYPHS = (Ionicons as unknown as { glyphMap: Record<string, number> }).glyphMap;

type Row = [frame: string, data: Record<string, unknown> | undefined, kind: string | undefined, mark: string];
const FAMILY = '(family mark, operator 22:4x)';
/** The kind table: every sender's data kind or type, its mark and the style 1 frame that draws it. */
const ROWS: Row[] = [
  // message-received.emitter.ts:51, kind added by push-delivery.service.ts:717.
  ['msg_client, msg_coach, modal', { actionScreen: 'Messages', actionParams: { clientId: ID }, deepLink: `tgp://messages/${ID}`, kind: 'message_received' }, 'message_received', 'chatbubble-outline'],
  // booking.emitter.ts:603 (notification-kind.ts:43-57): the drawn two and every other booking kind.
  ['booking_client, two', { actionScreen: 'CalendarSession', actionParams: { sessionId: ID }, deepLink: `tgp://client/sessions/${ID}`, sessionId: ID, kind: 'booking_confirmed' }, 'booking_confirmed', 'calendar-outline'],
  ['booking_coach', { actionScreen: 'CoachBookingInbox', actionParams: { sessionId: ID }, deepLink: `tgp://coach/sessions/${ID}`, sessionId: ID, kind: 'booking_requested' }, 'booking_requested', 'calendar-outline'],
  ...['booking_declined', 'booking_cancelled', 'booking_rescheduled', 'booking_reminder_24h', 'booking_reminder_1h',
    'booking_link_needed', 'booking_link_ready', 'booking_request_expired'].map((kind): Row => [
    FAMILY, { actionScreen: 'CalendarSession', actionParams: { sessionId: ID }, deepLink: `tgp://client/sessions/${ID}`, sessionId: ID, kind }, kind, 'calendar-outline']),
  // purchase-fanout.service.ts:787.
  ['purchase', { actionScreen: 'NotificationCenter', deepLink: `tgp://coach/purchases/${ID}`, kind: 'coach_new_purchase' }, 'coach_new_purchase', 'bag-outline'],
  // reconciliation-daily.cron.ts:271-278: data { type, verdict } (:275), no kind.
  ['money_review', { type: 'money_check', verdict: 'review' }, 'money_check', 'document-text-outline'],
  ['money_clean', { type: 'money_check', verdict: 'ok' }, 'money_check', 'document-text-outline'],
  // dunning-v2.dispatcher.ts:229-237: the sender's own data.
  ['long_body', { kind: 'dunning_payment', actionScreen: 'UpdateCard' }, 'dunning_payment', 'card-outline'],
  ['long_body (dispute)', { kind: 'dunning_dispute', actionScreen: 'NotificationCenter' }, 'dunning_dispute', 'card-outline'],
  // nudge-engine.service.ts:418-426 (copy.ts:50-55), and the other three nudge kinds (notification-kind.ts:62-65).
  ['long_title', { kind: 'nudge_onboarding_abandoned', trigger_type: 'onboarding_abandoned', signal_key: 'k', deep_link: 'tgp://onboarding' }, 'nudge_onboarding_abandoned', 'sparkles-outline'],
  ...['nudge_missed_checkin', 'nudge_streak_broken', 'nudge_inactive'].map((kind): Row => [
    FAMILY, { kind, trigger_type: kind.slice(6), signal_key: 'k', deep_link: 'tgp://checkin/today' }, kind, 'sparkles-outline']),
  // community-notifications.service.ts:265-275 (b#1247's link at :274) and community-space-push.service.ts:136-147.
  ['reply_post', { kind: 'community_post_replied', category: 'community', target_type: 'post', target_id: ID, deepLink: `tgp://community/thread/${ID}` }, 'community_post_replied', 'people-outline'],
  ['space_reply, space_unread, long_space, high_alert', { actionScreen: 'NotificationCenter', deepLink: `tgp://community/cohorts/${ID}`, kind: 'community_message_received' }, 'community_message_received', 'people-outline'],
  ...['community_dm_received', 'community_event_starting_soon', 'community_challenge_milestone',
    'community_moderation_action_against_me', 'community_membership_changed'].map((kind): Row => [
    FAMILY, { kind, category: 'community', target_type: 'post', target_id: ID }, kind, 'people-outline']),
  // The phone's own fasting alert, utils/notifications.ts:117-123: data { type } only.
  ['fasting, offline', { type: 'fasting_complete' }, 'fasting_complete', 'time-outline'],
  // meal_plan_assigned (notification-kind.ts:75): no sender until MEAL-PLAN-NOTICE-BE; a template push's kind (:717).
  ['mealplan', { kind: 'meal_plan_assigned' }, 'meal_plan_assigned', 'restaurant-outline'],
  // Neutral: every other sender (PLAN 6836470005 section 7), one row each.
  ['safety (its own look)', { actionScreen: 'CoachSafetyAlert', deepLink: `tgp://coach/clients/${ID}`, actionParams: { alertId: ID }, kind: 'coach_alert' }, 'coach_alert', 'warning-outline'],
  ['no frame: staff community alert', { actionScreen: 'NotificationCenter', kind: 'coach_alert' }, 'coach_alert', NEUTRAL_MARK],
  ['no frame: workout_assigned', { actionScreen: 'WorkoutMain', deepLink: 'tgp://workouts', kind: 'workout_assigned' }, 'workout_assigned', NEUTRAL_MARK],
  ['no frame: workout_reminder', { kind: 'workout_reminder', deep_link: 'tgp://workouts', local_date: '2026-11-12', first_day: false, assignment_id: ID }, 'workout_reminder', NEUTRAL_MARK],
  ['no frame: plan_renewal', { actionScreen: 'NotificationCenter', deepLink: 'tgp://home', kind: 'plan_renewal' }, 'plan_renewal', NEUTRAL_MARK],
  ['no frame: drip_released', { actionScreen: 'Deliverables', actionParams: { purchaseId: ID }, deepLink: 'tgp://client/library', kind: 'drip_released' }, 'drip_released', NEUTRAL_MARK],
  ['no frame: milestone_reached', { actionScreen: 'NotificationCenter', deepLink: 'tgp://timeline', kind: 'milestone_reached' }, 'milestone_reached', NEUTRAL_MARK],
  ['no frame: missed_checkin', { actionScreen: 'NotificationCenter', deepLink: 'tgp://checkin/today', kind: 'missed_checkin' }, 'missed_checkin', NEUTRAL_MARK],
  ['no frame: weight_trend_alert', { actionScreen: 'NotificationCenter', deepLink: 'tgp://weight', kind: 'weight_trend_alert' }, 'weight_trend_alert', NEUTRAL_MARK],
  ['no frame: checkin_submitted', { actionScreen: 'NotificationCenter', deepLink: `tgp://coach/clients/${ID}/checkins`, kind: 'checkin_submitted' }, 'checkin_submitted', NEUTRAL_MARK],
  ['no frame: build_week_day_unlocked', { actionScreen: 'NotificationCenter', deepLink: 'tgp://build-week/day/3', kind: 'build_week_day_unlocked' }, 'build_week_day_unlocked', NEUTRAL_MARK],
  ['no frame: first_payment', { actionScreen: 'NotificationCenter', deepLink: `tgp://coach/clients/${ID}`, kind: 'first_payment' }, 'first_payment', NEUTRAL_MARK],
  ['no frame: trial_ending', { kind: 'trial_ending', purchase_id: ID, deep_link: 'tgp://plan', actionScreen: 'ClientPackages' }, 'trial_ending', NEUTRAL_MARK],
  ['no frame: import.complete', { kind: 'import.complete', intent_id: 'i', terminal_status: 'completed' }, 'import.complete', NEUTRAL_MARK],
  ['no frame: coach_nudge', { type: 'coach_nudge', kind: 'coach_nudge', actionScreen: 'NotificationCenter', nudge_id: 'n', notification_id: 'r' }, 'coach_nudge', NEUTRAL_MARK],
  ['no frame: fbm-brief (the daily brief)', { deep_link: 'tgp://coach/brief/today', brief_date: '2026-11-12', actionScreen: 'CoachBrief' }, undefined, NEUTRAL_MARK],
  ['no frame: payout_adjustment', { type: 'payout_adjustment', notice_id: 'n', deep_link: 'tgp://coach/money' }, 'payout_adjustment', NEUTRAL_MARK],
  ['no frame: rest over (ActiveWorkoutScreen.tsx:492-497)', { type: 'rest_over' }, 'rest_over', NEUTRAL_MARK],
  // Anything but a string counts as absent; an unknown string is neutral; no data at all.
  ['a kind that is not a string falls to the type', { kind: 7, type: 'fasting_complete' }, 'fasting_complete', 'time-outline'],
  ['neither a string', { kind: { x: 1 }, type: ['money_check'] }, undefined, NEUTRAL_MARK],
  ['an unknown kind', { kind: 'booking' }, 'booking', NEUTRAL_MARK],
  ['no data', undefined, undefined, NEUTRAL_MARK],
];

let receive: (n: unknown) => void;
let tap: (r: unknown) => void;
let seq = 0;
beforeAll(() => {
  installForegroundHandler();
  receive = mockAddReceived.mock.calls[mockAddReceived.mock.calls.length - 1][0] as (n: unknown) => void;
  installNotificationResponseHandler(routePushTap);
  tap = mockAddResponse.mock.calls[mockAddResponse.mock.calls.length - 1][0] as (r: unknown) => void;
});
afterEach(async () => {
  await act(async () => foregroundBannerStore.getState().reset());
  jest.mocked(routePushTap).mockClear();
});
const content = (data: Record<string, unknown> | undefined) => ({ title: 'Stand-in title', body: 'Stand-in body', data });

describe('the kind table: the store keeps the kind or type, and the banner draws its mark', () => {
  it.each(ROWS)('%s', async (_frame, data, kind, mark) => {
    seq += 1;
    await act(async () => receive({ request: { identifier: `k-${seq}`, content: content(data) } }));
    const held = foregroundBannerStore.getState().banner;
    expect(held?.kind).toBe(kind);
    expect(held !== null && 'kind' in held).toBe(kind !== undefined);
    const view = await render(<ForegroundNotificationBanner />);
    const node = view.getByTestId('foreground-banner-mark', { includeHiddenElements: true });
    const drawn = [node.props.children].flat(Infinity).filter((c): c is string => typeof c === 'string').join('');
    expect(drawn).toBe(String.fromCodePoint(GLYPHS[mark]));
    // Never drawn or spoken: only the push's own title and body are words on the card.
    if (kind !== undefined) {
      expect(view.queryByText(kind)).toBeNull();
      expect(view.queryByLabelText(new RegExp(kind.replace('.', '\\.')))).toBeNull();
    }
    await view.unmount();
  });

  it('every mark is a real Ionicons glyph, and only the kinds the rows name have one', () => {
    for (const name of [...Object.values(KIND_MARKS), NEUTRAL_MARK]) expect(GLYPHS[name]).toEqual(expect.any(Number));
    const named = new Set(ROWS.filter((r) => r[3] !== NEUTRAL_MARK && r[3] !== 'warning-outline').map((r) => r[2]));
    expect(new Set(Object.keys(KIND_MARKS))).toEqual(named);
  });
});

describe('the tap mapping is unchanged: one copy, the kind beside it', () => {
  it.each(ROWS)('%s', async (_frame, data) => {
    // pushTapOf answers exactly its three keys, never a kind.
    const mapped = pushTapOf(data);
    expect(Object.keys(mapped).sort()).toEqual(['actionParams', 'actionScreen', 'deepLink']);
    // The device tap hands the router those three; the banner holds the same three.
    seq += 1;
    tap({ notification: { request: { identifier: `d-${seq}`, content: content(data) } } });
    const [screen, params, , link] = jest.mocked(routePushTap).mock.calls[0];
    expect({ actionScreen: screen, actionParams: params, deepLink: link }).toEqual(mapped);
    await act(async () => receive({ request: { identifier: `r-${seq}`, content: content(data) } }));
    const { title, body, notificationId, kind, ...held } = foregroundBannerStore.getState().banner ?? ({} as never);
    expect([title, body, notificationId]).toEqual(['Stand-in title', 'Stand-in body', `r-${seq}`]);
    expect(held).toEqual(mapped);
    void kind;
  });
});
