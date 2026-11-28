/**
 * LO-SAVED-MEAL-SAVE-M-1 B1 (B-TEST, red at ea32deda): the Name field must show the whole meal name. The job text's
 * rule for every state: "text never clipped or cut with numberOfLines at 320 pt or 130% (a long food name or meal name
 * wraps)". R5's default name runs to 80 characters ("Flat white, Chicken breast, Rice and 1 more" with four foods),
 * and a one-line TextInput cannot wrap: the renders on ctx#629 show it cut mid-word ("... Rice and 1 mo" at 390 pt and
 * 100%, "... Rice and Avoca" at 390 pt and 130%, "... Rice and" at 320 pt and 130%). The one field serves the save sheet
 * and the rename body, so both are held here. Return must still put the keyboard down and never add a line break.
 */
import React from 'react';
import { render, screen } from '@testing-library/react-native';

jest.mock('../../../../theme/ThemeProvider', () => {
  const sc = jest.requireActual('../../../../theme/tokens').lightTokens;
  return { useTheme: () => ({ semanticColors: sc, colors: { ...jest.requireActual('../../../../constants/colors').default } }) };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
// The meal photo module's picker is not on the import path of this field; a virtual stand-in lets the file load anywhere.
jest.mock('expo-image-picker', () => ({ UIImagePickerPreferredAssetRepresentationMode: { Compatible: 'compatible' } }), { virtual: true });
jest.mock('../../../../services/api', () => ({
  __esModule: true, default: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
  logApi: { getDaily: jest.fn() },
}));
jest.mock('../../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../../services/queryClient', () => ({ queryClient: { invalidateQueries: jest.fn() } }));
jest.mock('../../../../ui/haptics/haptics.service', () => ({
  HapticService: new Proxy({}, { get: () => jest.fn(async () => undefined) }),
}));

import { MealNameField } from '../SaveMealSheet';

const FOUR_FOODS = 'Flat white, Chicken breast, Rice and 1 more';

describe('LO-SAVED-MEAL-SAVE-M-1 B1: the Name field wraps a long name instead of cutting it', () => {
  it.each(['save-name', 'rename-name'])('%s: a 43-character default name can take more than one line', async (id) => {
    await render(<MealNameField value={FOUR_FOODS} onChange={() => undefined} testID={id} />);
    const field = screen.getByTestId(id);
    expect(field.props.value).toBe(FOUR_FOODS);
    // A one-line TextInput scrolls its text sideways and shows only the start: the name is cut where the field ends.
    expect(field.props.multiline).toBe(true);
    expect(field.props.numberOfLines === undefined || field.props.numberOfLines >= 2).toBe(true);
    // Return still puts the keyboard down and adds no line break (SS9): a multiline field must submit and blur.
    const blurs = field.props.blurOnSubmit === true || field.props.submitBehavior === 'blurAndSubmit';
    expect(blurs).toBe(true);
    expect(typeof field.props.onSubmitEditing).toBe('function');
  });
});
