/**
 * FOOD-1-M R1 (operator ruling): a food shows a photo only when the photo is of that food (from the
 * food's own data, or an exact match in the phone's photo map); otherwise the plain placeholder.
 * Photo choosers: FoodSearchView rows (the food's own image_url, else FoodImage), QuantityPickerModal and
 * the coach MealPickerScreen (FoodImage). FoodImage asks getFoodImageUrl.
 */
import React from 'react';
import * as fs from 'fs';
import * as path from 'path';
import { render } from '@testing-library/react-native';
import FoodImage from '../../components/FoodImage';
import { getFoodImageUrl } from '../foodImages';

const photoOf = (name: string) => getFoodImageUrl(name.replace(/_/g, ' '));

describe('FOOD-1-M R1 food photos', () => {
  it('a name whose words are a photo key, or that key with plain words around it, gets that photo', () => {
    const cases: Array<[string, string]> = [
      ['Pineapple, raw', 'pineapple'], ['Grapefruit, raw', 'grapefruit'], ['Grapes, raw', 'grape'],
      ['Large eggs', 'egg'], ['Blueberries', 'blueberry'], ['Strawberries, fresh', 'strawberry'],
      ['Hamburger', 'hamburger'], ['Bell pepper, chopped', 'bell_pepper'], ['Apple, raw', 'apple'],
    ];
    expect(cases.filter(([name, key]) => !getFoodImageUrl(name) || getFoodImageUrl(name) !== photoOf(key))).toEqual([]);
  });

  it('no nearest-word guess: a name that is not a photo key gets no photo', () => {
    const names = [
      'Eggplant, raw', 'Ham, sliced', 'Banana chips', 'Egg, Benedict', 'Apple pie', 'Ground turkey',
      'Ketchup', 'Peanut butter, smooth', 'Chicken breast, roasted', 'Greek yogurt, plain', 'Tofu, firm',
      'Brussels sprouts', 'Mushrooms, white', 'Beef jerky', 'Duck, roasted', 'Coconut water',
    ];
    expect(names.filter((name) => getFoodImageUrl(name) !== '')).toEqual([]);
  });

  it('the photo map keeps no photo for a food it does not show (only same-food names share one)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'foodImages.ts'), 'utf8');
    const map = src.slice(src.indexOf('const FOOD_PHOTOS'), src.indexOf('};', src.indexOf('const FOOD_PHOTOS')));
    const byPhoto = new Map<string, string[]>();
    for (const [, key, url] of map.matchAll(/^\s+([a-z_]+): '([^']+)'/gm)) {
      byPhoto.set(url, [...(byPhoto.get(url) ?? []), key]);
    }
    const shared = [...byPhoto.values()].filter((keys) => keys.length > 1).map((keys) => keys.join(' '));
    expect(shared.sort()).toEqual([
      'blueberry berry', 'burger hamburger', 'coffee latte', 'milk whole_milk skim_milk', 'white_rice jasmine_rice',
    ]);
  });

  it('a food with no photo of its own draws the plain letter placeholder, not a photo', async () => {
    const view = await render(<FoodImage name="Eggplant, raw" />);
    const tree = JSON.stringify(view.toJSON());
    expect(tree).not.toContain('unsplash');
    expect(tree).toContain('"E"');
  });
});
