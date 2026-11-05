/**
 * LO-916R2 B3 (m#916 @ a745f11a): FOOD-1-M R1 (operator ruling) says a food shows a photo only when the
 * photo is of that food. "Grilled cheese" (a sandwich) shows the map's cheese photo (blocks of cheese):
 * getFoodImageUrl drops "grilled" as a plain word (PLAIN_WORDS) and then matches "cheese".
 */
import { getFoodImageUrl } from '../foodImages';

describe('LO-916R2 B3 a plain word that makes a different food', () => {
  it.each(['Grilled cheese', 'Grilled Cheese', 'grilled cheese (2)'])('%s does not show the cheese photo', (name) => {
    expect(getFoodImageUrl(name)).not.toBe(getFoodImageUrl('cheese'));
  });
  it('control: grilled chicken is still chicken', () => {
    expect(getFoodImageUrl('Grilled chicken')).toBe(getFoodImageUrl('chicken'));
    expect(getFoodImageUrl('cheese')).not.toBe('');
  });
});
