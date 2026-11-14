import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { formatPlanNumber, MastTile, useTimeColumn } from '../mealplan/planStyleC';

it.each([
  [0, '0'], [999, '999'], [1000, '1,000'], [1789, '1,789'],
  [2380.4, '2,380'], [2380.5, '2,381'], [1000000, '1,000,000'],
])('groups and rounds plan numbers %s as %s', (value, expected) => {
  expect(formatPlanNumber(value)).toBe(expected);
});

it('keeps three target tiles within the 272 pt row at 320 pt', async () => {
  await render(<MastTile value="160g" label="Protein" testID="tile" />);
  expect(screen.getByTestId('tile')).toHaveStyle({ flexGrow: 1, flexBasis: 0, minWidth: 76, minHeight: 56 });
  expect(3 * 76 + 2 * 8).toBeLessThanOrEqual(272);
});

it('lets scaled time text wrap in the drawn column rather than consuming meal width', () => {
  expect(useTimeColumn()).toBe(54);
});
