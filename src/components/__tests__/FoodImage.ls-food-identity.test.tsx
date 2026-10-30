import React from 'react';
import { Image } from 'react-native';
import { render } from '@testing-library/react-native';
import FoodImage from '../FoodImage';

describe('LS-FOOD B2: a food photo depicts that food, not a substring', () => {
  it('renders the pineapple asset for Pineapple, raw, not a photo of apples', async () => {
    const view = await render(<FoodImage name="Pineapple, raw" />);
    const image = view.UNSAFE_getByType(Image);
    expect(image.props.source.uri).toBe('https://images.unsplash.com/photo-1550258987-190a2d41a8ba?w=100&h=100&fit=crop');
  });

  it('does not render eggs for Eggplant', async () => {
    const view = await render(<FoodImage name="Eggplant" />);
    expect(view.UNSAFE_getByType(Image).props.source.uri)
      .not.toBe('https://images.unsplash.com/photo-1482049016688-2d3e1b311543?w=100&h=100&fit=crop');
  });
});
