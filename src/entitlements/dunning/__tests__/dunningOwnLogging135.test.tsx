/**
 * B-DUNNINGOWN-135, owner ruling 2026-10-08 23:5x: a client in the Day 10+ lockout (or a disputed or refunded
 * cycle that uses it) keeps their own logging. The real ClientNavigator inside the real DunningLockoutProvider,
 * wired as RootNavigator wires it, with the real withProtectedScreen and ProtectedScreen; leaf screens are stubs.
 * The entitlement read says inactive (a disputed plan has ended): OWN screens open for every client (m#650).
 */
import React from 'react';
import { AppState, BackHandler, DeviceEventEmitter, Text, TouchableOpacity } from 'react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as fs from 'fs';
import * as path from 'path';
import type { ClientDunningStatus } from '../dunningApi';

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('../../../config/featureFlags', () => ({ featureFlags: { clientCalendar: false, communityTab: false } }));
jest.mock('../../../hooks/useAiWithdrawalDrain', () => ({ useAiWithdrawalDrain: () => {} }));
const mockUser = { id: 'c1', role: 'student', coach_id: 'coach-1' };
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../../../hooks/useCoachlessClient', () => ({ useCoachlessClient: () => false }));
jest.mock('../../../hooks/useCommunity', () => ({ useCommunityBadge: () => ({ total: 0 }) }));
jest.mock('../../../components/community/UnreadBadge', () => () => null);
jest.mock('../../../components/tutorial/TutorialHost', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('../../../components/community/CommunityTermsGate', () => ({ withCommunityTerms: (screen: unknown) => screen }));
jest.mock('../../../ui/haptics/haptics.service', () => ({ HapticService: { selection: jest.fn() } }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../UpdateCardScreen', () => () => null);
jest.mock('../../EntitlementProvider', () => ({
  useEntitlement: () => ({ entitlementActive: false, status: 'inactive', confirmedActive: false, refreshEntitlement: jest.fn() }),
}));
jest.mock('../../../services/sentry', () => ({ captureError: jest.fn() }));
jest.mock('../../../services/queryClient', () => ({ queryClient: { invalidateQueries: jest.fn() } }));
const mockGet = jest.fn();
jest.mock('../../../services/api', () => ({ __esModule: true, default: { get: (...a: unknown[]) => mockGet(...a), post: jest.fn() } }));

const mockLogFood = jest.fn();
let trainMounts = 0;
type StubProps = { navigation: { navigate: (name: string) => void } };
const navSource = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'navigation', 'ClientNavigator.tsx'), 'utf8');
for (const match of navSource.matchAll(/^import (?!type\b)[^;]*? from '(\.\.\/screens\/[^']+)'/gm)) {
  const modulePath = match[1];
  let Stub: React.FC<StubProps> = () => <Text>{modulePath}</Text>;
  if (modulePath.endsWith('/LogScreen')) {
    Stub = () => <TouchableOpacity onPress={() => mockLogFood('oats')} testID="stub-log-food"><Text>Add oats</Text></TouchableOpacity>;
  } else if (modulePath.endsWith('/WorkoutScreen')) {
    Stub = ({ navigation }) => {
      React.useEffect(() => void (trainMounts += 1), []);
      return (
        <>
          <TouchableOpacity onPress={() => navigation.navigate('RoutineBuilder')} testID="stub-new-routine"><Text>New routine</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('ExerciseLibrary')} testID="stub-exercise-library"><Text>Exercise library</Text></TouchableOpacity>
        </>
      );
    };
  }
  jest.doMock(`../../${modulePath}`, () => ({ __esModule: true, default: Stub }));
}
jest.doMock('../../../navigation/CommunityNavigator', () => ({ __esModule: true, default: () => null }));
const ClientNavigator = require('../../../navigation/ClientNavigator').default;
const { DunningLockoutProvider, OPEN_FOR_OWN_LOGGING, backReachesOpenScreen } = require('../DunningLockoutProvider');
const { dunningLockoutStore } = require('../dunningLockoutStore');
const { bannerCopy } = require('../DunningBanner');

const LOCKED: ClientDunningStatus = {
  enabled: true, state: 'locked', purchase_id: 'p1', amount_cents: 15000, currency: 'usd',
  failed_at: '2026-10-01T15:00:00.000Z', lockout_at: '2026-10-11T15:00:00.000Z', locked_at: '2026-10-11T15:07:00.000Z',
  day: 10, coach_name: 'Avery', card_last4: '4242', card_brand: 'visa',
};
const PAST_DUE: ClientDunningStatus = { ...LOCKED, state: 'past_due', locked_at: null, day: 3 };
const CLEAR: ClientDunningStatus = { ...LOCKED, state: 'none', amount_cents: null, day: null, locked_at: null };

const ref = createNavigationContainerRef<Record<string, object | undefined>>();
const routeName = () => (ref.isReady() ? ref.getCurrentRoute()?.name : undefined);
const subscribe = (listener: () => void) => ref.addListener('state', listener);
const onOpenUpdateCard = jest.fn();
const handlers = { onMessageCoach: jest.fn(), onOpenDataExport: jest.fn(), onOpenDeleteAccount: jest.fn(), onSignOut: jest.fn() };

async function openApp(status: ClientDunningStatus) {
  mockGet.mockResolvedValue({ data: status });
  const view = await render(
    <NavigationContainer ref={ref}>
      <DunningLockoutProvider enabled {...handlers} onOpenUpdateCard={onOpenUpdateCard} getCurrentRouteName={routeName} subscribeToRouteChanges={subscribe}>
        <ClientNavigator />
      </DunningLockoutProvider>
    </NavigationContainer>,
  );
  await waitFor(() => expect(mockGet).toHaveBeenCalled());
  if (status.state === 'locked') await view.findByTestId('dunning-lockout-screen');
  return view;
}
const press = (view: Awaited<ReturnType<typeof render>>, id: string) => act(async () => void fireEvent.press(view.getByTestId(id)));
const go = (name: string, params?: object) => act(async () => ref.navigate(name, params));

beforeEach(() => {
  jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));
  dunningLockoutStore.__resetForTests();
  [mockGet, mockLogFood, onOpenUpdateCard].forEach((fn) => fn.mockReset());
  trainMounts = 0;
});

describe('Day 10+ lockout keeps the client own logging (owner ruling 23:5x)', () => {
  it('Home keeps the full lockout; Log food opens Food, the client logs, the notice offers Update card', async () => {
    const view = await openApp(LOCKED);
    expect(routeName()).toBe('HomeMain');
    expect(view.getByTestId('dunning-lockout-end-plan')).toBeTruthy();
    expect(view.queryByTestId('dunning-lockout-back')).toBeNull();
    expect(view.getByTestId('dunning-app-content', { includeHiddenElements: true }).props.importantForAccessibility).toBe('no-hide-descendants');

    await press(view, 'dunning-lockout-food');
    expect(routeName()).toBe('Log');
    expect(view.queryByTestId('dunning-lockout-overlay')).toBeNull();
    await press(view, 'stub-log-food');
    expect(mockLogFood).toHaveBeenCalledWith('oats');
    expect(view.getByText('Your plan is paused')).toBeTruthy();
    await press(view, 'dunning-banner-update-card');
    expect(onOpenUpdateCard).toHaveBeenCalledWith(expect.objectContaining({ autostart: true }));
  });

  it('a non-OWN screen keeps the lockout; Back and Android back over Train return there; Roman stays locked', async () => {
    const backs: Array<() => boolean | null | undefined> = [];
    jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
      backs.push(handler);
      return { remove: () => void (backs.includes(handler) && backs.splice(backs.indexOf(handler), 1)) };
    });
    const view = await openApp(LOCKED);
    expect(backs[backs.length - 1]()).toBe(true);
    expect(routeName()).toBe('HomeMain');
    await press(view, 'dunning-lockout-train');
    expect(view.getByTestId('dunning-banner')).toBeTruthy();

    await press(view, 'stub-exercise-library');
    expect(routeName()).toBe('ExerciseLibrary');
    expect(view.getByTestId('dunning-lockout-screen')).toBeTruthy();
    await press(view, 'dunning-lockout-back');
    expect(routeName()).toBe('WorkoutMain');
    await press(view, 'stub-exercise-library');
    await act(async () => void backs[backs.length - 1]());
    expect(routeName()).toBe('WorkoutMain');
    expect(view.queryByTestId('dunning-lockout-overlay')).toBeNull();
    expect(trainMounts).toBe(1);

    for (const screen of ['Community', 'AIGuide', 'MoreIndex']) {
      await go('MoreTab', { screen });
      expect(view.getByTestId('dunning-lockout-screen')).toBeTruthy();
    }
  });

  it('Habits and New routine are basic self logging: open, with the notice (B-SMALL2-135)', async () => {
    const view = await openApp(LOCKED);
    expect(routeName()).toBe('HomeMain');
    // Sol B1: Habits is reached from the lockout itself (its ordinary entry, You, stays locked).
    await press(view, 'dunning-lockout-habits');
    expect(routeName()).toBe('Habits');
    expect(view.queryByTestId('dunning-lockout-overlay')).toBeNull();
    expect(view.getByTestId('dunning-banner')).toBeTruthy();
    await go('WorkoutTab');
    await press(view, 'stub-new-routine');
    expect(routeName()).toBe('RoutineBuilder');
    expect(view.queryByTestId('dunning-lockout-overlay')).toBeNull();
    expect(view.getByTestId('dunning-banner')).toBeTruthy();
  });

  it('a disputed cycle keeps logging too: the paused-plan title, Message coach, no card path', async () => {
    const dispute: ClientDunningStatus = { ...LOCKED, kind: 'dispute' };
    const view = await openApp(dispute);
    await go('Log');
    expect(view.queryByTestId('dunning-lockout-overlay')).toBeNull();
    expect(view.getByText(bannerCopy(dispute).title)).toBeTruthy();
    expect(view.queryByTestId('dunning-banner-update-card')).toBeNull();
    expect(view.getByTestId('dunning-banner-message-coach')).toBeTruthy();
  });

  it('the notice steps out of the way while the keyboard is up', async () => {
    const view = await openApp(LOCKED);
    await go('Log');
    const frame = { endCoordinates: { height: 300, screenX: 0, screenY: 500, width: 400 } };
    await act(async () => void DeviceEventEmitter.emit('keyboardDidShow', frame));
    expect(view.queryByTestId('dunning-banner')).toBeNull();
    await act(async () => void DeviceEventEmitter.emit('keyboardDidHide', frame));
    expect(view.getByTestId('dunning-banner')).toBeTruthy();
  });

  it('a lock that lands mid-session keeps Train mounted and adds the notice', async () => {
    const view = await openApp(CLEAR);
    await go('WorkoutTab');
    mockGet.mockResolvedValue({ data: LOCKED });
    await act(async () => dunningLockoutStore.reportLocked({ requestId: 'req-1' }));
    await waitFor(() => expect(view.getByTestId('dunning-banner')).toBeTruthy());
    expect(view.queryByTestId('dunning-lockout-overlay')).toBeNull();
    expect(trainMounts).toBe(1);
  });

  it.each([['no payment problem', CLEAR], ['Days 0-9 past due', PAST_DUE]])('unchanged for %s: no lockout, no notice', async (_l, status) => {
    const view = await openApp(status);
    for (const tab of ['Home', 'Log', 'WorkoutTab']) {
      await go(tab);
      expect(view.queryByTestId('dunning-lockout-overlay')).toBeNull();
      if (tab !== 'Home') expect(view.queryByTestId('dunning-banner')).toBeNull();
    }
  });

  it('the open set is every ClientNavigator OWN route but AIGuide, plus the Train tab', () => {
    const own = new Set([...navSource.matchAll(/const (\w+) = withProtectedScreen\(\w+, OWN\)/g)].map((m) => m[1]));
    const ownRoutes = [...navSource.matchAll(/name="(\w+)"\s+component=\{(\w+)\}/g)].filter((m) => own.has(m[2])).map((m) => m[1]);
    expect(ownRoutes).toEqual(expect.arrayContaining(['Log', 'AIGuide', 'WorkoutMain', 'Fast', 'Habits', 'RoutineBuilder']));
    expect([...OPEN_FOR_OWN_LOGGING].sort()).toEqual([...ownRoutes.filter((r) => r !== 'AIGuide'), 'WorkoutTab'].sort());
    const train = (names: string[]) => ({ type: 'tab', index: 1, routes: [{ name: 'Home' }, { name: 'WorkoutTab', state: { type: 'stack', index: names.length - 1, routes: names.map((name) => ({ name })) } }] });
    expect(backReachesOpenScreen(train(['WorkoutMain', 'ActiveWorkout', 'ExerciseDetail']))).toBe(true);
    expect(backReachesOpenScreen(train(['WorkoutMain', 'ExerciseLibrary', 'ExerciseDetail']))).toBe(false);
    expect(backReachesOpenScreen(train(['WorkoutMain']))).toBe(false);
  });
});
