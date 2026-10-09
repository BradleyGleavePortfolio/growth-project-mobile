/** Owner 10-09 00:0x "join a coach" banner on Home (CoachlessHomeSlot part "join"). */
import React from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';
import { AppState, StyleSheet, type AppStateStatus } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockGet = jest.fn();
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => mockGet(...a), post: jest.fn(async () => ({ data: { recorded: true, visible: true } })) },
}));
jest.mock('../../../hooks/useFeatureFlags', () => ({ useFeatureFlags: () => ({ flags: { coachless_home: true } }) }));
let mockUser: { id: string; coach_id?: string } = { id: 'client-1' };
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
let mockCached: { id: string; coach_id?: string } | null = null;
jest.mock('../../../lib/userCache', () => ({ patchUserCache: jest.fn(async () => undefined), readUserCacheSync: () => mockCached }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }) }));
jest.mock('../../PackageSelectionSheet', () => ({ __esModule: true, default: () => null }));
let mockAppState: ((s: AppStateStatus) => void) | null = null;
jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
  mockAppState = handler as (s: AppStateStatus) => void;
  return { remove: jest.fn() };
});

import CoachlessHomeSlot from '../CoachlessHomeSlot';
import { JOIN_COACH_BODY, JOIN_COACH_TITLE, JOIN_BANNER_NEW_SESSION_MS } from '../JoinCoachBanner';
import { authEvents } from '../../../utils/authEvents';

const OLD_TITLE = 'Enter coach code for coaching and programs';
const HOME = { eligible: true, coach_attached: false, banner: { title: OLD_TITLE, offer_text: null, code: 'GP-TOP' },
  roman_card: { text: 'Pitch.', code: 'GP-TOP' }, roman_card_hidden_reason: null, featured_coach: null };
const renderPart = (part: 'join' | 'roman' = 'join') => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <CoachlessHomeSlot part={part} />
  </QueryClientProvider>,
);
/** Lets the mocked GET /coachless/home answer, so an absent banner is a real answer. */
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 50)); });
const banner = () => screen.queryByTestId('coachless-join-banner');

beforeEach(() => {
  mockUser = { id: 'client-1' };
  mockCached = null;
  mockGet.mockReset().mockResolvedValue({ data: HOME });
});

it('a client with no coach sees Join a coach in calm copy, once; the Roman card stays in its own part', async () => {
  await renderPart();
  expect(await screen.findByTestId('coachless-join-banner')).toBeTruthy();
  expect(screen.getByText(JOIN_COACH_BODY)).toBeTruthy();
  expect(screen.queryByText(OLD_TITLE)).toBeNull();
  expect(screen.queryByTestId('coachless-roman-card')).toBeNull();
  for (const line of [JOIN_COACH_TITLE, JOIN_COACH_BODY]) expect(line).not.toMatch(/!|\b(I|me|my|we|our|your coach)\b/);
  await screen.unmount();
  await renderPart('roman');
  expect(await screen.findByTestId('coachless-roman-card')).toBeTruthy();
  expect(banner()).toBeNull();
});

it('a coached client never sees it (server user, or the cache mirror after a join)', async () => {
  mockUser = { id: 'client-1', coach_id: 'coach-1' };
  await renderPart();
  await settle();
  expect(banner()).toBeNull();
  await screen.unmount();
  mockUser = { id: 'client-1' };
  mockCached = { id: 'client-1', coach_id: 'coach-1' };
  await renderPart();
  await settle();
  expect(mockGet).toHaveBeenCalledWith('/coachless/home', expect.anything());
  expect(banner()).toBeNull();
});

it('the forest outlined button (Home keeps one filled forest action) opens the coach-code sheet', async () => {
  await renderPart();
  const button = await screen.findByTestId('coachless-join');
  const style = StyleSheet.flatten(button.props.style);
  expect([style.borderColor, style.borderRadius, style.backgroundColor]).toEqual(['#2C4A36', 12, undefined]);
  await fireEvent.press(button);
  expect(screen.getByTestId('coach-code-sheet')).toBeTruthy();
  expect(screen.getByTestId('coach-code-input').props.value).toBe('');
});

it('Not now lasts for this session only: back after sign-in or a long background, not a quick switch', async () => {
  await renderPart();
  await fireEvent.press(await screen.findByTestId('coachless-join-not-now'));
  expect(banner()).toBeNull();
  await screen.unmount();
  await renderPart(); // Home remounts in the same session: still hidden
  await settle();
  expect(banner()).toBeNull();
  await act(async () => authEvents.emit()); // sign-in or sign-out = new session
  expect(await screen.findByTestId('coachless-join-banner')).toBeTruthy();

  await fireEvent.press(screen.getByTestId('coachless-join-not-now'));
  const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
  await act(async () => mockAppState?.('background'));
  now.mockReturnValue(1_060_000);
  await act(async () => mockAppState?.('active'));
  expect(banner()).toBeNull();
  await act(async () => mockAppState?.('background'));
  now.mockReturnValue(1_060_001 + JOIN_BANNER_NEW_SESSION_MS);
  await act(async () => mockAppState?.('active'));
  expect(banner()).toBeTruthy();
  now.mockRestore();
});

it('Home renders the join part right after the hero and the Roman part with the lower sections', () => {
  const src = readFileSync(join(__dirname, '../../../screens/client/HomeScreen.tsx'), 'utf8');
  const at = src.indexOf('<CoachlessHomeSlot part="join" />');
  expect(at).toBeGreaterThan(src.indexOf('home-explore-cta'));
  expect(at).toBeLessThan(src.indexOf('home-number-grid'));
  expect(src.indexOf('<CoachlessHomeSlot part="roman" />')).toBeGreaterThan(src.indexOf('<DunningBanner'));
});
