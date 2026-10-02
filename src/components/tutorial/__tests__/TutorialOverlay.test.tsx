/**
 * Render tests for Roman's tutorial overlay: the coach-mark card, progress
 * indicator, Roman's canonical face, spotlight, skip/resume, defer, the
 * per-step done line, the completion moment, accessibility labels and
 * Reduce Motion.
 */
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AccessibilityInfo, Animated } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

const mockFlags = { clientTutorial: true, communityTab: true };
jest.mock('../../../config/featureFlags', () => ({
  featureFlags: {
    get clientTutorial() {
      return mockFlags.clientTutorial;
    },
    get communityTab() {
      return mockFlags.communityTab;
    },
  },
}));
jest.mock('../../../ui/haptics/haptics.service', () => ({
  HapticService: {
    success: () => Promise.resolve(),
    selection: () => Promise.resolve(),
    warning: () => Promise.resolve(),
  },
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 20, bottom: 34, left: 0, right: 0 }),
}));

import TutorialOverlay from '../TutorialOverlay';
import { romanFaceAsset } from '../../roman/romanAvatarAssets';
import {
  __resetTutorialStoreForTests,
  dispatchTutorial,
  hydrateTutorial,
  setTutorialRoute,
  startClientTutorial,
  useTutorialStore,
} from '../../../tutorial/tutorialStore';
import type { OnboardingCompletePayload } from '../../../tutorial/types';

const PAYLOAD: OnboardingCompletePayload = {
  macros: { calories: 1789, protein_g: 150, carbs_g: 185, fat_g: 50 },
  program: { id: 'p1', name: 'Foundations', days_per_week: 3, weeks: 4, why: ['You are new to lifting.'] },
  spaces: [{ id: 's1', name: 'All members' }],
  coach: { id: 'c1', display_name: 'Bradley' },
};
const TABS = ['Home', 'WorkoutTab', 'Log', 'MoreTab', 'CommunityTab'];

async function begin() {
  await hydrateTutorial('u1', 'Maya');
  setTutorialRoute(['Home', 'HomeMain']);
  startClientTutorial(PAYLOAD);
}

function toWearableConnect() {
  dispatchTutorial({ type: 'ACK' });
  setTutorialRoute(['WorkoutTab', 'WorkoutMain']);
  dispatchTutorial({ type: 'SIGNAL', signal: 'plan_card_opened' });
  setTutorialRoute(['Home', 'HomeMain']);
  dispatchTutorial({ type: 'SIGNAL', signal: 'macro_card_opened' });
  setTutorialRoute(['CommunityTab', 'CommunityTab']);
  dispatchTutorial({ type: 'ACK' });
  setTutorialRoute(['Home', 'Messages']);
  dispatchTutorial({ type: 'ACK' });
}

beforeEach(async () => {
  await AsyncStorage.clear();
  __resetTutorialStoreForTests();
  mockFlags.clientTutorial = true;
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
});
afterEach(() => jest.restoreAllMocks());

describe('TutorialOverlay', () => {
  it('renders nothing when the tour is not active', async () => {
    await hydrateTutorial('u1', 'Maya');
    await render(<TutorialOverlay tabs={TABS} onNavigate={jest.fn()} />);
    expect(screen.queryByTestId('tutorial-overlay')).toBeNull();
  });

  it('welcomes the client in Roman\'s voice with his canonical face and a progress indicator', async () => {
    await begin();
    await render(<TutorialOverlay tabs={TABS} onNavigate={jest.fn()} />);
    expect(screen.getByTestId('tutorial-line').props.children).toMatch(
      /^Welcome, Maya\. I am Roman\. I work with Bradley/,
    );
    const avatar = screen.getByTestId('tutorial-roman-avatar');
    expect(avatar.props.source).toBe(romanFaceAsset('neutral'));
    expect(avatar.props.source).not.toBe(romanFaceAsset('smile'));
    const progress = screen.getByTestId('tutorial-progress');
    expect(progress.props.accessibilityRole).toBe('progressbar');
    expect(progress.props.accessibilityLabel).toBe('Step 1 of 8, Welcome');
    expect(progress.props.accessibilityValue).toEqual({ min: 0, max: 8, now: 0 });
    expect(screen.getByLabelText('Begin')).toBeTruthy();
    expect(screen.getByLabelText('Skip the tour')).toBeTruthy();
  });

  it('Begin moves to the plan step and spotlights the Train tab', async () => {
    await begin();
    await render(<TutorialOverlay tabs={TABS} onNavigate={jest.fn()} />);
    await fireEvent.press(screen.getByLabelText('Begin'));
    expect(screen.getByTestId('tutorial-line').props.children).toBe(
      'This is Train. Bradley has assigned you Foundations. Tap Train to see it.',
    );
    expect(screen.getByTestId('tutorial-spotlight')).toBeTruthy();
    expect(screen.getByTestId('tutorial-progress').props.accessibilityLabel).toBe(
      'Step 2 of 8, Your workout plan',
    );
    // A route gate has no button that could fake the action.
    expect(screen.queryByLabelText('Begin')).toBeNull();
    expect(screen.queryByTestId('tutorial-ack')).toBeNull();
  });

  it('shows the done line with a check after a step completes', async () => {
    await begin();
    await render(<TutorialOverlay tabs={TABS} onNavigate={jest.fn()} />);
    await act(async () => {
      dispatchTutorial({ type: 'ACK' });
      setTutorialRoute(['WorkoutTab', 'WorkoutMain']);
      dispatchTutorial({ type: 'SIGNAL', signal: 'plan_card_opened' });
    });
    expect(screen.getByTestId('tutorial-done-line')).toBeTruthy();
    expect(screen.getByText('Your plan stays pinned here on Train.')).toBeTruthy();
  });

  it('Skip asks first, keeps progress, and hides the overlay', async () => {
    await begin();
    await render(<TutorialOverlay tabs={TABS} onNavigate={jest.fn()} />);
    await fireEvent.press(screen.getByLabelText('Skip the tour'));
    expect(screen.getByText('Skip the tour?')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Keep going'));
    expect(screen.queryByText('Skip the tour?')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Skip the tour'));
    await fireEvent.press(screen.getByLabelText('Skip tour'));
    expect(useTutorialStore.getState().tutorial.status).toBe('paused');
    expect(screen.queryByTestId('tutorial-overlay')).toBeNull();
    await act(async () => dispatchTutorial({ type: 'RESUME' }));
    expect(screen.getByTestId('tutorial-overlay')).toBeTruthy();
  });

  it('offers Take me there for menu screens and Later on the wearable connect gate', async () => {
    await begin();
    const onNavigate = jest.fn();
    await render(<TutorialOverlay tabs={TABS} onNavigate={onNavigate} />);
    await act(async () => toWearableConnect());
    expect(screen.getByTestId('tutorial-line').props.children).toMatch(/Connected devices/);
    await fireEvent.press(screen.getByLabelText('Take me there'));
    expect(onNavigate).toHaveBeenCalledWith({ tab: 'MoreTab', screen: 'Connections' });
    await act(async () => setTutorialRoute(['MoreTab', 'Connections']));
    expect(screen.getByLabelText('Later')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Later'));
    expect(useTutorialStore.getState().tutorial.outcomes.wearables).toBe('deferred');
    expect(screen.getByTestId('tutorial-line').props.children).toMatch(/Health and sleep/);
  });

  it('ends on a quiet completion card with no skip, and Done finishes the tour', async () => {
    await begin();
    await render(<TutorialOverlay tabs={TABS} onNavigate={jest.fn()} />);
    await act(async () => {
      toWearableConnect();
      setTutorialRoute(['MoreTab', 'Connections']);
      dispatchTutorial({ type: 'SIGNAL', signal: 'wearable_connected' });
      setTutorialRoute(['MoreTab', 'Health']);
      dispatchTutorial({ type: 'ACK' });
      setTutorialRoute(['Log']);
      dispatchTutorial({ type: 'SIGNAL', signal: 'meal_logged' });
      setTutorialRoute(['Home', 'Messages']);
      dispatchTutorial({ type: 'SIGNAL', signal: 'message_sent' });
    });
    expect(screen.getByTestId('tutorial-line').props.children).toMatch(
      /^That is everything, Maya\. Your plan is set, your numbers are set, and Bradley has your message\./,
    );
    expect(screen.getByTestId('tutorial-progress').props.accessibilityLabel).toBe('Tour complete');
    expect(screen.queryByLabelText('Skip the tour')).toBeNull();
    expect(screen.getByTestId('tutorial-roman-avatar').props.source).toBe(romanFaceAsset('neutral'));
    await fireEvent.press(screen.getByLabelText('Done'));
    expect(useTutorialStore.getState().tutorial.status).toBe('completed');
    expect(screen.queryByTestId('tutorial-overlay')).toBeNull();
  });

  it('animates the card with a single 280ms fade', async () => {
    const timing = jest.spyOn(Animated, 'timing');
    await begin();
    await render(<TutorialOverlay tabs={TABS} onNavigate={jest.fn()} />);
    expect(timing).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ duration: 280 }));
  });

  it('drops the animation entirely under Reduce Motion', async () => {
    const timing = jest.spyOn(Animated, 'timing');
    (AccessibilityInfo.isReduceMotionEnabled as jest.Mock).mockResolvedValue(true);
    await begin();
    await render(<TutorialOverlay tabs={TABS} onNavigate={jest.fn()} />);
    // Let the Reduce Motion probe resolve.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    timing.mockClear();
    await act(async () => dispatchTutorial({ type: 'ACK' }));
    expect(timing).not.toHaveBeenCalled();
  });
});
