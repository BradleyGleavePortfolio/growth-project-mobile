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

describe('FR-916 F2 parentheses and the brand photos', () => {
  it.each([
    ['Chicken (raw, skinless)', 'chicken'],
    ['Bananas (sliced)', 'banana'],
    ['Broccoli (frozen), boiled', 'broccoli'],
  ])('a plain word in parentheses keeps the plain food: %s', (name, plain) => {
    expect(getFoodImageUrl(name)).toBe(getFoodImageUrl(plain));
    expect(getFoodImageUrl(name)).not.toBe('');
  });

  it.each(['Rice (pudding), raw', 'Pineapple (juice), fresh'])('a food word in parentheses with plain words after: %s', (name) => {
    expect(getFoodImageUrl(name)).toBe('');
  });

  it.each(['Eggs', 'Large eggs', 'Milk', 'Whole milk', 'Skim milk', 'Soda'])('%s shows the letter tile, not a branded photo', (name) => {
    expect(getFoodImageUrl(name)).toBe('');
  });
});
