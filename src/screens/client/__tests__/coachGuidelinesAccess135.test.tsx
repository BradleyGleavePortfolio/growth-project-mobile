/**
 * B-SMALLFIX-135 (m#650 review U1): a coached client without an active plan
 * who taps Coach guidelines on Train is told the real reason (access), with
 * the plans action the rest of the app uses. The connection line is kept
 * only for a real failed read.
 */
import React from 'react';
import { AxiosHeaders, type AxiosResponse } from 'axios';
import { fireEvent, render } from '@testing-library/react-native';
import CoachGuidelinesScreen, {
  GUIDELINES_ACCESS_BODY,
  GUIDELINES_ACCESS_TITLE,
} from '../CoachGuidelinesScreen';
import { coachApi } from '../../../services/api';

const mockOpenPlans = jest.fn();
const mockMessageCoach = jest.fn();
let mockStatus = 'unknown';
let mockHidden = false;
jest.mock('../../../entitlements/EntitlementProvider', () => ({
  useEntitlement: () => ({ status: mockStatus, openPlans: mockOpenPlans, messageCoach: mockMessageCoach }),
}));
jest.mock('../../../config/purchaseSurfaces', () => ({ nonP2PPurchasesHidden: () => mockHidden }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ goBack: jest.fn() }) }));
jest.mock('../../../hooks/useCurrentUser', () => {
  const user = { id: 'student', coach_id: 'coach-1' };
  return { useCurrentUser: () => user };
});
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: {}, semanticColors: jest.requireActual('../../../theme/tokens').lightTokens }),
}));
jest.mock('../../../services/api', () => ({ coachApi: { getMyGuidelines: jest.fn() } }));
jest.mock('../../../ui/skeletons/Skeleton', () => ({ SkeletonScreen: () => null }));

const getGuidelines = jest.mocked(coachApi.getMyGuidelines);
const CONNECTION = 'Guidelines did not load. Check your connection and try again.';
function ok<T>(data: T): AxiosResponse<T> {
  return { data, status: 200, statusText: 'OK', headers: {}, config: { headers: new AxiosHeaders() } };
}
function accessError() {
  return Object.assign(new Error('Request failed with status code 402'), {
    response: { status: 402, data: { error: 'CLIENT_ENTITLEMENT_REQUIRED', message: 'Choose a plan to continue.' } },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStatus = 'unknown';
  mockHidden = false;
});

it('a plan known to be inactive: no read, the access line and View plans, never the connection line', async () => {
  mockStatus = 'inactive';
  const screen = await render(<CoachGuidelinesScreen />);
  expect(screen.getByText(GUIDELINES_ACCESS_TITLE)).toBeTruthy();
  expect(screen.getByText(GUIDELINES_ACCESS_BODY)).toBeTruthy();
  expect(GUIDELINES_ACCESS_BODY).toBe("Your coach's guidelines open when your plan with them is active.");
  expect(screen.queryByText(CONNECTION)).toBeNull();
  expect(screen.queryByText('Retry')).toBeNull();
  expect(getGuidelines).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'View plans' }));
  expect(mockOpenPlans).toHaveBeenCalledTimes(1);
});

it('a 402 from the guard while access is still unknown shows the access line, not the connection line', async () => {
  getGuidelines.mockRejectedValueOnce(accessError());
  const screen = await render(<CoachGuidelinesScreen />);
  expect(await screen.findByText(GUIDELINES_ACCESS_TITLE)).toBeTruthy();
  expect(screen.queryByText(CONNECTION)).toBeNull();
  expect(screen.queryByText('Could not load guidelines')).toBeNull();
});

it('hidden iOS build: the action is Message your coach, as on every other coach-managed gate', async () => {
  mockStatus = 'inactive';
  mockHidden = true;
  const screen = await render(<CoachGuidelinesScreen />);
  expect(screen.queryByText('View plans')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Message your coach' }));
  expect(mockMessageCoach).toHaveBeenCalledTimes(1);
  expect(mockOpenPlans).not.toHaveBeenCalled();
});

it('a real failed read keeps the connection line and Retry, with no access line', async () => {
  getGuidelines.mockRejectedValueOnce(new Error('Network Error'));
  getGuidelines.mockResolvedValueOnce(ok({ title: 'Training notes', description: 'Use a steady pace.' }));
  const screen = await render(<CoachGuidelinesScreen />);
  expect(await screen.findByText(CONNECTION)).toBeTruthy();
  expect(screen.queryByText(GUIDELINES_ACCESS_TITLE)).toBeNull();
  await fireEvent.press(screen.getByText('Retry'));
  expect(await screen.findByText('Training notes')).toBeTruthy();
});

it('an active plan reads and shows the guidelines', async () => {
  mockStatus = 'active';
  getGuidelines.mockResolvedValueOnce(ok({ title: 'Training notes', description: 'Use a steady pace.' }));
  const screen = await render(<CoachGuidelinesScreen />);
  expect(await screen.findByText('Use a steady pace.')).toBeTruthy();
  expect(screen.queryByText(GUIDELINES_ACCESS_TITLE)).toBeNull();
});

it('once the plan is active again the guidelines load in place', async () => {
  mockStatus = 'inactive';
  const screen = await render(<CoachGuidelinesScreen />);
  expect(screen.getByText(GUIDELINES_ACCESS_TITLE)).toBeTruthy();
  mockStatus = 'checking';
  await screen.rerender(<CoachGuidelinesScreen />);
  expect(screen.getByText(GUIDELINES_ACCESS_TITLE)).toBeTruthy();
  expect(getGuidelines).not.toHaveBeenCalled();
  getGuidelines.mockResolvedValueOnce(ok({ title: 'Training notes', description: 'Use a steady pace.' }));
  mockStatus = 'active';
  await screen.rerender(<CoachGuidelinesScreen />);
  expect(await screen.findByText('Use a steady pace.')).toBeTruthy();
  expect(getGuidelines).toHaveBeenCalledTimes(1);
});
