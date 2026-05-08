/**
 * CoachWorkoutBuilderScreen — interaction test.
 *
 * Asserts that the screen renders the essential interactive elements:
 *   - An exercise search input (accessible via testID or accessibilityRole)
 *   - A "Save Plan" button
 *
 * All API calls are mocked so no network traffic is generated.
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

// ── Mock API modules ──────────────────────────────────────────────────────────

jest.mock('../../../services/exerciseLibraryApi', () => ({
  searchExercises: jest.fn().mockResolvedValue({
    items: [
      {
        id: '0001',
        name: 'barbell bench press',
        bodyPart: 'chest',
        equipment: 'barbell',
        target: 'pectorals',
        secondaryMuscles: [],
        instructions: [],
        gifUrl: '',
      },
    ],
    nextCursor: null,
    total: 1,
  }),
}));

jest.mock('../../../services/workoutBuilderApi', () => ({
  createWorkoutPlan: jest.fn().mockResolvedValue({
    id: 'plan-1',
    name: 'Push Day',
    type: 'strength',
    duration_estimate_minutes: 45,
    coach_id: 'coach-1',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    archived_at: null,
    exercises: [],
  }),
  setExerciseRows: jest.fn().mockResolvedValue([]),
  assignWorkoutPlan: jest.fn().mockResolvedValue({}),
}));

// ── Import the component under test ──────────────────────────────────────────

import CoachWorkoutBuilderScreen from '../CoachWorkoutBuilderScreen';

// ─────────────────────────────────────────────────────────────────────────────

describe('CoachWorkoutBuilderScreen', () => {
  it('renders the plan name input and Save Plan button', () => {
    const { getByTestId, getByText } = render(<CoachWorkoutBuilderScreen />);

    // The plan name text input should be present
    const nameInput = getByTestId('plan-name-input');
    expect(nameInput).toBeTruthy();

    // The Save Plan button should be present and labelled correctly
    const saveButton = getByText('Save Plan');
    expect(saveButton).toBeTruthy();
  });

  it('opens the exercise search drawer when Add is tapped', () => {
    const { getByText, getByTestId } = render(<CoachWorkoutBuilderScreen />);

    // Tap the Add button to reveal the search drawer
    fireEvent.press(getByText('+ Add'));

    // The search input should appear inside the drawer
    const searchInput = getByTestId('exercise-search-input');
    expect(searchInput).toBeTruthy();
  });

  it('renders all three workout type chips', () => {
    const { getByText } = render(<CoachWorkoutBuilderScreen />);

    expect(getByText('Strength')).toBeTruthy();
    expect(getByText('Cardio')).toBeTruthy();
    expect(getByText('Mobility')).toBeTruthy();
  });

  it('has correct accessibility labels on primary interactive elements', () => {
    const { getByLabelText } = render(<CoachWorkoutBuilderScreen />);

    expect(getByLabelText('Plan name input')).toBeTruthy();
    expect(getByLabelText('Save workout plan')).toBeTruthy();
    expect(getByLabelText('Open exercise search')).toBeTruthy();
  });
});
