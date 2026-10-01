/**
 * C08 explanation cards (real numbers, accessibility, the real action that
 * satisfies the tutorial step) and the flag-gated Home / Settings surfaces.
 */
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, screen } from '@testing-library/react-native';

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
const mockNavigate = jest.fn();
const mockParentNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
    getParent: () => ({ navigate: mockParentNavigate }),
  }),
}));

import MacroExplanationCard, { MacroExplanationCardView } from '../MacroExplanationCard';
import PlanExplanationCard, { PlanExplanationCardView } from '../PlanExplanationCard';
import TutorialHomeSlot from '../TutorialHomeSlot';
import TutorialSettingsRow from '../TutorialSettingsRow';
import { subscribeTutorialSignals } from '../../../tutorial/tutorialEvents';
import {
  __resetTutorialStoreForTests,
  dispatchTutorial,
  hydrateTutorial,
  startClientTutorial,
  useTutorialStore,
} from '../../../tutorial/tutorialStore';
import type { OnboardingCompletePayload, TutorialSignal } from '../../../tutorial/types';
import { __resetMacroDisplayStoreForTests } from '../../../macros/macroDisplayStore';

const PAYLOAD: OnboardingCompletePayload = {
  macros: { calories: 1789, protein_g: 150, carbs_g: 185, fat_g: 50, floor_applied: true },
  program: {
    id: 'p1',
    name: 'Foundations',
    days_per_week: 3,
    weeks: 4,
    why: ['You are new to lifting.', 'You can train three days a week.', 'You train at home.'],
  },
  spaces: [],
  coach: { id: 'c1', display_name: 'Bradley' },
};

const seen: TutorialSignal[] = [];
let unsub: () => void = () => undefined;
beforeEach(async () => {
  await AsyncStorage.clear();
  __resetTutorialStoreForTests();
  __resetMacroDisplayStoreForTests();
  mockFlags.clientTutorial = true;
  mockNavigate.mockClear();
  mockParentNavigate.mockClear();
  seen.length = 0;
  unsub = subscribeTutorialSignals((s) => seen.push(s));
});
afterEach(() => unsub());

describe('MacroExplanationCard', () => {
  it('shows the real targets with a spoken accessibility summary', async () => {
    await render(<MacroExplanationCardView macros={PAYLOAD.macros!} />);
    expect(screen.getByText('1,789')).toBeTruthy();
    expect(screen.getByText(/^150/, { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByText(/^185/, { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByText(/^50/, { includeHiddenElements: true })).toBeTruthy();
    expect(
      screen.getByLabelText(
        '1,789 calories a day. Protein 150 grams, carbs 185 grams, fat 50 grams.',
      ),
    ).toBeTruthy();
  });

  it('opening "How to use these numbers" explains them and emits the step signal', async () => {
    await render(<MacroExplanationCardView macros={PAYLOAD.macros!} />);
    const toggle = screen.getByLabelText('How to use these numbers');
    expect(toggle.props.accessibilityState).toMatchObject({ expanded: false });
    await fireEvent.press(toggle);
    expect(screen.getByTestId('macro-explanation-body').props.children).toMatch(
      /Aim for close, not perfect\. Your calories are held at a sensible minimum/,
    );
    expect(screen.getByLabelText('How to use these numbers').props.accessibilityState).toMatchObject({
      expanded: true,
    });
    expect(seen).toEqual(['macro_card_opened']);
  });

  it('is pinned from the store and hidden without numbers or with the flag off', async () => {
    await hydrateTutorial('u1', 'Maya');
    const { rerender } = await render(<MacroExplanationCard />);
    expect(screen.queryByTestId('macro-explanation-card')).toBeNull();
    startClientTutorial(PAYLOAD);
    await rerender(<MacroExplanationCard />);
    expect(screen.getByTestId('macro-explanation-card')).toBeTruthy();
    mockFlags.clientTutorial = false;
    await rerender(<MacroExplanationCard />);
    expect(screen.queryByTestId('macro-explanation-card')).toBeNull();
  });
});

describe('MacroExplanationCard, lighter start (simple view)', () => {
  it('shows calories and protein only, and says why', async () => {
    await render(<MacroExplanationCardView macros={PAYLOAD.macros!} mode="simple" />);
    expect(screen.getByText('1,789')).toBeTruthy();
    expect(screen.getByText(/^150/, { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByText('CARBS', { includeHiddenElements: true })).toBeNull();
    expect(screen.queryByText('FAT', { includeHiddenElements: true })).toBeNull();
    expect(screen.queryByText(/^185/, { includeHiddenElements: true })).toBeNull();
    expect(screen.getByLabelText('1,789 calories a day. Protein 150 grams.')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('How to use these numbers'));
    expect(screen.getByTestId('macro-explanation-body').props.children).toMatch(
      /watch two things only: calories and protein\..*Carbohydrate and fat join these after the first week\./,
    );
    expect(seen).toEqual(['macro_card_opened']);
  });

  it('follows the stored display mode when pinned on Home', async () => {
    await hydrateTutorial('u1', 'Maya');
    startClientTutorial({ ...PAYLOAD, macro_display_mode: 'simple', simple_until: '2999-01-01' });
    await render(<MacroExplanationCard />);
    expect(screen.queryByText('CARBS', { includeHiddenElements: true })).toBeNull();
  });

  it('defaults to the full card when the backend sends no mode', async () => {
    await render(<MacroExplanationCardView macros={PAYLOAD.macros!} />);
    expect(screen.getByText('CARBS', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByText('FAT', { includeHiddenElements: true })).toBeTruthy();
  });
});

describe('PlanExplanationCard', () => {
  it('shows the assigned program and its reasons on request', async () => {
    await render(<PlanExplanationCardView program={PAYLOAD.program!} coachName="Bradley" />);
    expect(screen.getByText('ASSIGNED BY BRADLEY')).toBeTruthy();
    expect(screen.getByText('Foundations')).toBeTruthy();
    expect(screen.getByText('4 weeks · 3 days a week')).toBeTruthy();
    expect(screen.queryByText('You train at home.')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Why this plan'));
    expect(screen.getByText('You are new to lifting.')).toBeTruthy();
    expect(screen.getByText('You train at home.')).toBeTruthy();
    expect(seen).toEqual(['plan_card_opened']);
  });

  it('is pinned from the store only when a program exists', async () => {
    await hydrateTutorial('u1', 'Maya');
    const { rerender } = await render(<PlanExplanationCard />);
    expect(screen.queryByTestId('plan-explanation-card')).toBeNull();
    startClientTutorial(PAYLOAD);
    await rerender(<PlanExplanationCard />);
    expect(screen.getByTestId('plan-explanation-card')).toBeTruthy();
  });
});

describe('TutorialHomeSlot', () => {
  it('renders nothing with the flag off', async () => {
    mockFlags.clientTutorial = false;
    await render(<TutorialHomeSlot />);
    expect(screen.queryByTestId('tutorial-home-slot')).toBeNull();
  });

  it('opens the real coach thread from Message your coach', async () => {
    await hydrateTutorial('u1', 'Maya');
    startClientTutorial(PAYLOAD);
    await render(<TutorialHomeSlot />);
    await fireEvent.press(screen.getByLabelText('Message your coach, Bradley'));
    expect(mockNavigate).toHaveBeenCalledWith('Messages');
  });

  it('shows one quiet re-offer line after a skip, which resumes the tour', async () => {
    await hydrateTutorial('u1', 'Maya');
    startClientTutorial(PAYLOAD);
    const { rerender } = await render(<TutorialHomeSlot />);
    expect(screen.queryByTestId('tutorial-reoffer')).toBeNull();
    dispatchTutorial({ type: 'PAUSE' });
    await rerender(<TutorialHomeSlot />);
    await fireEvent.press(screen.getByTestId('tutorial-reoffer'));
    expect(useTutorialStore.getState().tutorial.status).toBe('active');
  });
});

describe('TutorialSettingsRow', () => {
  it('resumes a paused tour and restarts a finished one', async () => {
    await hydrateTutorial('u1', 'Maya');
    startClientTutorial(PAYLOAD);
    dispatchTutorial({ type: 'PAUSE' });
    const { rerender } = await render(<TutorialSettingsRow />);
    await fireEvent.press(screen.getByLabelText('Resume the tour'));
    expect(useTutorialStore.getState().tutorial.status).toBe('active');
    expect(mockParentNavigate).toHaveBeenCalledWith('Home', { screen: 'HomeMain' });

    useTutorialStore.setState({
      tutorial: { ...useTutorialStore.getState().tutorial, status: 'completed' },
    });
    await rerender(<TutorialSettingsRow />);
    await fireEvent.press(screen.getByLabelText('Take the tour again'));
    const t = useTutorialStore.getState().tutorial;
    expect(t.status).toBe('active');
    expect(t.stepIndex).toBe(0);
  });

  it('is disabled while the tour is running', async () => {
    await hydrateTutorial('u1', 'Maya');
    startClientTutorial(PAYLOAD);
    await render(<TutorialSettingsRow />);
    expect(screen.getByLabelText('The tour is in progress').props.accessibilityState).toMatchObject({
      disabled: true,
    });
  });
});
