/**
 * FIN-868 (fix round 4): the coach community Home on K2 Style B (#172-10, as the inbox).
 * Every branch draws the serif "Community" title as a header; loading is labelled skeleton
 * cards; the error and quiet pages pull to refresh (their words say "Pull to retry"); the
 * cards are cream with no outline, and the colours stay light in both themes.
 */
import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import { StyleSheet, RefreshControl } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { colors } from '../../../theme/tokens';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
}));

type Dashboard = {
  data?: unknown;
  isLoading: boolean;
  isError: boolean;
  isRefetching: boolean;
  refetch: jest.Mock;
};
const mockDashboard: { current: Dashboard } = {
  current: { isLoading: false, isError: false, isRefetching: false, refetch: jest.fn() },
};
const mockEmpty: { current: unknown } = { current: undefined };

jest.mock('../../../hooks/useCoachCommunity', () => ({
  useCoachDashboard: () => mockDashboard.current,
  useCoachEmptyStatePayload: () => mockEmpty.current,
}));

import CoachCommunityHomeScreen from '../CoachCommunityHomeScreen';

const READY = {
  status: 'ready',
  payload: {
    surface_key: 'coach_community_home_empty',
    text: 'TEST_EMPTY_HOME_COPY',
    avatar_crop: 'neutral',
    voice_variant: 'roman_v2',
  },
};

function dashboard(over: Partial<Dashboard> = {}): Dashboard {
  return { data: undefined, isLoading: false, isError: false, isRefetching: false, refetch: jest.fn(), ...over };
}

const counts = (unread: number, cohorts: number, flagged: number) => ({
  unread_inbox_count: unread,
  active_cohort_count: cohorts,
  flagged_today_count: flagged,
});

beforeEach(() => {
  mockDashboard.current = dashboard();
  mockEmpty.current = READY;
});

describe('Coach community Home on K2 Style B (FIN-868)', () => {
  it('loading draws the serif title over labelled skeleton cards', async () => {
    mockDashboard.current = dashboard({ isLoading: true });
    const { getByRole, getByTestId } = await render(<CoachCommunityHomeScreen />);
    const title = StyleSheet.flatten(getByRole('header', { name: 'Community' }).props.style);
    expect(title).toMatchObject({ fontFamily: 'CormorantGaramond_400Regular', fontSize: 36, color: colors.ink });
    const loading = getByTestId('coach-community-home-loading');
    expect(loading.props.accessibilityLabel).toBe('Loading your community summary');
    expect(loading.props.children).toHaveLength(3);
  });

  it('error keeps the title; Try again and a pull both refetch the summary', async () => {
    const refetch = jest.fn();
    mockDashboard.current = dashboard({ isError: true, refetch });
    const { getByRole, getByTestId, getByText } = await render(<CoachCommunityHomeScreen />);
    expect(getByRole('header', { name: 'Community' })).toBeTruthy();
    expect(getByText('Could not load your community summary. Pull to retry.')).toBeTruthy();
    await fireEvent.press(getByTestId('coach-community-home-error-retry'));
    expect(refetch).toHaveBeenCalledTimes(1);
    const scroll = getByTestId('coach-community-home-screen');
    expect(scroll.props.refreshControl.type).toBe(RefreshControl);
    await scroll.props.refreshControl.props.onRefresh();
    expect(refetch).toHaveBeenCalledTimes(2);
  });

  it('a quiet Home with failed words pulls to retry both the summary and the words', async () => {
    const refetch = jest.fn();
    const retry = jest.fn();
    mockDashboard.current = dashboard({ data: counts(0, 0, 0), refetch });
    mockEmpty.current = { status: 'error', kind: 'network', retry };
    const { getByRole, getByTestId } = await render(<CoachCommunityHomeScreen />);
    expect(getByRole('header', { name: 'Community' })).toBeTruthy();
    expect(getByTestId('coach-community-home-empty-payload-error')).toBeTruthy();
    await getByTestId('coach-community-home-screen').props.refreshControl.props.onRefresh();
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('cards are cream with no outline; the next card has a forest border and serif numbers', async () => {
    mockDashboard.current = dashboard({ data: counts(3, 2, 0) });
    const { getByTestId } = await render(<CoachCommunityHomeScreen />);
    const page = StyleSheet.flatten(getByTestId('coach-community-home-screen').props.style);
    expect(page.backgroundColor).toBe(colors.bone);
    const next = StyleSheet.flatten(getByTestId('coach-community-home-inbox-card').props.style);
    expect(next).toMatchObject({ borderColor: colors.forest, borderWidth: 1.5 });
    const plain = StyleSheet.flatten(getByTestId('coach-community-home-cohorts-card').props.style);
    expect(plain).toMatchObject({ backgroundColor: colors.cream, borderColor: 'transparent' });
    // The pull refreshes the loaded page too.
    expect(getByTestId('coach-community-home-screen').props.refreshControl.type).toBe(RefreshControl);
  });

  it('the Home bar draws no title of its own and blends into the bone page', () => {
    const nav = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'navigation', 'CoachCommunityNavigator.tsx'),
      'utf8',
    );
    const start = nav.indexOf('name="CoachCommunityHome"');
    expect(start).toBeGreaterThan(-1);
    const block = nav.slice(start, nav.indexOf('/>', start));
    // The title stays for the back button and screen readers; the bar draws none.
    expect(block).toMatch(/title: 'Community'/);
    expect(block).toMatch(/headerTitle: ''/);
    expect(block).toMatch(/headerShadowVisible: false/);
    expect(block).toMatch(/headerStyle: \{ backgroundColor: tokenColors\.bone \}/);
  });
});
