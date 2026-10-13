// Owner TM-P1 (2026-10-12): "There should be zero locks - there is no free or paid plan - we only do a 2%
// take rate on GMV, thats all!" Sub-coach detail shows no plan max or tier, a failed revoke or reassign
// never names a plan or capacity, and a reassign can pick a full sub-coach.
import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockPop = jest.fn();
let mockParams: Record<string, string> = {};
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), pop: mockPop, canGoBack: () => false }),
  useRoute: () => ({ params: mockParams }),
}));
const mockGetSubCoach = jest.fn();
const mockRevoke = jest.fn();
const mockList = jest.fn();
const mockReassign = jest.fn();
jest.mock('../../../api/subCoachApi', () => ({
  subCoachApi: {
    getSubCoach: (...a: unknown[]) => mockGetSubCoach(...a),
    revoke: (...a: unknown[]) => mockRevoke(...a),
    listSubCoaches: (...a: unknown[]) => mockList(...a),
    reassignClient: (...a: unknown[]) => mockReassign(...a),
  },
}));

import SubCoachDetailScreen from '../SubCoachDetailScreen';
import ClientReassignModal from '../ClientReassignModal';

const FULL = { subCoachId: 's1', assignedClients: 50, maxClients: 50, planTier: 'flat_300', hasCapacity: false };
const DETAIL = {
  id: 's1', name: 'Mia Chen', email: 'mia@example.com', created_at: '2026-01-01T00:00:00Z', coach_profile: null,
  capacity: FULL,
  engagement: {
    subCoachId: 's1', score: 70,
    breakdown: {
      logged_in_within_7d: 1, messaged_within_48h_of_checkin: 1,
      updated_workout_plan_this_week: 1, avg_workout_completion_gte_70: 1,
    },
  },
  clients: [],
};
const mount = (el: React.ReactElement) =>
  render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, bottom: 34, left: 0, right: 0 } }}>
      {el}
    </SafeAreaProvider>,
  );

beforeEach(() => jest.clearAllMocks());

describe('TM-P1: no coach plan line or plan lock in the Team stack', () => {
  it('sub-coach detail shows the client count with no plan max or tier', async () => {
    mockParams = { subCoachId: 's1' };
    mockGetSubCoach.mockResolvedValue({ data: DETAIL });
    const v = await mount(<SubCoachDetailScreen />);
    expect(await v.findByLabelText('50 clients assigned')).toBeTruthy();
    expect(v.queryByText(/\bmax\b|flat_300/i)).toBeNull();
  });

  it.each([[404, 'Could not revoke'], [409, 'Already changed']])('a %s revoke says %s, never a plan or capacity', async (status, title) => {
    mockParams = { subCoachId: 's1' };
    mockGetSubCoach.mockResolvedValue({ data: DETAIL });
    mockRevoke.mockRejectedValue({ response: { status, data: {} } });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const v = await mount(<SubCoachDetailScreen />);
    await fireEvent.press(await v.findByLabelText('Revoke Mia Chen as sub-coach'));
    const buttons = alert.mock.calls[0][2] as Array<{ text: string; onPress?: () => Promise<void> }>;
    await act(async () => {
      await buttons.find((b) => b.text === 'Revoke')?.onPress?.();
    });
    expect(alert.mock.calls.at(-1)?.[0]).toBe(title);
    expect(alert.mock.calls.flat().join(' ')).not.toMatch(/your plan|Not enabled yet|capacity/);
    alert.mockRestore();
  });

  it('reassign can pick a full sub-coach and Confirm sends the reassignment', async () => {
    mockParams = { clientId: 'c1', clientName: 'Ava', fromSubCoachId: 's0' };
    mockList.mockResolvedValue({ data: [{ ...DETAIL, capacity: FULL }] });
    mockReassign.mockResolvedValue({ data: {} });
    const v = await mount(<ClientReassignModal />);
    const option = await v.findByLabelText('Mia Chen');
    expect(v.queryByText(/50 \/ 50|full/i)).toBeNull();
    await fireEvent.press(option);
    await fireEvent.press(v.getByLabelText('Confirm reassign to Mia Chen'));
    await waitFor(() => expect(mockReassign).toHaveBeenCalledWith('s1', { clientId: 'c1', reason: undefined }));
    expect(mockPop).toHaveBeenCalledWith(2);
  });

  it('a failed reassign never says the coach is at capacity', async () => {
    mockParams = { clientId: 'c1', clientName: 'Ava', fromSubCoachId: 's0' };
    mockList.mockResolvedValue({ data: [DETAIL] });
    mockReassign.mockRejectedValue(new Error('Network Error'));
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const v = await mount(<ClientReassignModal />);
    await fireEvent.press(await v.findByLabelText('Mia Chen'));
    await fireEvent.press(v.getByLabelText('Confirm reassign to Mia Chen'));
    await waitFor(() => expect(alert).toHaveBeenCalledWith('Reassignment failed', 'The client could not be reassigned.'));
    alert.mockRestore();
  });
});
