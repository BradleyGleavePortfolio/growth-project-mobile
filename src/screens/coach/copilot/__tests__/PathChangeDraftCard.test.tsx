import React from 'react';
import { Text } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import api from '../../../../services/api';
import { PathChangeDraftCard } from '../PathChangeDraftCard';
import { PathChangeDrafts } from '../PathChangeDrafts';
import type { PathChangeDraft } from '../../../../api/copilotApi';

jest.mock('../../../../services/api', () => ({ __esModule: true, default: { get: jest.fn(), patch: jest.fn() } }));
jest.mock('../../../../api/programsApi', () => ({ programsApi: { assignableClients: jest.fn(async () => [{ id: 'c1', name: 'Maya Okafor', email: '' }]) } }));
jest.mock('../../../../config/featureFlags', () => ({ featureFlags: { clientPathCopilot: true } }));
jest.mock('../../../../api/schedulingApi', () => ({ resolveClientTimezone: () => 'UTC' }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../../../components/roman/RomanAvatar', () => ({ __esModule: true, default: () => null }));
jest.mock('../../../../ui/haptics/haptics.service', () => ({ HapticService: { success: jest.fn(), error: jest.fn(), softImpact: jest.fn(), selection: jest.fn() } }));
jest.mock('../../../../components/ai/AiRefusalNotice', () => ({ __esModule: true, default: () => mockText('AI help is off for this client') }));
const mockText = (t: string) => <Text>{t}</Text>;
jest.mock('../../../../theme/ThemeProvider', () => {
  const t = jest.requireActual('../../../../theme/tokens');
  return { useTheme: () => ({ colors: t.colors, semanticColors: t.lightTokens }) };
});

const NOW = Date.parse('2026-10-21T22:00:00Z');
const move: PathChangeDraft = {
  id: 'd1', clientId: 'c1', reason: 'Maya says Thursday is busy.', sentAt: '2026-10-21T14:34:00Z',
  change: { kind: 'move_session', assignment_id: 'a1', workout: 'Lower body B', from_at: '2026-10-22T17:00:00Z', to_at: '2026-10-23T17:00:00Z' },
};
const kcal: PathChangeDraft = { ...move, id: 'd2', change: { kind: 'set_calorie_target', target_id: 't1', from_kcal: 2600, to_kcal: 2450 } };
const fail = (status: number, data: unknown = {}) => Object.assign(new Error('http'), { response: { status, data } });
const card = (draft: PathChangeDraft, decide = jest.fn(async () => undefined), onDecided = jest.fn()) => ({
  decide, onDecided, ui: <PathChangeDraftCard draft={draft} clientName="Maya Okafor" decide={decide} onDecided={onDecided} now={() => NOW} />,
});

beforeEach(() => jest.clearAllMocks());

test('the row shows who asked, the one change, Roman\'s reason and the three decisions', async () => {
  const { ui } = card(move);
  const s = await render(ui);
  expect(s.getByText('Maya Okafor')).toBeTruthy();
  expect(s.getByText('Asked by Maya · Today, 2:34 PM')).toBeTruthy();
  expect(s.getByText('Move Lower body B')).toBeTruthy();
  expect(s.getByLabelText('Now, Thu 22 Oct. Suggested, Fri 23 Oct.')).toBeTruthy();
  expect(s.getByText("Roman's reason: Maya says Thursday is busy.")).toBeTruthy();
  expect(s.getByText('Drafted by Roman')).toBeTruthy();
  ['Approve', 'Edit', 'Decline'].forEach((l) => expect(s.getByText(l)).toBeTruthy());
});

test('Approve applies Roman\'s change as it is', async () => {
  const { ui, decide, onDecided } = card(move);
  const s = await render(ui);
  await act(async () => fireEvent.press(s.getByText('Approve')));
  expect(decide).toHaveBeenCalledWith('d1', { decision: 'approved' });
  expect(onDecided).toHaveBeenCalledTimes(1);
});

test('Edit moves the day inside the move window and approves that day', async () => {
  const { ui, decide } = card(move);
  const s = await render(ui);
  await act(async () => fireEvent.press(s.getByText('Edit')));
  await act(async () => fireEvent.press(s.getByTestId('path-draft-later')));
  expect(s.getByLabelText('Now, Thu 22 Oct. Suggested, Sat 24 Oct.')).toBeTruthy();
  for (let i = 0; i < 9; i += 1) await act(async () => fireEvent.press(s.getByTestId('path-draft-later')));
  // 7 days ahead of now is the edge: the step stops on Wed 28 Oct.
  expect(s.getByLabelText('Now, Thu 22 Oct. Suggested, Wed 28 Oct.')).toBeTruthy();
  await act(async () => fireEvent.press(s.getByTestId('path-draft-confirm')));
  expect(decide).toHaveBeenCalledWith('d1', { decision: 'approved', payload: { to_at: '2026-10-28T17:00:00.000Z' } });
});

test('Edit on a calorie target sends the new kcal, and an invalid one cannot be approved', async () => {
  const { ui, decide } = card(kcal);
  const s = await render(ui);
  await act(async () => fireEvent.press(s.getByText('Edit')));
  await act(async () => fireEvent.changeText(s.getByTestId('path-draft-kcal'), '90'));
  expect(s.getByTestId('path-draft-confirm').props.accessibilityState.disabled).toBe(true);
  await act(async () => fireEvent.changeText(s.getByTestId('path-draft-kcal'), '2,500'));
  await act(async () => fireEvent.press(s.getByTestId('path-draft-confirm')));
  expect(decide).toHaveBeenCalledWith('d2', { decision: 'approved', payload: { to_kcal: 2500 } });
});

test('Decline keeps the plan and carries the optional one-line note', async () => {
  const { ui, decide } = card(move);
  const s = await render(ui);
  await act(async () => fireEvent.press(s.getByText('Decline')));
  await act(async () => fireEvent.changeText(s.getByPlaceholderText('Add a note for Maya (optional)'), ' Keep the run,\njust take it easy. '));
  await act(async () => fireEvent.press(s.getByTestId('path-draft-confirm')));
  expect(decide).toHaveBeenCalledWith('d1', { decision: 'rejected', note: 'Keep the run, just take it easy.' });
});

test('after "the plan changed" Approve goes and Edit still works; a lapsed or moved draft offers nothing', async () => {
  const decide = jest.fn<Promise<void>, [string, unknown]>()
    .mockRejectedValueOnce(fail(409, { code: 'COPILOT_PLAN_CHANGED', message: 'The plan changed after Roman suggested this. Edit it or decline it.' }))
    .mockResolvedValueOnce(undefined);
  const { ui, onDecided } = card(move, decide as never);
  const s = await render(ui);
  await act(async () => fireEvent.press(s.getByText('Approve')));
  expect(s.getByText('The plan changed after Roman suggested this. Edit it or decline it.')).toBeTruthy();
  expect(s.queryByTestId('path-draft-approve')).toBeNull();
  await act(async () => fireEvent.press(s.getByText('Edit')));
  await act(async () => fireEvent.press(s.getByTestId('path-draft-confirm')));
  expect(decide).toHaveBeenLastCalledWith('d1', { decision: 'approved', payload: { to_at: '2026-10-23T17:00:00.000Z' } });
  expect(onDecided).toHaveBeenCalledTimes(1);

  const lapsed = card(move, jest.fn(async () => { throw fail(409, { code: 'COPILOT_SUGGESTION_EXPIRED', message: 'This suggestion has expired.' }); }));
  const t = await render(lapsed.ui);
  await act(async () => fireEvent.press(t.getByText('Approve')));
  expect(t.getByText('This suggestion has expired.')).toBeTruthy();
  expect(t.queryByText('Edit')).toBeNull();
  expect(lapsed.onDecided).not.toHaveBeenCalled();
});

test('AI help turned off since: the coach sees the notice and can still Decline; a dropped connection says so', async () => {
  const decide = jest.fn<Promise<void>, [string, unknown]>()
    .mockRejectedValueOnce(fail(403, { code: 'ai_consent_required' }))
    .mockRejectedValueOnce(new Error('Network Error'));
  const s = await render(card(move, decide as never).ui);
  await act(async () => fireEvent.press(s.getByText('Approve')));
  expect(s.getByText('AI help is off for this client')).toBeTruthy();
  expect(s.getByText('Decline')).toBeTruthy();
  await act(async () => fireEvent.press(s.getByText('Approve')));
  expect(s.getByText('That did not go through. Try again.')).toBeTruthy();
});

test('the drafts list draws only Copilot rows, names them from the roster, and the old server array draws none', async () => {
  const row = { id: 'd1', capability: 'client_path_change', status: 'pending', subject_user_id: 'c1', payload: move.change, rationale: 'r', created_at: move.sentAt };
  jest.mocked(api.get).mockResolvedValueOnce({ data: { items: [row, { ...row, id: 'x', capability: 'program_draft' }], total: 2, next_cursor: null } } as never);
  const qc = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const s = await render(<QueryClientProvider client={qc()}><PathChangeDrafts enabled /></QueryClientProvider>);
  expect(await s.findByText('Maya Okafor')).toBeTruthy();
  expect(s.queryByTestId('path-draft-x')).toBeNull();
  await s.unmount();
  jest.mocked(api.get).mockResolvedValueOnce({ data: [row] } as never);
  const t = await render(<QueryClientProvider client={qc()}><PathChangeDrafts enabled /></QueryClientProvider>);
  await act(async () => undefined);
  expect(t.queryByTestId('path-change-drafts')).toBeNull();
});
