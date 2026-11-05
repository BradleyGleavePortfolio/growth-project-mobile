/**
 * FR-916R2 F3 (own tests): a plain word (foodImages PLAIN_WORDS) is dropped only when the rest is still the
 * same food. "Chopped cheese" is a sandwich, and "Cheese, grilled" in the USDA order is grilled cheese: neither
 * shows the cheese photo. A plain word that keeps its food still shows that food's photo.
 */
import { getFoodImageUrl } from '../foodImages';

describe('FR-916R2 F3 plain words', () => {
  it.each(['Chopped cheese', 'Chopped Cheese Sandwich', 'Cheese, grilled', 'Grilled cheeses'])('%s does not show the cheese photo', (name) => {
    expect(getFoodImageUrl(name)).toBe('');
  });

  it.each([
    ['Sliced cheese', 'cheese'], ['Cheese, sliced', 'cheese'], ['Grilled chicken', 'chicken'], ['Chicken, grilled', 'chicken'],
    ['Baked salmon', 'salmon'], ['Roasted almonds', 'almond'], ['Chopped salad', 'salad'], ['Frozen pizza', 'pizza'],
  ])('a plain word that keeps its food: %s shows the %s photo', (name, food) => {
    expect(getFoodImageUrl(food)).not.toBe('');
    expect(getFoodImageUrl(name)).toBe(getFoodImageUrl(food));
  });
});
