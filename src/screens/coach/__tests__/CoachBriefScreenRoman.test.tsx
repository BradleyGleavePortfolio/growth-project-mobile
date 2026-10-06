/**
 * CoachBriefScreen — live brief (GET /coach/brief/today) with the §2.3 Roman
 * card.
 *
 * Asserts, for the ordinary day-1 states a coach sees:
 *   - a ready brief shows Roman's face with the brief text, the items that
 *     need the coach, and a tap opens the right screen;
 *   - a coach with no clients sees the brief text and "Nothing needs you";
 *   - a load failure shows specific copy with Try again, logged via logger.warn
 *     (Bradley Law #36), never a blank screen;
 *   - a brief that could not be prepared offers Prepare again (regenerate);
 *   - a brief still being prepared polls until it is ready;
 *   - the screen marks the brief read once.
 */
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { logger } from '../../../utils/logger';
import type { CoachBrief } from '../../../api/coachBriefApi';

jest.mock('../../../config/featureFlags', () => ({
  featureFlags: {
    coachBrief: true,
    romanChat: true,
    romanCheckInBackendLive: false,
    romanStreakBackendLive: false,
  },
}));

jest.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'c1', email: 'm@x.io', firstName: 'Marcus' }),
}));

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

const mockToday = jest.fn();
const mockRegenerate = jest.fn();
const mockMarkRead = jest.fn();
jest.mock('../../../api/coachBriefApi', () => ({
  coachBriefApi: {
    today: () => mockToday(),
    regenerate: () => mockRegenerate(),
    markRead: (id: string) => mockMarkRead(id),
  },
  CoachBriefApiError: class CoachBriefApiError extends Error {},
}));

import CoachBriefScreen, { actionTarget } from '../CoachBriefScreen';

const NARRATIVE =
  'Good morning, Marcus. $147.50 came in from 3 payments since midnight. One client is waiting for a reply, and one workout was completed.';

function brief(over: Partial<CoachBrief> = {}): CoachBrief {
  return {
    id: '7b0c6a43-6a3f-4f3e-9a55-2f1f3b0f2a11',
    brief_date: '2026-10-07',
    status: 'generated',
    summary: {
      date: '2026-10-07',
      brief_mode: 'solo_coach',
      narrative: NARRATIVE,
      generated_by: 'ai',
      action_items: [
        {
          type: 'message_unread',
          client_id: 'cl-1',
          client_name: 'Dana',
          detail: 'Can we move Thursday?',
          priority: 1,
          deep_link: 'tgp://messages/cl-1',
        },
        {
          type: 'workout_approval',
          client_id: 'cl-2',
          client_name: 'Lee',
          detail: 'Upper body A needs approval',
          priority: 1,
          deep_link: 'tgp://workout/approval/w-1',
        },
      ],
    },
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockMarkRead.mockResolvedValue(undefined);
});

describe('CoachBriefScreen — live brief', () => {
  it('shows Roman with the brief text and the items that need the coach', async () => {
    mockToday.mockResolvedValue(brief());
    const { getByTestId, getByText } = await render(<CoachBriefScreen />);
    await waitFor(() => expect(getByTestId('roman-brief-card')).toBeTruthy());
    expect(getByTestId('roman-brief-avatar').props.accessibilityLabel).toBe('Roman');
    expect(getByText(NARRATIVE)).toBeTruthy();
    expect(getByText('Can we move Thursday?')).toBeTruthy();
    expect(getByText('Prepared by Roman from today\u2019s activity.')).toBeTruthy();
    await waitFor(() =>
      expect(mockMarkRead).toHaveBeenCalledWith('7b0c6a43-6a3f-4f3e-9a55-2f1f3b0f2a11'),
    );
  });

  it('a tap on an unread message opens that client thread', async () => {
    mockToday.mockResolvedValue(brief());
    const { getByTestId } = await render(<CoachBriefScreen />);
    await waitFor(() => expect(getByTestId('brief-action-message_unread')).toBeTruthy());
    fireEvent.press(getByTestId('brief-action-message_unread'));
    expect(mockNavigate).toHaveBeenCalledWith('ClientsStack', {
      screen: 'ClientMessages',
      params: { clientId: 'cl-1', clientName: 'Dana' },
      initial: false,
    });
  });

  // S-BRIEF-124 B-398-1: an older server may still send a workout item.
  it('a workout item opens the client workout history and never says approve', async () => {
    mockToday.mockResolvedValue(brief());
    const { getByTestId, getByText, queryByText } = await render(<CoachBriefScreen />);
    await waitFor(() => expect(getByTestId('brief-action-workout_approval')).toBeTruthy());
    expect(getByText('Completed a workout')).toBeTruthy();
    expect(queryByText(/approv/i)).toBeNull();
    expect(getByTestId('brief-action-workout_approval').props.accessibilityLabel).toBe(
      'Lee: Completed a workout',
    );
    fireEvent.press(getByTestId('brief-action-workout_approval'));
    expect(mockNavigate).toHaveBeenCalledWith('ClientsStack', {
      screen: 'ClientDetail',
      params: { clientId: 'cl-2', clientName: 'Lee', initialTab: 'workouts' },
      initial: false,
    });
  });

  it('a coach with no clients sees the brief text and an all-clear line', async () => {
    const text =
      'Good morning, Marcus. No clients are on the roster yet. Share an invite code from the Clients tab, and this brief fills in as soon as the first client joins.';
    mockToday.mockResolvedValue(
      brief({
        summary: {
          date: '2026-10-07',
          brief_mode: 'solo_coach',
          narrative: text,
          generated_by: 'fallback',
          action_items: [],
        },
      }),
    );
    const { getByText, getByTestId } = await render(<CoachBriefScreen />);
    await waitFor(() => expect(getByText(text)).toBeTruthy());
    expect(getByTestId('coach-brief-all-clear')).toBeTruthy();
    expect(getByText('Prepared from today\u2019s activity.')).toBeTruthy();
  });

  it('a load failure shows specific copy with Try again and is logged', async () => {
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    mockToday.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(brief());
    const { getByTestId, getByText } = await render(<CoachBriefScreen />);
    await waitFor(() => expect(getByTestId('coach-brief-error')).toBeTruthy());
    expect(getByText("Today's brief could not load.")).toBeTruthy();
    expect(warn).toHaveBeenCalledWith('CoachBriefScreen', 'failed to load brief', expect.any(Error));
    fireEvent.press(getByText('Try again'));
    await waitFor(() => expect(getByText(NARRATIVE)).toBeTruthy());
    warn.mockRestore();
  });

  it('a brief that could not be prepared offers Prepare again', async () => {
    mockToday.mockResolvedValue(brief({ status: 'failed', summary: null }));
    mockRegenerate.mockResolvedValue(brief());
    const { getByTestId, getByText } = await render(<CoachBriefScreen />);
    await waitFor(() => expect(getByTestId('coach-brief-failed')).toBeTruthy());
    fireEvent.press(getByText('Prepare again'));
    await waitFor(() => expect(getByText(NARRATIVE)).toBeTruthy());
    expect(mockRegenerate).toHaveBeenCalledTimes(1);
  });

  it('polls while the brief is still being prepared', async () => {
    mockToday
      .mockResolvedValueOnce(brief({ status: 'generating', summary: null }))
      .mockResolvedValueOnce(brief());
    const { getByTestId, getByText } = await render(<CoachBriefScreen />);
    await waitFor(() => expect(getByTestId('coach-brief-preparing')).toBeTruthy());
    await waitFor(() => expect(getByText(NARRATIVE)).toBeTruthy(), { timeout: 4_500 });
    expect(mockToday).toHaveBeenCalledTimes(2);
  }, 10_000);
});

describe('actionTarget', () => {
  it('maps each item type to a real coach route', () => {
    expect(
      actionTarget({ type: 'weight_flag', client_id: 'c', client_name: 'A', detail: 'd', priority: 2 }),
    ).toEqual({
      tab: 'ClientsStack',
      params: { screen: 'ClientDetail', params: { clientId: 'c', clientName: 'A' }, initial: false },
    });
    expect(actionTarget({ type: 'dunning_queue', detail: 'd', priority: 1 })).toEqual({
      tab: 'SettingsStack',
      params: { screen: 'CoachMoney', initial: false },
    });
    expect(actionTarget({ type: 'team_performance', detail: 'd', priority: 3 })).toEqual({
      tab: 'TeamStack',
    });
    expect(actionTarget({ type: 'payment_due', detail: 'd', priority: 2 })).toBeNull();
  });
});
