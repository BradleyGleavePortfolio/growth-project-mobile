/**
 * FIX-927 (LO-927 B1): the plan screens start on the forest masthead, so the
 * phone's status-bar inset is forest too. PlanMasthead asks the app's
 * StatusBarBand for the masthead's ground while the screen is focused.
 */
import React from 'react';
import { render } from '@testing-library/react-native';

const mockBand = jest.fn();
jest.mock('@react-navigation/native', () => {
  const React = require('react');
  return { useFocusEffect: jest.fn(), NavigationContext: React.createContext({ isFocused: () => true }) };
});
jest.mock('../../../components/StatusBarBand', () => ({ useStatusBarBand: (c: string) => mockBand(c) }));

import { mast, PlanMasthead } from '../mealplan/planStyleC';
import { lightTokens } from '../../../theme/tokens';

it('PlanMasthead paints the status-bar inset in the forest band inside a navigator', async () => {
  await render(<PlanMasthead title="Fasting" />);
  expect(mast.ground).toBe(lightTokens.surface.forestBand);
  expect(mockBand).toHaveBeenCalledWith(lightTokens.surface.forestBand);
});
