/** AIB-6: entry visibility, week-level Ask AI grouped by day, revision history chips, client Workouts tab entry (plan section 6). */
import React from 'react';
import { Text } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { lightTokens } from '../../../../theme/tokens';
import WeekAiSheet from '../WeekAiSheet';
import RevisionHistorySheet from '../RevisionHistorySheet';
import { useAiEntryStatus } from '../useAiEntryStatus';
import { WorkoutsTab } from '../../../../screens/coach/client-detail/WorkoutsTab';
import type { ProgramDay } from '../../../../api/programsApi';
import type { AiBuilderStatus } from '../../../../api/aiBuilderApi';

const mockApi = { get: jest.fn(), post: jest.fn(), patch: jest.fn() };
jest.mock('../../../../services/api', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => mockApi.get(...a), post: (...a: unknown[]) => mockApi.post(...a), patch: (...a: unknown[]) => mockApi.patch(...a) },
}));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(async () => undefined), selectionAsync: jest.fn(async () => undefined), notificationAsync: jest.fn(async () => undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' }, NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));
jest.mock('../../../../screens/client/wearables/components/useReduceMotion', () => ({ useReduceMotion: () => true }));
jest.mock('../../../../theme/ThemeProvider', () => ({ useTheme: () => ({ semanticColors: jest.requireActual('../../../../theme/tokens').lightTokens }) }));

const httpError = (status: number, data: unknown = {}) => Object.assign(new Error(`HTTP ${status}`), { isAxiosError: true, response: { status, data } });
const status = (state: AiBuilderStatus['state']): AiBuilderStatus => ({ state, create: true, edit: true, credits: { remaining_pct: 50, resets_at: null }, label: 'AI-suggested, coach-approved' });
const day = (d: number, name: string): ProgramDay => ({
  week_index: 0, day_index: d, plan_id: `plan-${d}`, name, type: 'strength', duration_estimate_minutes: null, exercise_count: 4, updated_at: '2026-10-06T00:00:00Z',
});
const proposal = (d: number, ids: string[]) => ({
  draft_id: `draft-${d}`, summary: `Day ${d} progressed.`, dropped: [], context_used: [], screening_flag: false,
  changes: ids.map((id) => ({
    change_id: id, kind: 'changed', op: {}, exercise: { id, name: `Lift ${id}`, thumbnail_url: null }, reason: 'One step up.', warnings: [],
    before: { sets: 3, reps_or_duration_seconds: 8 }, after: { sets: 3, reps_or_duration_seconds: 9 },
  })),
});
const press = (s: Awaited<ReturnType<typeof render>>, id: string) => act(async () => { fireEvent.press(s.getByTestId(id)); });

beforeEach(() => {
  jest.clearAllMocks();
  mockApi.patch.mockResolvedValue({ data: { status: 'approved' } });
});

describe('WeekAiSheet', () => {
  it('asks once per filled day in day order, groups cards by day, and applies only kept ids per day', async () => {
    mockApi.post
      .mockResolvedValueOnce({ data: proposal(0, ['a1', 'a2']) })
      .mockResolvedValueOnce({ data: proposal(3, ['b1']) });
    const onApplied = jest.fn();
    const onClose = jest.fn();
    const s = await render(
      <WeekAiSheet action="progress" week={0} days={[day(3, 'Pull'), day(0, 'Push')]} status={status('on')} onClose={onClose} onApplied={onApplied} />,
    );
    await waitFor(() => expect(s.getByTestId('week-ai-apply')).toBeTruthy());
    expect(mockApi.post.mock.calls.map((c) => c[1].plan_id)).toEqual(['plan-0', 'plan-3']);
    expect(mockApi.post.mock.calls[0][1]).toEqual(expect.objectContaining({ mode: 'edit', quick_action: 'progress' }));
    expect(s.getByTestId('week-ai-day-0')).toHaveTextContent(/Lift a1/);
    expect(s.getByTestId('week-ai-day-3')).toHaveTextContent(/Lift b1/);
    expect(s.getByText('Apply 3 changes')).toBeTruthy();

    await act(async () => { fireEvent(s.getByTestId('week-ai-keep-b1'), 'valueChange', false); });
    expect(s.getByText('Apply 2 changes')).toBeTruthy();
    await press(s, 'week-ai-apply');
    expect(mockApi.patch).toHaveBeenCalledWith('/ai/gateway/drafts/draft-0', { decision: 'approved', accepted_change_ids: ['a1', 'a2'] });
    expect(mockApi.patch).toHaveBeenCalledWith('/ai/gateway/drafts/draft-3', { decision: 'rejected' });
    expect(onApplied).toHaveBeenCalledWith(2, 1);
    expect(onClose).toHaveBeenCalled();
    expect(Haptics.notificationAsync).toHaveBeenCalledWith('success');
  });

  it('paused: stays open with the paused copy and asks nothing', async () => {
    const s = await render(<WeekAiSheet action="deload" week={1} days={[day(0, 'Push')]} status={status('paused')} onClose={jest.fn()} onApplied={jest.fn()} />);
    expect(s.getByTestId('week-ai-blocked')).toHaveTextContent('Ask AI is paused for maintenance. Your workouts are unchanged.');
    expect(mockApi.post).not.toHaveBeenCalled();
  });

  it('out of credits on the first day stops the run with the specific copy', async () => {
    mockApi.post.mockRejectedValueOnce(httpError(403, { code: 'COACH_AI_BUDGET_EXHAUSTED' }));
    const s = await render(<WeekAiSheet action="progress" week={0} days={[day(0, 'Push'), day(2, 'Legs')]} status={status('on')} onClose={jest.fn()} onApplied={jest.fn()} />);
    await waitFor(() => expect(s.getByTestId('week-ai-error')).toHaveTextContent(/AI credits for this month are used up/));
    expect(mockApi.post).toHaveBeenCalledTimes(1);
    expect(s.queryByTestId('week-ai-apply')).toBeNull();
  });
});

describe('RevisionHistorySheet', () => {
  it('lists revisions newest first with author chips', async () => {
    mockApi.get.mockResolvedValueOnce({ data: [
      { revision_index: 2, author_kind: 'ai', cause: 'ai_apply', created_at: '2026-10-06T18:00:00Z', summary: 'AI-suggested, coach-approved: 2 changed. 5 exercises.' },
      { revision_index: 1, author_kind: 'coach', cause: 'autosave', created_at: '2026-10-06T17:00:00Z', summary: 'Edited: 1 added. 5 exercises.' },
    ] });
    const s = await render(<RevisionHistorySheet planId="plan-1" onClose={jest.fn()} sc={lightTokens} />);
    await waitFor(() => expect(s.getByTestId('revision-2')).toBeTruthy());
    expect(mockApi.get).toHaveBeenCalledWith('/workout-plans/plan-1/revisions', { params: { limit: 20 } });
    expect(s.getByTestId('revision-2')).toHaveTextContent(/^AI-suggested, coach-approved/);
    expect(s.getByTestId('revision-1')).toHaveTextContent(/^Coach/);
  });

  it('a backend without the route says so instead of an empty list', async () => {
    mockApi.get.mockRejectedValueOnce(httpError(404));
    const s = await render(<RevisionHistorySheet planId="plan-1" onClose={jest.fn()} sc={lightTokens} />);
    await waitFor(() => expect(s.getByTestId('revision-history-unavailable')).toBeTruthy());
  });
});

describe('entry points', () => {
  function Probe() {
    const { visible } = useAiEntryStatus();
    return <Text testID="probe">{visible ? 'shown' : 'hidden'}</Text>;
  }
  it('status 404 hides the entry; paused keeps it visible', async () => {
    mockApi.get.mockRejectedValueOnce(httpError(404));
    const hidden = await render(<Probe />);
    await waitFor(() => expect(mockApi.get).toHaveBeenCalledWith('/ai/gateway/workout-builder/status'));
    await act(async () => { await Promise.resolve(); });
    expect(hidden.getByTestId('probe')).toHaveTextContent('hidden');
    mockApi.get.mockResolvedValueOnce({ data: status('paused') });
    const paused = await render(<Probe />);
    await waitFor(() => expect(paused.getByTestId('probe')).toHaveTextContent('shown'));
  });

  it('client Workouts tab offers a program built with AI for the client by first name', async () => {
    const onBuild = jest.fn();
    type TabProps = Parameters<typeof WorkoutsTab>[0];
    const fake = <T,>(v: unknown): T => v as T; // test seam: proxies stand in for theme colors and styles
    const s = await render(
      <WorkoutsTab workoutSessions={[]} clientName="Sam Lee" onBuildWithAi={onBuild}
        colors={fake<TabProps['colors']>(new Proxy({}, { get: () => '#123456' }))} styles={fake<TabProps['styles']>(new Proxy({}, { get: () => ({}) }))} />,
    );
    expect(s.getByText('Build a program for Sam with AI')).toBeTruthy();
    await press(s, 'workouts-build-with-ai');
    expect(onBuild).toHaveBeenCalledTimes(1);
  });
});
