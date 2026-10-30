import { getFoodImageUrl } from '../foodImages';

// LO-FOOD B4 (audit of mobile main 585616c8): getFoodImageUrl takes the first
// single-word key that is a substring of the food name, in file order. 'apple'
// (foodImages.ts:116) comes before 'pineapple' (:125), 'grape' (:123) before
// 'grapefruit' (:133), 'egg' (:37) before 'eggplant' (:173) and 'ham' (:50)
// before 'burger' (:280). So USDA's "Pineapple, raw" row shows the apple
// photo, and so on. The file's own rule: specific entries before generic ones.
const PHOTO_ID = (url: string) => url.split('/photo-')[1]?.split('?')[0];

describe('LO-FOOD B4 food photos', () => {
  it('pineapple, grapefruit, eggplant and hamburger each get their own photo, not apple, grape, egg or ham', () => {
    const pairs: Array<[string, string]> = [
      ['Pineapple, raw', 'Apple, raw'],
      ['Grapefruit, raw', 'Grapes, raw'],
      ['Eggplant, raw', 'Egg, whole, raw'],
      ['Hamburger', 'Ham, sliced'],
    ];
    const clashes = pairs
      .filter(([food, other]) => PHOTO_ID(getFoodImageUrl(food)) === PHOTO_ID(getFoodImageUrl(other)))
      .map(([food, other]) => `${food} shows the ${other} photo`);
    expect(clashes).toEqual([]);
  });
});
