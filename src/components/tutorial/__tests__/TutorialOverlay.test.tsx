/**
 * Render tests for Roman's tour overlay (TOUR-133, prototype 46-66): the
 * coach-mark card ("Step n of 7", Skip, hairline, line, progress, one text
 * action), the rounded spotlight, the Skip confirm sheet (64), the done line
 * (3.2 s or a tap), the pending notice (66), the completion (60), the push
 * priming card (61-62), landing on Home (63), and Reduce Motion. Rendered at
 * 360x800 and 390x844.
 */
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AccessibilityInfo, Animated } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

const mockFlags = { clientTutorial: true, communityTab: true, clientCalendar: true, romanChat: true };
jest.mock('../../../config/featureFlags', () => ({
  featureFlags: {
    get clientTutorial() {
      return mockFlags.clientTutorial;
    },
    get communityTab() {
      return mockFlags.communityTab;
    },
    get clientCalendar() {
      return mockFlags.clientCalendar;
    },
    get romanChat() {
      return mockFlags.romanChat;
    },
  },
}));
jest.mock('../../../ui/haptics/haptics.service', () => ({
  HapticService: {
    success: () => Promise.resolve(),
    selection: () => Promise.resolve(),
    warning: () => Promise.resolve(),
    softImpact: () => Promise.resolve(),
  },
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 20, bottom: 34, left: 0, right: 0 }),
}));
jest.mock('react-native-svg', () => {
  const ActualReact = jest.requireActual<typeof import('react')>('react');
  const { View: RNView } = jest.requireActual<typeof import('react-native')>('react-native');
  const Stub = (props: { children?: React.ReactNode }) => ActualReact.createElement(RNView, props, props.children);
  return { __esModule: true, default: Stub, Svg: Stub, Path: Stub, Rect: Stub };
});
const mockOffer = jest.fn(async () => false);
const mockAnswer = jest.fn(async (_accept: boolean) => undefined);
jest.mock('../../../tutorial/pushPriming', () => ({
  shouldOfferPushPriming: () => mockOffer(),
  answerPushPriming: (_u: string | null, accept: boolean) => mockAnswer(accept),
}));
let mockWindow = { width: 390, height: 844 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ ...mockWindow, scale: 3, fontScale: 1 }),
}));

import { StyleSheet } from 'react-native';
import TutorialOverlay, { spotlightPath, TUTORIAL_DONE_LINE_MS, TUTORIAL_FADE_MS } from '../TutorialOverlay';
import { radius } from '../../../theme/tokens';
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
const TABS = ['Home', 'WorkoutTab', 'Log', 'CalendarTab', 'MoreTab', 'CommunityTab'];

async function begin() {
  await hydrateTutorial('u1', 'Maya', true);
  setTutorialRoute(['Home', 'HomeMain']);
  startClientTutorial(PAYLOAD);
}

/** Welcome to the message beat, every gate met by its real action. */
function toMessageBeat() {
  dispatchTutorial({ type: 'ACK' });
  setTutorialRoute(['WorkoutTab', 'WorkoutMain']);
  setTutorialRoute(['MoreTab', 'WorkoutAssignmentDetail']);
  dispatchTutorial({ type: 'ACK' });
  setTutorialRoute(['Log']);
  dispatchTutorial({ type: 'SIGNAL', signal: 'meal_logged' });
  setTutorialRoute(['Home', 'HomeMain']);
  dispatchTutorial({ type: 'SIGNAL', signal: 'macro_card_opened' });
  useTutorialStore.setState({ celebration: null });
}

function toCompletion() {
  toMessageBeat();
  setTutorialRoute(['Home', 'Messages']);
  dispatchTutorial({ type: 'SIGNAL', signal: 'message_sent' });
  useTutorialStore.setState({ celebration: null });
}

beforeEach(async () => {
  await AsyncStorage.clear();
  __resetTutorialStoreForTests();
  mockFlags.clientTutorial = true;
  mockOffer.mockReset().mockResolvedValue(false);
  mockAnswer.mockClear();
  mockWindow = { width: 390, height: 844 };
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const line = () => screen.getByTestId('tutorial-line').props.children;

describe('TutorialOverlay', () => {
  it('renders nothing when the tour is not active', async () => {
    await hydrateTutorial('u1', 'Maya');
    await render(<TutorialOverlay tabs={TABS} onNavigate={jest.fn()} />);
    expect(screen.queryByTestId('tutorial-overlay')).toBeNull();
  });

  it.each([
    [360, 800],
    [390, 844],
  ])('welcomes the client with Roman, Step 1 of 7, Skip and Begin at %sx%s', async (w, h) => {
    mockWindow = { width: w, height: h };
    await begin();
    await render(<TutorialOverlay tabs={TABS} onNavigate={jest.fn()} />);
    expect(line()).toMatch(/^Welcome, Maya\. I am Roman\. I work with Bradley/);
    const avatar = screen.getAllByTestId('tutorial-roman-avatar')[0];
    expect(avatar.props.source).toBe(romanFaceAsset('neutral'));
    expect(screen.getByTestId('tutorial-step-count').props.children).toBe('Step 1 of 7');
    const progress = screen.getByTestId('tutorial-progress');
    expect(progress.props.accessibilityRole).toBe('progressbar');
    expect(progress.props.accessibilityLabel).toBe('Step 1 of 7, Welcome');
    expect(progress.props.accessibilityValue).toEqual({ min: 0, max: 7, now: 1 });
    expect(screen.getByLabelText('Begin')).toBeTruthy();
    expect(screen.getByLabelText('Skip')).toBeTruthy();
    // Welcome is a full scrim, no cut-out (46).
    expect(screen.queryByTestId('tutorial-spotlight')).toBeNull();
    // Rounded corners from the tokens (owner 17:07).
    expect(StyleSheet.flatten(screen.getByTestId('tutorial-card').props.style).borderRadius).toBe(radius.card);
  });

  it('Begin moves to the plan beat and spotlights the Train tab with a rounded cut-out', async () => {
    await begin();
    await render(<TutorialOverlay tabs={TABS} onNavigate={jest.fn()} />);
    await fireEvent.press(screen.getByLabelText('Begin'));
    expect(line()).toBe('This is Train. Bradley assigned you Foundations. Tap Train to see it.');
    expect(screen.getByTestId('tutorial-spotlight')).toBeTruthy();
    expect(screen.getByTestId('tutorial-step-count').props.children).toBe('Step 2 of 7');
    // A route gate has no button that could fake the action.
    expect(screen.queryByTestId('tutorial-ack')).toBeNull();
  });

  it.each([[360, 800], [390, 844]])('B-606-1: tab beats (47, 51, 55) put the card just above the tab bar at %sx%s', async (w, h) => {
    mockWindow = { width: w, height: h };
    const aboveBar = (step: string) => {
      expect(screen.getByTestId('tutorial-step-count').props.children).toBe(step);
      const { bottom, top } = StyleSheet.flatten(screen.getByTestId('tutorial-card-wrap').props.style);
      expect([bottom, top]).toEqual([34 + 64 + 12, undefined]); // bottom inset + tab bar + 12 pt, never the top slot
    };
    await begin();
    await render(<TutorialOverlay tabs={TABS} onNavigate={jest.fn()} />);
    await fireEvent.press(screen.getByLabelText('Begin'));
    aboveBar('Step 2 of 7'); // 47 Train
    await act(async () => {
      setTutorialRoute(['WorkoutTab', 'WorkoutMain']);
      setTutorialRoute(['MoreTab', 'WorkoutAssignmentDetail']);
      dispatchTutorial({ type: 'ACK' });
      useTutorialStore.setState({ celebration: null });
    });
    aboveBar('Step 4 of 7'); // 51 Food
    await act(async () => {
      setTutorialRoute(['Log']);
      dispatchTutorial({ type: 'SIGNAL', signal: 'meal_logged' });
      useTutorialStore.setState({ celebration: null });
    });
    aboveBar('Step 5 of 7'); // 55 Tap Home
  });

  it('the spotlight path is a full-screen rect with a rounded hole', () => {
    const d = spotlightPath(390, 844, 10, 20, 100, 60, radius.card);
    expect(d.startsWith('M0 0H390V844H0Z')).toBe(true);
    expect(d).toContain(`A${radius.card} ${radius.card} 0 0 1`);
    // Never a radius larger than half the hole.
    expect(spotlightPath(390, 844, 0, 0, 20, 20, radius.card)).toContain('A10 10');
  });

  it('shows the done line with a check, clears after 3.2 s, or on a tap', async () => {
    jest.useFakeTimers();
    await begin();
    await render(<TutorialOverlay tabs={TABS} onNavigate={jest.fn()} />);
    await act(async () => {
      dispatchTutorial({ type: 'ACK' });
      setTutorialRoute(['WorkoutTab', 'WorkoutMain']);
      setTutorialRoute(['MoreTab', 'WorkoutAssignmentDetail']);
    });
    expect(screen.getByTestId('tutorial-done-line')).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(TUTORIAL_DONE_LINE_MS);
    });
    expect(screen.queryByTestId('tutorial-done-line')).toBeNull();
    expect(screen.getByTestId('tutorial-step-count').props.children).toBe('Step 3 of 7');
  });

  it('Skip asks first in a sheet (64), keeps progress, and hides the overlay', async () => {
    await begin();
    await render(<TutorialOverlay tabs={TABS} onNavigate={jest.fn()} />);
    await fireEvent.press(screen.getByLabelText('Skip'));
    expect(screen.getByText('Skip the tour?')).toBeTruthy();
    expect(screen.getByText('You can pick it up again from Settings, under Tutorial.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('tutorial-keep-going'));
    expect(screen.queryByText('Skip the tour?')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Skip'));
    await fireEvent.press(screen.getByLabelText('Skip tour'));
    expect(useTutorialStore.getState().tutorial.status).toBe('paused');
    expect(screen.queryByTestId('tutorial-overlay')).toBeNull();
    await act(async () => dispatchTutorial({ type: 'RESUME' }));
    expect(screen.getByTestId('tutorial-overlay')).toBeTruthy();
  });

  it('without a plan, beat two speaks once with Continue, then the tour moves to Food (66)', async () => {
    await hydrateTutorial('u1', 'Maya', true);
    setTutorialRoute(['Home', 'HomeMain']);
    startClientTutorial({ ...PAYLOAD, program: null });
    await render(<TutorialOverlay tabs={TABS} onNavigate={jest.fn()} />);
    await fireEvent.press(screen.getByLabelText('Begin'));
    expect(screen.getByTestId('tutorial-step-count').props.children).toBe('Step 2 of 7');
    expect(line()).toMatch(/^Bradley is still setting up your first plan\./);
    await fireEvent.press(screen.getByLabelText('Continue'));
    expect(screen.getByTestId('tutorial-step-count').props.children).toBe('Step 4 of 7');
    expect(line()).toMatch(/^This is Food\./);
  });

  it('offers Take me there and Later on the message beat; Later moves to the completion', async () => {
    await begin();
    const onNavigate = jest.fn();
    await render(<TutorialOverlay tabs={TABS} onNavigate={onNavigate} />);
    await act(async () => toMessageBeat());
    expect(line()).toMatch(/A real person, not me\./);
    await fireEvent.press(screen.getByLabelText('Take me there'));
    expect(onNavigate).toHaveBeenCalledWith({ tab: 'Home', screen: 'Messages' });
    await fireEvent.press(screen.getByLabelText('Later'));
    expect(useTutorialStore.getState().tutorial.outcomes.first_message).toBe('deferred');
    expect(line()).toMatch(/^That is everything, Maya\./);
  });

  it('ends on the completion (60): face, serif line, no Skip; Got it lands on Home (63)', async () => {
    await begin();
    const onNavigate = jest.fn();
    await render(<TutorialOverlay tabs={TABS} onNavigate={onNavigate} />);
    await act(async () => toCompletion());
    expect(line()).toBe('That is everything, Maya. Your plan is set, your numbers are set, and Bradley has your message.');
    expect(screen.getByTestId('tutorial-sub').props.children).toMatch(/One thing at a time\. You do not need to be perfect, just consistent\.$/);
    expect(screen.queryByLabelText('Skip')).toBeNull();
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Got it'));
    });
    expect(useTutorialStore.getState().tutorial.status).toBe('completed');
    expect(onNavigate).toHaveBeenCalledWith({ tab: 'Home', screen: 'HomeMain' });
    expect(screen.queryByTestId('tutorial-overlay')).toBeNull();
  });

  it('then asks for notifications once (61); only Turn on asks the OS, Not now goes Home (62)', async () => {
    mockOffer.mockResolvedValue(true);
    await begin();
    const onNavigate = jest.fn();
    await render(<TutorialOverlay tabs={TABS} onNavigate={onNavigate} />);
    await act(async () => toCompletion());
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Got it'));
    });
    expect(screen.getByTestId('tutorial-push-priming')).toBeTruthy();
    expect(line()).toBe(
      "Want a nudge when Bradley messages you, or when the day's workout is ready? I will only ask once.",
    );
    expect(onNavigate).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Not now'));
    });
    expect(mockAnswer).toHaveBeenCalledWith(false);
    expect(onNavigate).toHaveBeenCalledWith({ tab: 'Home', screen: 'HomeMain' });
    expect(screen.queryByTestId('tutorial-overlay')).toBeNull();
  });

  it('Turn on notifications answers yes before landing on Home', async () => {
    mockOffer.mockResolvedValue(true);
    await begin();
    const onNavigate = jest.fn();
    await render(<TutorialOverlay tabs={TABS} onNavigate={onNavigate} />);
    await act(async () => toCompletion());
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Got it'));
    });
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Turn on notifications'));
    });
    expect(mockAnswer).toHaveBeenCalledWith(true);
    expect(onNavigate).toHaveBeenCalledWith({ tab: 'Home', screen: 'HomeMain' });
  });

  it('a coachless client meets Roman at beat six', async () => {
    await hydrateTutorial('u1', 'Maya', false);
    setTutorialRoute(['Home', 'HomeMain']);
    startClientTutorial({ ...PAYLOAD, coach: null });
    await render(<TutorialOverlay tabs={TABS} onNavigate={jest.fn()} />);
    await act(async () => toMessageBeat());
    expect(screen.getByTestId('tutorial-step-count').props.children).toBe('Step 6 of 7');
    expect(line()).toMatch(/ask me\. You will find me under You/);
    expect(screen.getByLabelText('Continue')).toBeTruthy();
  });

  it('animates the card with a single 280 ms fade', async () => {
    const timing = jest.spyOn(Animated, 'timing');
    await begin();
    await render(<TutorialOverlay tabs={TABS} onNavigate={jest.fn()} />);
    expect(timing).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ duration: TUTORIAL_FADE_MS }));
    expect(TUTORIAL_FADE_MS).toBeLessThanOrEqual(300);
  });

  it('drops the animation entirely under Reduce Motion', async () => {
    const timing = jest.spyOn(Animated, 'timing');
    (AccessibilityInfo.isReduceMotionEnabled as jest.Mock).mockResolvedValue(true);
    await begin();
    await render(<TutorialOverlay tabs={TABS} onNavigate={jest.fn()} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    timing.mockClear();
    await act(async () => dispatchTutorial({ type: 'ACK' }));
    expect(timing).not.toHaveBeenCalled();
  });
});
