/** DES-K2-128: Home's child cards are hairline sections; every action still fires the same handler. */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { StyleSheet } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

jest.mock('../../../theme/ThemeProvider', () => {
  const t = jest.requireActual('../../../theme/tokens').default;
  return { useTheme: () => ({ semanticColors: t.lightTokens, colors: new Proxy({}, { get: () => '#000000' }) }) };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-notifications', () => ({ getPermissionsAsync: async () => ({ status: 'undetermined', canAskAgain: true }) }));
const mockRegister = jest.fn(async (_o: unknown) => ({ token: 'tok' }));
jest.mock('../../../services/pushNotifications', () => ({ registerForPushNotifications: (o: unknown) => mockRegister(o) }));
const mockGet = jest.fn(async () => ({ data: { id: 'c1', name: 'Coach Name' } }));
jest.mock('../../../services/api', () => ({
  __esModule: true, default: { get: () => mockGet() }, usersApi: { updatePushToken: async () => undefined },
}));
const mockSet = jest.fn(async (_k: string, _v: string) => undefined);
jest.mock('../../../storage/mmkv', () => ({ prefsStorage: { getStringAsync: async () => null, set: (k: string, v: string) => mockSet(k, v) } }));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'u1', coach_id: 'c1' }) }));
const mockInsights = { isLoading: false, isError: false, data: { status: 'ok', insights: [{ text: 'Pattern', correlation: 0.5, weeks: 3 }, { text: 'B', correlation: 0.4, weeks: 3 }], notes: [] } };
jest.mock('../../../hooks/useHolisticInsights', () => ({ useHolisticInsights: () => mockInsights }));
const mockDunning = { status: { enabled: true, state: 'past_due', amount_cents: 5000, currency: 'usd', failed_at: null, lockout_at: null, locked_at: null, purchase_id: 'p' }, updateCard: jest.fn(), messageCoach: jest.fn() };
jest.mock('../../../entitlements/dunning/DunningLockoutProvider', () => ({ useDunning: () => mockDunning }));
const mockClaim = jest.fn(async () => ({ ok: true }));
const mockClear = jest.fn(async () => undefined);
jest.mock('../../../lib/pendingInviteCode', () => ({
  readPendingInviteCode: async () => 'ABC123', claimPendingInviteCode: () => mockClaim(), clearPendingInviteCode: () => mockClear(),
  subscribePendingInviteCode: () => () => undefined,
}));
jest.mock('../../../lib/coachSharingNotice', () => ({ ...jest.requireActual('../../../lib/coachSharingNotice'), useCoachSharingNotice: () => 'v1' }));

import PushPermissionCard from '../PushPermissionCard';
import CoachIntroductionBanner from '../CoachIntroductionBanner';
import HolisticInsightsTile from '../HolisticInsightsTile';
import { FullMacrosIntroCardView } from '../FullMacrosIntroCard';
import { MacroExplanationCardView } from '../../tutorial/MacroExplanationCard';
import { DunningBanner } from '../../../entitlements/dunning/DunningBanner';
import PendingInviteBanner from '../../PendingInviteBanner';
import { Banner, RomanCard } from '../../coachless/CoachlessHomeSlot';
import type { CoachlessHome } from '../../../api/coachlessApi';

const expectSection = (id: string) => {
  const s = StyleSheet.flatten(screen.getByTestId(id).props.style);
  expect(s.borderTopWidth).toBe(StyleSheet.hairlineWidth);
  expect([s.backgroundColor, s.borderWidth, s.borderRadius]).toEqual([undefined, undefined, undefined]);
};
const press = async (id: string) => { await fireEvent.press(screen.getByTestId(id)); };

it('push permission: hairline on Home, both actions fire; the coach card keeps its box', async () => {
  await render(<PushPermissionCard presentation="section" />);
  await screen.findByTestId('push-permission-card');
  expectSection('push-permission-card');
  await press('push-permission-enable');
  await waitFor(() => expect(mockRegister).toHaveBeenCalledWith({ requestPermission: true }));
  await waitFor(() => expect(mockSet).toHaveBeenCalledWith('push_primer_dismissed:u1', 'true'));
  await screen.unmount();
  await render(<PushPermissionCard audience="coach" />);
  expect(StyleSheet.flatten((await screen.findByTestId('push-permission-card')).props.style).borderWidth).toBe(0.5);
});

it('dunning: hairline on Home with Update card and Message coach; packages keeps the card', async () => {
  await render(<DunningBanner surface="HomeScreen" presentation="section" />);
  expectSection('dunning-banner');
  await press('dunning-banner-update-card');
  await press('dunning-banner-message-coach');
  expect(mockDunning.updateCard).toHaveBeenCalledWith('HomeScreen');
  expect(mockDunning.messageCoach).toHaveBeenCalledTimes(1);
  await screen.unmount();
  await render(<DunningBanner surface="ClientPackagesScreen" />);
  expect(StyleSheet.flatten(screen.getByTestId('dunning-banner').props.style).borderWidth).toBe(1);
});

it('coachless banner and Roman card: hairline sections, every code action fires', async () => {
  const home: CoachlessHome = { eligible: true, coach_attached: false, banner: { title: 'Find a coach', offer_text: 'First week free', code: 'TGP' },
    roman_card: null, roman_card_hidden_reason: null, featured_coach: { name: 'Coach Name', photo_url: null, business_name: null, package: null } };
  const onUse = jest.fn(); const onEnter = jest.fn(); const onNotNow = jest.fn();
  await render(<><Banner home={home} presentation="section" onUseCode={onUse} onEnterCode={onEnter} /><RomanCard text="Hello" onEnterCode={onEnter} onNotNow={onNotNow} /></>);
  expectSection('coachless-banner'); expectSection('coachless-roman-card');
  await press('coachless-use-code'); await press('coachless-enter-code'); await press('coachless-roman-yes'); await press('coachless-roman-not-now');
  expect(onUse).toHaveBeenCalledWith('TGP'); expect(onEnter).toHaveBeenCalledTimes(2); expect(onNotNow).toHaveBeenCalledTimes(1);
});

it('invite, coach intro, insights, macro cards: hairline sections with their actions', async () => {
  await render(<PendingInviteBanner />);
  await screen.findByText('Tap to attach "ABC123" to your account.');
  expectSection('pending-invite-banner');
  await fireEvent.press(screen.getByLabelText('Attach invite code'));
  expect(mockClaim).toHaveBeenCalledTimes(1);
  await screen.unmount();
  await render(<CoachIntroductionBanner />);
  await screen.findByTestId('coach-intro-banner');
  expectSection('coach-intro-banner');
  await press('coach-intro-dismiss');
  expect(mockSet).toHaveBeenCalledWith('home.coach_intro_banner_dismissed:u1', 'true');
  await screen.unmount();
  await render(<HolisticInsightsTile />);
  expectSection('holistic-insights-tile');
  expect(StyleSheet.flatten(screen.getByText('1 more').props.style).color).toBe(jest.requireActual('../../../theme/tokens').default.lightTokens.textMuted);
  await screen.unmount();
  const onDismiss = jest.fn();
  await render(<><FullMacrosIntroCardView onDismiss={onDismiss} /><MacroExplanationCardView macros={{ calories: 2000, protein_g: 150, carbs_g: 200, fat_g: 60 }} /></>);
  expectSection('full-macros-intro-card'); expectSection('macro-explanation-card');
  await press('full-macros-intro-dismiss'); await press('macro-explanation-toggle');
  expect(onDismiss).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('macro-explanation-body')).toBeTruthy();
});

it('Home passes the section look and keeps the card order', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../../screens/client/HomeScreen.tsx'), 'utf8');
  expect(src).toContain('<DunningBanner surface="HomeScreen" presentation="section" />');
  expect(src).toContain('<PushPermissionCard presentation="section" />');
  const order = ['<DunningBanner', '<CoachlessHomeSlot', '<PendingInviteBanner', '<PushPermissionCard', 'showProfileNudge ?', '<CoachIntroductionBanner', '<FullMacrosIntroCard', '<TutorialHomeSlot', '<HolisticInsightsTile'];
  const at = order.map((o) => src.indexOf(o, src.indexOf('home-number-grid')));
  expect(at.every((v, i) => v > 0 && (i === 0 || v > at[i - 1]))).toBe(true);
});
