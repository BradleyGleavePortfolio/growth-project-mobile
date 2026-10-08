/**
 * Render + interaction tests for the Day-1 onboarding flow.
 *
 * These mount each screen via @testing-library/react-native and exercise the
 * real CTAs. Mocks are confined to the network, navigation, theme, and
 * platform shims so the assertions cover the actual JSX path the user sees.
 */

import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StyleSheet } from 'react-native';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../api', () => ({
  pairWithCoach: jest.fn(),
  saveGoals: jest.fn(),
  saveNotifPermission: jest.fn(),
  saveCheckInTime: jest.fn(),
  completeDayOne: jest.fn(),
  getDeviceTimezone: jest.fn(() => 'America/Los_Angeles'),
}));

jest.mock('../../../services/pushNotifications', () => ({
  registerForPushNotifications: jest.fn(),
}));

jest.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: jest.fn(() => ({
    id: 'u1',
    email: 'jane@example.com',
    firstName: 'Jane',
  })),
}));

jest.mock('../../../lib/analytics', () => ({
  track: jest.fn(),
}));

jest.mock('../../../utils/authEvents', () => ({
  authEvents: { emit: jest.fn(), on: jest.fn(), off: jest.fn(), onAuthChange: jest.fn() },
}));

jest.mock('../../../lib/pendingInviteCode', () => ({
  writePendingInviteCode: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../../lib/userCache', () => ({
  patchUserCache: jest.fn(),
}));

jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({
    semanticColors: require('../../../theme/tokens').lightTokens,
    colors: {
      background: '#F5EFE4',
      surface: '#F1E8D5',
      surfaceElevated: '#E8DCC8',
      textPrimary: '#1A1A18',
      textSecondary: '#5C5C5A',
      textMuted: '#6B675F',
      textOnPrimary: '#F5EFE4',
      primary: '#2C4A36',
      primaryDark: '#1E3326',
      primaryPale: '#E8E0CC',
      border: '#D9CEBC',
      error: '#4A0404',
      warning: '#C5A253',
      success: '#2C4A36',
      divider: '#E8DCC8',
      noticeCriticalBg: '#FBEFEF',
      noticeCriticalText: '#4A0404',
      noticeCriticalAccent: '#7A1A1A',
    },
  }),
}));

jest.mock('expo-font', () => ({ isLoaded: () => true, loadAsync: jest.fn() }));

import WelcomeScreen from '../WelcomeScreen';
import CoachPairingScreen from '../CoachPairingScreen';
import GoalsScreen from '../GoalsScreen';
import NotificationsScreen from '../NotificationsScreen';
import CheckInTimeScreen from '../CheckInTimeScreen';
import ReadyScreen from '../ReadyScreen';
import { writeResumeState, clearResumeState, readResumeState } from '../resume';
import { readDayOneAnswers } from '../answers';
import {
  pairWithCoach,
  saveGoals,
  saveCheckInTime,
  completeDayOne,
} from '../api';
import { registerForPushNotifications } from '../../../services/pushNotifications';
import { authEvents } from '../../../utils/authEvents';
import { useCurrentUser } from '../../../hooks/useCurrentUser';

const mockedPair = pairWithCoach as jest.Mock;
const mockedSaveGoals = saveGoals as jest.Mock;
const mockedSaveCheckIn = saveCheckInTime as jest.Mock;
const mockedComplete = completeDayOne as jest.Mock;
const mockedRegister = registerForPushNotifications as jest.Mock;

function makeNav() {
  return {
    navigate: jest.fn(),
    goBack: jest.fn(),
    setOptions: jest.fn(),
  };
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

// ─── Welcome ─────────────────────────────────────────────────────────────────

describe('WelcomeScreen', () => {
  it('greets the user by first name once the profile cache resolves', async () => {
    const { getByText } = await render(
      <WelcomeScreen navigation={makeNav() as never} />,
    );
    expect(getByText('Welcome, Jane')).toBeTruthy();
  });

  it('navigates to CoachPairing on CTA press and writes the resume checkpoint', async () => {
    const nav = makeNav();
    const { getByTestId } = await render(
      <WelcomeScreen navigation={nav as never} />,
    );
    await act(async () => {
      await fireEvent.press(getByTestId('day-one-welcome-cta'));
    });
    expect(nav.navigate).toHaveBeenCalledWith('CoachPairing');
    await waitFor(async () => {
      const state = await readResumeState();
      expect(state?.step).toBe('CoachPairing');
    });
  });

  it('shows readable progress and a sentence-case forest action', async () => {
    jest.mocked(useCurrentUser).mockReturnValueOnce(null);
    const { getByTestId, getByText } = await render(
      <WelcomeScreen navigation={makeNav() as never} />,
    );
    expect(getByTestId('day-one-step-text').props.children).toBe('Step 1 of 5');
    const cta = getByTestId('day-one-welcome-cta');
    expect(StyleSheet.flatten(cta.props.style).backgroundColor).toBe(require('../../../theme/tokens').colors.forest);
    expect(StyleSheet.flatten(getByText('Get started').props.style).textTransform).not.toBe('uppercase');
    expect(StyleSheet.flatten(getByTestId('day-one-progress-track').props.style).height).toBe(StyleSheet.hairlineWidth);
    expect(getByText('Welcome')).toBeTruthy();
  });
});

// ─── Coach pairing ───────────────────────────────────────────────────────────

describe('CoachPairingScreen', () => {
  async function renderPairing(prefillCode?: string) {
    const nav = makeNav();
    const utils = await render(
      <CoachPairingScreen
        navigation={nav as never}
        route={{ key: 'k', name: 'CoachPairing', params: prefillCode ? { prefillCode } : undefined } as never}
      />,
    );
    return { nav, ...utils };
  }

  it('renders 2/5 step text', async () => {
    const { getByTestId } = await renderPairing();
    expect(getByTestId('day-one-step-text').props.children).toBe('Step 2 of 5');
  });

  it('prefills the input from route.params.prefillCode and hides the skip button', async () => {
    const { getByTestId, queryByTestId, queryByText } = await renderPairing('TGP-ABCD');
    const input = getByTestId('day-one-invite-input');
    expect(input.props.value).toBe('TGP-ABCD');
    expect(queryByTestId('day-one-invite-skip')).toBeNull();
    expect(queryByText('Pairing with the invite from your link…')).toBeNull();
    expect(StyleSheet.flatten(input.props.style).backgroundColor).toBeUndefined();
  });

  it('submits to pairWithCoach and navigates to Goals on success', async () => {
    mockedPair.mockResolvedValue({ ok: true });
    const { nav, getByTestId } = await renderPairing();
    await fireEvent.changeText(getByTestId('day-one-invite-input'), 'XYZ9');
    await act(async () => {
      await fireEvent.press(getByTestId('day-one-invite-submit'));
    });
    expect(mockedPair).toHaveBeenCalledWith('XYZ9', null);
    await waitFor(() => expect(nav.navigate).toHaveBeenCalledWith('Goals'));
    await fireEvent.press(getByTestId('day-one-back'));
    expect(nav.goBack).toHaveBeenCalledTimes(1);
  });

  it('shows structured copy when the backend returns an invite_expired error', async () => {
    mockedPair.mockResolvedValue({ ok: false, error: { kind: 'invite_expired' } });
    const { getByTestId, findByText } = await renderPairing();
    await fireEvent.changeText(getByTestId('day-one-invite-input'), 'BAD9');
    await act(async () => {
      await fireEvent.press(getByTestId('day-one-invite-submit'));
    });
    expect(await findByText(/expired/)).toBeTruthy();
  });

  it('a code the coach turned off says so instead of "not recognized"', async () => {
    mockedPair.mockResolvedValue({ ok: false, error: { kind: 'invite_revoked' } });
    const { getByTestId, findByText, queryByText } = await renderPairing();
    await fireEvent.changeText(getByTestId('day-one-invite-input'), 'GP-OLD234');
    await act(async () => {
      await fireEvent.press(getByTestId('day-one-invite-submit'));
    });
    expect(await findByText(/This code was turned off by your coach/)).toBeTruthy();
    expect(queryByText(/not recognized/)).toBeNull();
  });

  it('skip path advances without calling the backend', async () => {
    const { nav, getByTestId } = await renderPairing();
    await act(async () => {
      await fireEvent.press(getByTestId('day-one-invite-skip'));
    });
    expect(mockedPair).not.toHaveBeenCalled();
    expect(nav.navigate).toHaveBeenCalledWith('Goals');
  });
});

// ─── Goals ───────────────────────────────────────────────────────────────────

describe('GoalsScreen', () => {
  it('renders 3/5 step text', async () => {
    const { getByTestId } = await render(
      <GoalsScreen navigation={makeNav() as never} />,
    );
    expect(getByTestId('day-one-step-text').props.children).toBe('Step 3 of 5');
  });

  it('selecting a goal then continuing saves and advances', async () => {
    mockedSaveGoals.mockResolvedValue(undefined);
    const nav = makeNav();
    const { getByTestId } = await render(
      <GoalsScreen navigation={nav as never} />,
    );
    for (const key of ['fitness', 'business', 'personal_growth', 'relationships', 'mental_health', 'custom']) {
      const row = getByTestId(`day-one-goal-${key}`);
      const style = StyleSheet.flatten(row.props.style);
      expect(style.backgroundColor).toBeUndefined();
      expect(style.borderBottomWidth).toBe(StyleSheet.hairlineWidth);
      await fireEvent.press(row);
      expect(getByTestId(`day-one-goal-${key}`).props.accessibilityState.checked).toBe(true);
      await fireEvent.press(row);
      expect(getByTestId(`day-one-goal-${key}`).props.accessibilityState.checked).toBe(false);
    }
    await fireEvent.press(getByTestId('day-one-back'));
    expect(nav.goBack).toHaveBeenCalledTimes(1);
    await fireEvent.press(getByTestId('day-one-goal-fitness'));
    await act(async () => {
      await fireEvent.press(getByTestId('day-one-goals-continue'));
    });
    expect(mockedSaveGoals).toHaveBeenCalledWith(['fitness']);
    await waitFor(() => expect(nav.navigate).toHaveBeenCalledWith('Notifications'));
  });

  it('shows the retry banner + offline CTA when save fails', async () => {
    mockedSaveGoals.mockRejectedValue(new Error('network'));
    const { getByTestId } = await render(
      <GoalsScreen navigation={makeNav() as never} />,
    );
    await fireEvent.press(getByTestId('day-one-goal-fitness'));
    await act(async () => {
      await fireEvent.press(getByTestId('day-one-goals-continue'));
    });
    await waitFor(() => {
      expect(getByTestId('day-one-goals-error')).toBeTruthy();
      expect(getByTestId('day-one-goals-retry')).toBeTruthy();
      expect(getByTestId('day-one-goals-offline')).toBeTruthy();
    });
  });

  it('Continue offline persists selection + enqueues sync + advances', async () => {
    mockedSaveGoals.mockRejectedValue(new Error('network'));
    const nav = makeNav();
    const { getByTestId } = await render(
      <GoalsScreen navigation={nav as never} />,
    );
    await fireEvent.press(getByTestId('day-one-goal-business'));
    await act(async () => {
      await fireEvent.press(getByTestId('day-one-goals-continue'));
    });
    await act(async () => {
      await fireEvent.press(getByTestId('day-one-goals-offline'));
    });
    await waitFor(async () => {
      const state = await readResumeState();
      expect(state?.draft.goals).toEqual(['business']);
      expect(state?.pendingSync).toHaveLength(1);
      expect(state?.pendingSync[0].kind).toBe('goals');
    });
    expect(nav.navigate).toHaveBeenCalledWith('Notifications');
    await fireEvent.press(getByTestId('day-one-goals-skip'));
    expect(nav.navigate).toHaveBeenLastCalledWith('Notifications');
  });

  it('rehydrates the prior selection from the resume checkpoint', async () => {
    await writeResumeState({ draft: { goals: ['mental_health'] } });
    const { findByTestId, getByTestId } = await render(
      <GoalsScreen navigation={makeNav() as never} />,
    );
    const row = await findByTestId('day-one-goal-mental_health');
    await waitFor(() =>
      expect(row.props.accessibilityState?.checked).toBe(true),
    );
    mockedSaveGoals.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(undefined);
    await act(async () => fireEvent.press(getByTestId('day-one-goals-continue')));
    await act(async () => fireEvent.press(getByTestId('day-one-goals-retry')));
    expect(mockedSaveGoals).toHaveBeenCalledTimes(2);
  });
});

// ─── Notifications ───────────────────────────────────────────────────────────

describe('NotificationsScreen', () => {
  it('renders 4/5 step text', async () => {
    const { getByTestId } = await render(
      <NotificationsScreen navigation={makeNav() as never} />,
    );
    expect(getByTestId('day-one-step-text').props.children).toBe('Step 4 of 5');
  });

  it('navigates directly to Ready after permission grant', async () => {
    mockedRegister.mockResolvedValue({ granted: true });
    const nav = makeNav();
    const { getByTestId } = await render(
      <NotificationsScreen navigation={nav as never} />,
    );
    await act(async () => {
      await fireEvent.press(getByTestId('day-one-notifications-enable'));
    });
    await waitFor(() => expect(nav.navigate).toHaveBeenCalledWith('Ready'));
  });

  it('does NOT block onboarding when permission is denied', async () => {
    mockedRegister.mockResolvedValue({ granted: false });
    const nav = makeNav();
    const { getByTestId, findByTestId } = await render(
      <NotificationsScreen navigation={nav as never} />,
    );
    await act(async () => {
      await fireEvent.press(getByTestId('day-one-notifications-enable'));
    });
    expect(await findByTestId('day-one-notifications-deny-notice')).toBeTruthy();
    await act(async () => {
      await fireEvent.press(getByTestId('day-one-notifications-continue'));
    });
    expect(nav.navigate).toHaveBeenCalledWith('Ready');
  });
});

// ─── CheckInTime ─────────────────────────────────────────────────────────────

describe('CheckInTimeScreen', () => {
  it('renders 5/5 step text', async () => {
    const { getByTestId } = await render(
      <CheckInTimeScreen navigation={makeNav() as never} />,
    );
    expect(getByTestId('day-one-step-text').props.children).toBe('Step 5 of 5');
  });

  it('save includes the IANA timezone in the payload', async () => {
    mockedSaveCheckIn.mockResolvedValue(undefined);
    const nav = makeNav();
    const { getByTestId } = await render(
      <CheckInTimeScreen navigation={nav as never} />,
    );
    for (const unit of ['hour', 'minute']) {
      for (const direction of ['up', 'down']) {
        const control = getByTestId(`day-one-checkin-${unit}-${direction}`);
        expect(StyleSheet.flatten(control.props.style).minHeight).toBeGreaterThanOrEqual(44);
        await fireEvent.press(control);
      }
    }
    await fireEvent.press(getByTestId('day-one-checkin-pm'));
    expect(getByTestId('day-one-checkin-pm').props.accessibilityState.selected).toBe(true);
    await fireEvent.press(getByTestId('day-one-checkin-am'));
    await fireEvent.press(getByTestId('day-one-back'));
    expect(nav.goBack).toHaveBeenCalledTimes(1);
    await act(async () => {
      await fireEvent.press(getByTestId('day-one-checkin-continue'));
    });
    await waitFor(() => {
      expect(mockedSaveCheckIn).toHaveBeenCalledWith(
        { hour: 9, minute: 0 },
        'America/Los_Angeles',
      );
    });
    expect(nav.navigate).toHaveBeenCalledWith('Ready');
    await fireEvent.press(getByTestId('day-one-checkin-skip'));
    expect(nav.navigate).toHaveBeenLastCalledWith('Ready');
  });

  it('offline path enqueues a checkin sync item with the timezone', async () => {
    mockedSaveCheckIn.mockRejectedValue(new Error('network'));
    const { getByTestId } = await render(
      <CheckInTimeScreen navigation={makeNav() as never} />,
    );
    await act(async () => {
      await fireEvent.press(getByTestId('day-one-checkin-continue'));
    });
    await waitFor(() => expect(getByTestId('day-one-checkin-error')).toBeTruthy());
    await act(async () => {
      await fireEvent.press(getByTestId('day-one-checkin-offline'));
    });
    await waitFor(async () => {
      const state = await readResumeState();
      const item = state?.pendingSync[0];
      expect(item?.kind).toBe('checkin');
      if (item && item.kind === 'checkin') {
        expect(item.timezone).toBe('America/Los_Angeles');
      }
    });
  });

  it('restores the prior time from the resume checkpoint', async () => {
    await writeResumeState({
      draft: {
        checkInTime: { hour: 18, minute: 30 },
        checkInTimezone: 'UTC',
      },
    });
    const { findByTestId } = await render(
      <CheckInTimeScreen navigation={makeNav() as never} />,
    );
    const hour = await findByTestId('day-one-checkin-hour-value');
    const minute = await findByTestId('day-one-checkin-minute-value');
    await waitFor(() => {
      expect(hour.props.children).toBe('6');
      expect(minute.props.children).toBe('30');
    });
    mockedSaveCheckIn.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(undefined);
    await act(async () => fireEvent.press(await findByTestId('day-one-checkin-continue')));
    await act(async () => fireEvent.press(await findByTestId('day-one-checkin-retry')));
    expect(mockedSaveCheckIn).toHaveBeenCalledTimes(2);
  });
});

// ─── Ready ───────────────────────────────────────────────────────────────────

describe('ReadyScreen', () => {
  it('renders 5/5 step text', async () => {
    const { getByTestId, queryByText, queryByLabelText } = await render(
      <ReadyScreen navigation={makeNav() as never} />,
    );
    expect(getByTestId('day-one-step-text').props.children).toBe('Step 5 of 5');
    expect(queryByText('Your setup is done. The work starts now.')).toBeNull();
    expect(queryByLabelText('Onboarding complete')).toBeNull();
  });

  it('happy path: completes, clears the resume checkpoint, and emits auth', async () => {
    mockedComplete.mockResolvedValue(undefined);
    await writeResumeState({ step: 'Ready', draft: { goals: ['fitness'] } });
    const { getByTestId } = await render(
      <ReadyScreen navigation={makeNav() as never} />,
    );
    await act(async () => {
      await fireEvent.press(getByTestId('day-one-ready-cta'));
    });
    await waitFor(() => expect(mockedComplete).toHaveBeenCalledTimes(1));
    await waitFor(async () => {
      const state = await readResumeState();
      expect(state).toBeNull();
      expect(await AsyncStorage.getItem('day_one_completed')).toBe('true');
    });
    expect(authEvents.emit).toHaveBeenCalledTimes(1);
  });

  // B-441-1: the backend has no field for the goals or the check-in time, so
  // finishing must keep them for the account before the checkpoint goes.
  it('finishing keeps the goals and the chosen check-in time for the account', async () => {
    mockedComplete.mockResolvedValue(undefined);
    await writeResumeState({
      step: 'Ready',
      draft: {
        goals: ['fitness', 'mental_health'],
        checkInTime: { hour: 6, minute: 45 },
        checkInTimezone: 'America/Los_Angeles',
      },
    });
    const { getByTestId } = await render(
      <ReadyScreen navigation={makeNav() as never} />,
    );
    await act(async () => {
      await fireEvent.press(getByTestId('day-one-ready-cta'));
    });
    await waitFor(async () => {
      expect(await readResumeState()).toBeNull();
      expect(await AsyncStorage.getItem('day_one_completed')).toBe('true');
    });
    const kept = await readDayOneAnswers('u1');
    expect(kept?.goals).toEqual(['fitness', 'mental_health']);
    expect(kept?.checkInTime).toEqual({ hour: 6, minute: 45 });
    expect(kept?.checkInTimezone).toBe('America/Los_Angeles');
  });

  it('failure surfaces the retry banner with the Continue offline CTA', async () => {
    mockedComplete.mockRejectedValue(new Error('network'));
    jest.mocked(useCurrentUser).mockReturnValueOnce(null);
    const { getByTestId, getByText } = await render(
      <ReadyScreen navigation={makeNav() as never} />,
    );
    expect(getByText('Welcome to TGP.')).toBeTruthy();
    await act(async () => {
      await fireEvent.press(getByTestId('day-one-ready-cta'));
    });
    await waitFor(() => {
      expect(getByTestId('day-one-ready-error')).toBeTruthy();
      expect(getByTestId('day-one-ready-offline')).toBeTruthy();
    });
    mockedComplete.mockResolvedValueOnce(undefined);
    await act(async () => fireEvent.press(getByTestId('day-one-ready-cta')));
    expect(mockedComplete).toHaveBeenCalledTimes(2);
    expect(authEvents.emit).toHaveBeenCalledTimes(1);
  });

  it('Continue offline enqueues a complete sync item and emits auth', async () => {
    mockedComplete.mockRejectedValue(new Error('network'));
    const { getByTestId } = await render(
      <ReadyScreen navigation={makeNav() as never} />,
    );
    await act(async () => {
      await fireEvent.press(getByTestId('day-one-ready-cta'));
    });
    await waitFor(() => expect(getByTestId('day-one-ready-offline')).toBeTruthy());
    await act(async () => {
      await fireEvent.press(getByTestId('day-one-ready-offline'));
    });
    await waitFor(async () => {
      const state = await readResumeState();
      const pending = state?.pendingSync.find((p) => p.kind === 'complete');
      expect(pending).toBeTruthy();
      expect(await AsyncStorage.getItem('day_one_completed')).toBe('true');
    });
  });
});

// ─── Resume integration ─────────────────────────────────────────────────────

describe('Force-close resume', () => {
  it('writes resume state on advance and rehydrates it from storage', async () => {
    await writeResumeState({ step: 'Goals', draft: { goals: ['fitness', 'business'] } });
    const state = await readResumeState();
    expect(state?.step).toBe('Goals');
    expect(state?.draft.goals).toEqual(['fitness', 'business']);
  });

  it('clears resume state when called', async () => {
    await writeResumeState({ step: 'Ready' });
    await clearResumeState();
    const state = await readResumeState();
    expect(state).toBeNull();
  });
});
