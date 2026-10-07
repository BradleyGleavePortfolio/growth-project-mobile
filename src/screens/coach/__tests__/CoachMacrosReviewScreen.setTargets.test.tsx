/**
 * A coach opens a client's Macros and sets their daily targets. Before this
 * screen pointed at a "prescriber" that did not exist, so no coach could set
 * a client's calories or macros anywhere in the app.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

type Q = { data: unknown; isLoading: boolean; isError: boolean; refetch: jest.Mock };
const mockCurrent: Q = { data: null, isLoading: false, isError: false, refetch: jest.fn() };
const mockHistory: Q = { data: [], isLoading: false, isError: false, refetch: jest.fn() };
const mockMutate = jest.fn();
const mockCreate = { mutate: mockMutate, isPending: false };

jest.mock('../../../hooks/useMacros', () => ({
  useCurrentMacrosForClient: () => mockCurrent,
  useClientMacroHistory: () => mockHistory,
  useCreateMacroTarget: () => mockCreate,
}));

import CoachMacrosReviewScreen from '../CoachMacrosReviewScreen';

const route = { key: 'k', name: 'CoachMacrosReview' as const, params: { clientId: 'c1', clientName: 'Sam' } };
const renderScreen = () => render(<CoachMacrosReviewScreen route={route} />);

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrent.data = null;
  mockCurrent.isLoading = false;
  mockCurrent.isError = false;
  mockCreate.isPending = false;
});

describe('CoachMacrosReviewScreen set targets', () => {
  it('no longer points at a prescriber that does not exist', async () => {
    await renderScreen();
    expect(screen.queryByText(/prescriber/)).toBeNull();
    expect(screen.getByTestId('macros-no-target')).toBeTruthy();
    expect(screen.getByTestId('macros-set-form')).toBeTruthy();
  });

  it('saves typed targets for this client and confirms', async () => {
    mockMutate.mockImplementation((_vars, opts: { onSuccess: () => void }) => opts.onSuccess());
    await renderScreen();
    await fireEvent.changeText(screen.getByTestId('macros-input-calories'), '2100');
    await fireEvent.changeText(screen.getByTestId('macros-input-protein'), '170');
    await fireEvent.changeText(screen.getByTestId('macros-input-carbs'), '210');
    await fireEvent.changeText(screen.getByTestId('macros-input-fat'), '65');
    expect(screen.getByTestId('macros-implied-kcal').props.children).toBe('Protein, carbs and fat come to 2105 kcal.');
    await fireEvent.press(screen.getByTestId('macros-save'));
    expect(mockMutate).toHaveBeenCalledWith(
      { clientId: 'c1', input: { calories_kcal: 2100, protein_g: 170, carbs_g: 210, fats_g: 65 } },
      expect.any(Object),
    );
    expect(screen.getByTestId('macros-save-ok').props.children).toBe("Saved. These are now Sam's daily targets.");
  });

  it('stops an out-of-range value before it reaches the server', async () => {
    await renderScreen();
    await fireEvent.changeText(screen.getByTestId('macros-input-calories'), '500');
    await fireEvent.changeText(screen.getByTestId('macros-input-protein'), '170');
    await fireEvent.changeText(screen.getByTestId('macros-input-carbs'), '210');
    await fireEvent.changeText(screen.getByTestId('macros-input-fat'), '65');
    await fireEvent.press(screen.getByTestId('macros-save'));
    expect(mockMutate).not.toHaveBeenCalled();
    expect(screen.getByTestId('macros-save-error').props.children).toBe('Calories must be between 800 and 7000 kcal.');
  });

  it('prefills from the current target and shows a specific save failure', async () => {
    mockCurrent.data = {
      id: 't1', client_id: 'c1', coach_id: 'co', calories_kcal: 1900, protein_g: 150, carbs_g: 200,
      fats_g: 60, fiber_g: null, notes: null, effective_from: '2026-10-01T00:00:00Z', created_at: '', archived_at: null,
    };
    mockMutate.mockImplementation((_vars, opts: { onError: (e: unknown) => void }) =>
      opts.onError({ response: { status: 404 } }));
    await renderScreen();
    expect(screen.getByTestId('macros-input-calories').props.value).toBe('1900');
    await fireEvent.press(screen.getByTestId('macros-save'));
    expect(screen.getByTestId('macros-save-error').props.children).toMatch(/not on your roster/);
  });

  it('shows a load failure with Retry instead of claiming there is no target', async () => {
    mockCurrent.isError = true;
    await renderScreen();
    expect(screen.queryByTestId('macros-no-target')).toBeNull();
    expect(screen.queryByTestId('macros-set-form')).toBeNull();
    await fireEvent.press(screen.getByTestId('macros-current-retry'));
    expect(mockCurrent.refetch).toHaveBeenCalled();
  });
});
