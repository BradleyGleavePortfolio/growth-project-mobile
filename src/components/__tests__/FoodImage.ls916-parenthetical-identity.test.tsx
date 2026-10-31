import React from 'react';
import { render } from '@testing-library/react-native';
import FoodImage from '../FoodImage';
import { getFoodImageUrl } from '../../utils/foodImages';

describe('LS-916 B1 parenthetical food identity', () => {
  it.each([
    'Pineapple (juice)',
    'Banana (chips)',
    'Egg (Benedict)',
    'Rice (pudding)',
    'Chicken (nuggets)',
  ])('does not silently discard the food-defining words in %s', async (name) => {
    const view = await render(<FoodImage name={name} />);
    expect(JSON.stringify(view.toJSON())).not.toContain('images.unsplash.com');
    expect(getFoodImageUrl(name)).toBe('');
  });

  it('still allows an explicitly plain parenthetical descriptor', () => {
    expect(getFoodImageUrl('Pineapple (raw)')).toBe(getFoodImageUrl('Pineapple'));
    expect(getFoodImageUrl('Pineapple (raw)')).not.toBe('');
  });
});
