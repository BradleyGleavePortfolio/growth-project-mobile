/**
 * B-SHARE-GUEST-127: the first onboarding screen for a client whose coach has
 * no clinic consultation (the usual share-link buyer) prints the
 * coach-sharing sentence; the tap that moves on records it. Without a notice
 * (current production, or a client who already decided) the screen is
 * unchanged and nothing is sent.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

const mockRead = jest.fn();
const mockAccept = jest.fn();
jest.mock('../../../api/coachSharingApi', () => ({
  readFirstSignInSharing: (...a: unknown[]) => mockRead(...a),
  acceptFirstSignInSharing: (...a: unknown[]) => mockAccept(...a),
}));
jest.mock('../../../services/api', () => ({ __esModule: true, default: {}, authApi: {} }));
jest.mock('../../../utils/onboardingStore', () => ({ saveOnboardingData: jest.fn(async () => undefined) }));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../lib/finalizeLeanOnboarding', () => ({ finalizeLeanOnboarding: jest.fn(async () => undefined) }));

import LeanQ1GoalScreen from '../LeanQ1GoalScreen';

const V1 = 'coach_sharing_join_v1';
const SENTENCE =
  'Joining shares your workouts, food logs, weigh-ins and check-ins with Alex Rivera. Change this any time in Settings > Privacy.';

type Nav = React.ComponentProps<typeof LeanQ1GoalScreen>['navigation'];

async function renderQ1(): Promise<jest.Mock> {
  const navigate = jest.fn();
  const navigation: Pick<Nav, 'navigate'> = { navigate };
  await render(<LeanQ1GoalScreen navigation={navigation as Nav} />);
  return navigate;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAccept.mockResolvedValue(true);
});

describe('coach sharing on the first lean onboarding screen', () => {
  it('prints the sentence naming the coach; choosing a goal records it once', async () => {
    mockRead.mockResolvedValue({ version: V1, coachName: 'Alex Rivera' });
    const navigate = await renderQ1();
    expect(await screen.findByText(SENTENCE)).toBeTruthy();
    expect(mockRead).toHaveBeenCalledWith(V1);
    expect(mockAccept).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByText('Build muscle'));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('LeanQ2'));
    expect(mockAccept).toHaveBeenCalledTimes(1);
    expect(mockAccept).toHaveBeenCalledWith(V1);

    await fireEvent.press(screen.getByText('Maintain'));
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(2));
    expect(mockAccept).toHaveBeenCalledTimes(1);
  });

  it('no notice: no sentence, and choosing a goal sends nothing', async () => {
    mockRead.mockResolvedValue(null);
    const navigate = await renderQ1();
    await waitFor(() => expect(mockRead).toHaveBeenCalled());
    expect(screen.queryByText(SENTENCE)).toBeNull();
    await fireEvent.press(screen.getByText('Lose weight'));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('LeanQ2'));
    expect(mockAccept).not.toHaveBeenCalled();
  });
});
