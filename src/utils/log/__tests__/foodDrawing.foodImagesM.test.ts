/**
 * FOOD-IMAGES-M (owner #191-E3 "every single food should be searchable and have images"; how: #191-D2 op 1, #192-E6
 * "#191-D2 -> OP 1 for v1"): each add sheet row shows the food's own photo, else the stock photo, else the line drawing
 * for its food group (one of the five picked C2 Style C drawings: base.py:198-209 plate_svg), else the bowl.
 * Cases a-e of the job text. The new module is loaded lazily (jest.requireActual) so this file type-checks and runs at
 * the base commit, where cases a-d are red (no group read, no drawingFor) and case e is green (nothing a save sends
 * changes). Names and categories of case c are copied from growth-project-backend prisma/data/seed-foods.json @
 * 31b489c5cbd1e0304e0275187e8f144b8af81d07; the tags the server stores for them are scripts/seed-built-in-foods.ts:56
 * at that sha ([...food.tags, `category:${food.food_category}`, 'seed:common-foods']).
 */
import { mapFoodItem, mapLogEntryToFood } from '../mapFoodItem';
import { buildFoodPayload } from '../logSubmit';
import { densityGramsFor } from '../macros';

// The module this job adds (src/utils/log/foodDrawing.ts); absent at the base, so every case that needs it is red there.
const lib = (): any => jest.requireActual('../foodDrawing');
const drawingFor = (name: string, group?: string): string => lib().drawingFor(name, group);
const foodGroupOf = (item: object): string | undefined => lib().foodGroupOf(item);
// The mapper's input with the fields the server sends (food.service.ts toResult :1279-1313 at 31b489c5): tags and category.
const mapRaw = (raw: object): any => mapFoodItem(raw as any);
const groupOf = (mapped: object): unknown => Reflect.get(mapped, 'food_group');

const MACROS = { calories: 100, protein_g: 1, carbs_g: 1, fat_g: 1, serving_description: '100 g', serving_size_grams: 100 };

describe('a. the 25 USDA groups (usda-foods.jsonl.gz usda_category) each give their default drawing (R4)', () => {
  // R4: "glass: Beverages. bowl: Fruits ... Soups, Sauces, and Gravies. jar: Dairy ... Baby Foods. plate: Beef ... American
  // Indian/Alaska Native Foods." A name with no moving word reads the group's own drawing.
  it.each([
    ['Beverages', 'glass'],
    ['Fruits and Fruit Juices', 'bowl'], ['Vegetables and Vegetable Products', 'bowl'], ['Legumes and Legume Products', 'bowl'],
    ['Nut and Seed Products', 'bowl'], ['Cereal Grains and Pasta', 'bowl'], ['Breakfast Cereals', 'bowl'],
    ['Soups, Sauces, and Gravies', 'bowl'],
    ['Dairy and Egg Products', 'jar'], ['Fats and Oils', 'jar'], ['Spices and Herbs', 'jar'], ['Sweets', 'jar'], ['Baby Foods', 'jar'],
    ['Beef Products', 'plate'], ['Pork Products', 'plate'], ['Poultry Products', 'plate'], ['Lamb, Veal, and Game Products', 'plate'],
    ['Finfish and Shellfish Products', 'plate'], ['Sausages and Luncheon Meats', 'plate'], ['Baked Products', 'plate'],
    ['Snacks', 'plate'], ['Fast Foods', 'plate'], ['Restaurant Foods', 'plate'], ['Meals, Entrees, and Side Dishes', 'plate'],
    ['American Indian/Alaska Native Foods', 'plate'],
  ])('%s -> %s', (group, kind) => {
    expect(drawingFor('Sample food, plain', group)).toBe(kind);
  });
});

describe('b. the food\'s own words move it only inside its group, never give it one (R4)', () => {
  // R4: "Its own words are the part of the name before the first comma, except that a leading "Beverages," or "Alcoholic
  // beverage(s)," is skipped ... Whole words, case-insensitive, words in parentheses read as after a comma".
  it.each([
    ['Beverages, coffee, brewed, prepared with tap water', 'Beverages', 'cup'],
    ['Flat white', 'Beverages', 'cup'],
    ['Beverages, tea, black, brewed, prepared with tap water', 'Beverages', 'cup'],
    ['Alcoholic beverage, wine, table, red', 'Beverages', 'glass'],
    ['Almond milk, unsweetened', 'Beverages', 'glass'],
    ['Cranberry juice, unsweetened', 'Fruits and Fruit Juices', 'glass'],
    ['Tomato juice, canned, with salt added', 'Vegetables and Vegetable Products', 'glass'],
    ['Milk, 2% fat', 'Dairy and Egg Products', 'glass'],
    ['Eggnog', 'Dairy and Egg Products', 'glass'],
    ['Soymilk, original and vanilla, unfortified', 'Legumes and Legume Products', 'glass'],
    ['Egg, whole, raw', 'Dairy and Egg Products', 'plate'],
    ['Cheddar cheese', 'Dairy and Egg Products', 'plate'],
    ['Peanut butter, smooth', 'Legumes and Legume Products', 'jar'],
    ['Sauce, barbecue', 'Soups, Sauces, and Gravies', 'jar'],
    ['Gravy, turkey, canned, ready-to-serve', 'Soups, Sauces, and Gravies', 'jar'],
    ['Ice cream sandwich', 'Dairy and Egg Products', 'bowl'],
  ])('%s (%s) -> %s', (name, group, kind) => {
    expect(drawingFor(name, group)).toBe(kind);
  });

  // The PLAN's named changes to the planner's table, each a row a client would read as wrong as written (sweep: 39 rows).
  it.each([
    // "Nuts," and "Seeds," are USDA's group words before the food, as "Beverages," is: skipped the same way (14 rows).
    ['Nuts, almond butter, plain, with salt added', 'Nut and Seed Products', 'jar'],
    ['Seeds, sesame butter, tahini, type of kernels unspecified', 'Nut and Seed Products', 'jar'],
    ['Nuts, coconut milk, canned (liquid expressed from grated meat and water)', 'Nut and Seed Products', 'glass'],
    // A brand written in capitals before the food is skipped too (18 soymilks were bowls).
    ['SILK Chocolate, soymilk', 'Legumes and Legume Products', 'glass'],
    ['Vitasoy USA, Vitasoy Organic Creamy Original Soymilk', 'Legumes and Legume Products', 'glass'],
    // ...but a name written all in capitals (USDA's Branded foods, live hits) has no brand head: its first part is the food.
    ['MILK, WHOLE', 'Dairy and Egg Products', 'glass'],
    ['PEANUT BUTTER, CREAMY', 'Legumes and Legume Products', 'jar'],
    ['MILK, WHOLE', 'Milk', 'glass'],
    // A cheese spread or sauce is a jar, not a plate (6 rows); the frozen milk bar joins the ice cream bars (1 row).
    ['Cheese spread, pasteurized process, American', 'Dairy and Egg Products', 'jar'],
    ['Cheese sauce, prepared from recipe', 'Dairy and Egg Products', 'jar'],
    ['KRAFT CHEEZ WHIZ Pasteurized Process Cheese Sauce', 'Dairy and Egg Products', 'jar'],
    ['Milk dessert bar, frozen, made from lowfat milk', 'Dairy and Egg Products', 'bowl'],
    // R4's pick: "Beverage, instant breakfast powder" is a glass by the rule as written (singular "Beverage," is not skipped).
    ['Beverage, instant breakfast powder, chocolate, not reconstituted', 'Dairy and Egg Products', 'glass'],
  ])('named change: %s (%s) -> %s', (name, group, kind) => {
    expect(drawingFor(name, group)).toBe(kind);
  });

  it.each([
    // The drink word sits after the comma: not the food's own words.
    ['Greek yogurt, plain, whole milk', 'Dairy and Egg Products', 'jar'],
    ['Yogurt, plain, whole milk', 'Dairy and Egg Products', 'jar'],
    ['Apricots, canned, juice pack, with skin, solids and liquids', 'Fruits and Fruit Juices', 'bowl'],
    ['Cherries, sour, canned, water pack, drained', 'Fruits and Fruit Juices', 'bowl'],
    ['Water convolvulus, cooked, boiled, drained, without salt', 'Vegetables and Vegetable Products', 'bowl'],
    ['Soup, chicken noodle, canned, condensed', 'Soups, Sauces, and Gravies', 'bowl'],
    // Words in parentheses read as after a comma.
    ['Orange juice, raw (Includes foods for USDA\'s Food Distribution Program)', 'Fruits and Fruit Juices', 'glass'],
    ['Peanuts, all types, raw (peanut butter style)', 'Legumes and Legume Products', 'bowl'],
    // Whole words only: "butternuts" is not "butter"; "Dessert topping" is not a "dessert bar".
    ['Nuts, butternuts, dried', 'Nut and Seed Products', 'bowl'],
    ['Dessert topping, powdered', 'Dairy and Egg Products', 'jar'],
    // A move belongs to its group: a drink word moves nothing in Beef, a hot drink word nothing in Sweets.
    ['Beef, milk-fed veal style', 'Beef Products', 'plate'],
    ['Coffee cake, cream cheese', 'Baked Products', 'plate'],
    ['Candies, mocha', 'Sweets', 'jar'],
  ])('negative: %s (%s) -> %s', (name, group, kind) => {
    expect(drawingFor(name, group)).toBe(kind);
  });

  it.each([[undefined], [''], ['   ']])('no group (%p): a name word never gives one; the bowl, as at main', (group) => {
    for (const name of ['Beverages, coffee, brewed', 'Milk, 2% fat', 'Peanut butter, smooth', 'Chicken breast, roasted', '']) {
      expect(drawingFor(name, group)).toBe('bowl');
    }
  });
});

describe('b. any other group string: the keyword pass over the group text, first match wins (R4)', () => {
  // R4: "Any other non-empty group string (FNDDS, Branded, a future one): a keyword pass over the group text, whole words,
  // first match wins". Strings from growth-project-backend test and spec files @ 31b489c5 (PLAN question 5); a plural reads
  // as its word, and the PLAN's added words and order are named there.
  it.each([
    ['Beverages, coffee', 'Coffee', 'cup'],
    ['Tea, green, iced', 'Tea', 'cup'],
    ['Apple juice, 100%', 'Apple juice', 'glass'],
    ['Fruit punch', 'Fruit drinks', 'glass'],
    ['Light beer', 'Beer', 'glass'],
    ['Margarita', 'Liquor and cocktails', 'glass'],
    ['Milk, whole', 'Milk', 'glass'],
    ['Almond milk, unsweetened', 'Plant-based milk', 'glass'],
    ['Greek yogurt, plain', 'Yogurt, Greek', 'jar'],
    ['Ice cream, vanilla', 'Ice cream and frozen dairy desserts', 'bowl'],
    ['Cheese, cheddar', 'Cheese', 'plate'],
    ['Peanut butter and jelly sandwich', 'Peanut butter and jelly sandwiches', 'plate'],
    ['Italian dressing', 'Salad dressings and vegetable oils', 'jar'],
    ['Salsa', 'Dips, gravies, other sauces', 'jar'],
    ['Strawberries, raw', 'Other fruits and fruit salads', 'bowl'],
    ['Fried rice', 'Rice mixed dishes', 'bowl'],
    ['Chicken noodle soup', 'Soups, broth-based', 'bowl'],
    ['Honey', 'Honey', 'jar'],
    ['Gummy bears', 'Candy', 'jar'],
    ['Pork sausage', 'Sausages', 'plate'],
    ['Salami', 'Pepperoni, Salami & Cold Cuts', 'plate'],
    ['Pancakes, plain', 'Pancakes, waffles, French toast', 'plate'],
    ['Apple pie', 'Cakes and pies', 'plate'],
    ['Cookie, chocolate chip', 'Cookies and brownies', 'plate'],
    ['Scrambled eggs', 'Eggs and omelets', 'plate'],
    ['Chili con carne', 'Chili & Stew', 'bowl'],
    ['A made-up item', 'Not included in a food category', 'bowl'],
  ])('%s (%s) -> %s', (name, group, kind) => {
    expect(drawingFor(name, group)).toBe(kind);
  });
});

describe('c. the 65 built-in foods: each gets exactly one drawing, the expected one (R4 over the stored row, R3)', () => {
  // Each row as scripts/seed-built-in-foods.ts:40-57 stores it: category 'generic', tags [...food tags, category:<group>,
  // seed:common-foods]; read back whole by toResult (food.service.ts:1304) and through the phone's mapper.
  const SEED: Array<[string, string, string[], string]> = [
  ['Chicken breast, raw, skinless', 'Poultry Products', ['protein', 'high-protein', 'lean'], 'plate'],
  ['Chicken breast, cooked, roasted', 'Poultry Products', ['protein', 'high-protein', 'lean', 'cooked'], 'plate'],
  ['Chicken thigh, cooked, roasted', 'Poultry Products', ['protein', 'cooked'], 'plate'],
  ['Ground beef, 80/20, raw', 'Beef Products', ['protein'], 'plate'],
  ['Ground beef, 90/10, raw', 'Beef Products', ['protein', 'lean'], 'plate'],
  ['Salmon, Atlantic, cooked', 'Finfish and Shellfish Products', ['protein', 'omega-3', 'fish'], 'plate'],
  ['Tuna, canned in water, drained', 'Finfish and Shellfish Products', ['protein', 'lean', 'fish', 'canned'], 'plate'],
  ['Egg, whole, raw', 'Dairy and Egg Products', ['protein'], 'plate'],
  ['Egg white, raw', 'Dairy and Egg Products', ['protein', 'lean'], 'plate'],
  ['Greek yogurt, plain, nonfat', 'Dairy and Egg Products', ['protein', 'dairy'], 'jar'],
  ['Greek yogurt, plain, whole milk', 'Dairy and Egg Products', ['protein', 'dairy'], 'jar'],
  ['Yogurt, plain, whole milk', 'Dairy and Egg Products', ['dairy'], 'jar'],
  ['Milk, whole, 3.25% fat', 'Dairy and Egg Products', ['dairy'], 'glass'],
  ['Milk, 2% fat', 'Dairy and Egg Products', ['dairy'], 'glass'],
  ['Milk, skim, nonfat', 'Dairy and Egg Products', ['dairy', 'lean'], 'glass'],
  ['Almond milk, unsweetened', 'Beverages', ['plant-based'], 'glass'],
  ['Cheddar cheese', 'Dairy and Egg Products', ['dairy', 'cheese'], 'plate'],
  ['Mozzarella cheese, part-skim', 'Dairy and Egg Products', ['dairy', 'cheese'], 'plate'],
  ['Cottage cheese, lowfat 2%', 'Dairy and Egg Products', ['dairy', 'protein'], 'plate'],
  ['Butter, salted', 'Fats and Oils', ['fat'], 'jar'],
  ['Olive oil, extra virgin', 'Fats and Oils', ['fat', 'oil'], 'jar'],
  ['Coconut oil', 'Fats and Oils', ['fat', 'oil'], 'jar'],
  ['Avocado, raw', 'Fruits and Fruit Juices', ['fat', 'fiber'], 'bowl'],
  ['Banana, raw', 'Fruits and Fruit Juices', ['fruit', 'carbs'], 'bowl'],
  ['Apple, raw, with skin', 'Fruits and Fruit Juices', ['fruit', 'fiber'], 'bowl'],
  ['Strawberries, raw', 'Fruits and Fruit Juices', ['fruit', 'berry'], 'bowl'],
  ['Blueberries, raw', 'Fruits and Fruit Juices', ['fruit', 'berry'], 'bowl'],
  ['Orange, raw', 'Fruits and Fruit Juices', ['fruit'], 'bowl'],
  ['Grapes, raw', 'Fruits and Fruit Juices', ['fruit'], 'bowl'],
  ['Broccoli, raw', 'Vegetables and Vegetable Products', ['vegetable', 'fiber'], 'bowl'],
  ['Spinach, raw', 'Vegetables and Vegetable Products', ['vegetable', 'greens'], 'bowl'],
  ['Carrots, raw', 'Vegetables and Vegetable Products', ['vegetable', 'fiber'], 'bowl'],
  ['Sweet potato, raw', 'Vegetables and Vegetable Products', ['vegetable', 'carbs'], 'bowl'],
  ['Potato, white, raw', 'Vegetables and Vegetable Products', ['vegetable', 'carbs'], 'bowl'],
  ['Tomato, raw', 'Vegetables and Vegetable Products', ['vegetable'], 'bowl'],
  ['Onion, raw', 'Vegetables and Vegetable Products', ['vegetable'], 'bowl'],
  ['Bell pepper, red, raw', 'Vegetables and Vegetable Products', ['vegetable'], 'bowl'],
  ['Oats, rolled, dry', 'Cereal Grains and Pasta', ['carbs', 'fiber', 'whole-grain'], 'bowl'],
  ['Rice, white, long-grain, cooked', 'Cereal Grains and Pasta', ['carbs', 'cooked'], 'bowl'],
  ['Rice, brown, long-grain, cooked', 'Cereal Grains and Pasta', ['carbs', 'whole-grain', 'cooked'], 'bowl'],
  ['Quinoa, cooked', 'Cereal Grains and Pasta', ['carbs', 'protein', 'whole-grain'], 'bowl'],
  ['Pasta, cooked, plain', 'Cereal Grains and Pasta', ['carbs', 'cooked'], 'bowl'],
  ['Pasta, dry', 'Cereal Grains and Pasta', ['carbs', 'dry'], 'bowl'],
  ['Bread, white', 'Baked Products', ['carbs', 'bread'], 'plate'],
  ['Bread, whole wheat', 'Baked Products', ['carbs', 'bread', 'whole-grain'], 'plate'],
  ['Almonds, raw', 'Nut and Seed Products', ['fat', 'protein', 'nuts'], 'bowl'],
  ['Peanut butter, smooth', 'Legumes and Legume Products', ['fat', 'protein'], 'jar'],
  ['Walnuts, raw', 'Nut and Seed Products', ['fat', 'nuts', 'omega-3'], 'bowl'],
  ['Black beans, cooked', 'Legumes and Legume Products', ['protein', 'fiber', 'legumes'], 'bowl'],
  ['Lentils, cooked', 'Legumes and Legume Products', ['protein', 'fiber', 'legumes'], 'bowl'],
  ['Chickpeas, cooked', 'Legumes and Legume Products', ['protein', 'fiber', 'legumes'], 'bowl'],
  ['Tofu, firm', 'Legumes and Legume Products', ['protein', 'plant-based'], 'bowl'],
  ['Sugar, granulated, white', 'Sweets', ['sweet'], 'jar'],
  ['Honey', 'Sweets', ['sweet'], 'jar'],
  ['Maple syrup, pure', 'Sweets', ['sweet'], 'jar'],
  ['All-purpose flour, white', 'Cereal Grains and Pasta', ['carbs', 'flour'], 'bowl'],
  ['Whey protein powder', 'Dairy and Egg Products', ['protein', 'supplement'], 'jar'],
  ['Pork tenderloin, cooked', 'Pork Products', ['protein', 'lean', 'cooked'], 'plate'],
  ['Bacon, pan-fried', 'Pork Products', ['protein', 'fat'], 'plate'],
  ['Shrimp, cooked', 'Finfish and Shellfish Products', ['protein', 'lean', 'seafood'], 'plate'],
  ['Cucumber, raw', 'Vegetables and Vegetable Products', ['vegetable'], 'bowl'],
  ['Lettuce, romaine, raw', 'Vegetables and Vegetable Products', ['vegetable', 'greens'], 'bowl'],
  ['Mushrooms, white, raw', 'Vegetables and Vegetable Products', ['vegetable'], 'bowl'],
  ['Hummus, plain', 'Legumes and Legume Products', ['fiber', 'plant-based'], 'bowl'],
  ['Dark chocolate, 70-85% cacao', 'Sweets', ['sweet', 'chocolate'], 'jar'],
  ];

  it('holds all 65 rows of seed-foods.json', () => {
    expect(SEED).toHaveLength(65);
    expect(new Set(SEED.map(([name]) => name)).size).toBe(65);
  });

  it.each(SEED)('%s (%s) -> %s', (name, group, tags, kind) => {
    const mapped = mapRaw({ id: `seed-${name}`, name, category: 'generic', tags: [...tags, `category:${group}`, 'seed:common-foods'], ...MACROS });
    expect(groupOf(mapped)).toBe(group);
    expect(drawingFor(mapped.name, mapped.food_group)).toBe(kind);
    expect(['cup', 'glass', 'bowl', 'jar', 'plate']).toContain(kind);
  });
});

describe('d. the group read (R3): the first category: tag, else a live category that is not a row type', () => {
  const FRUIT_SEED = { id: 'f1', name: 'Banana, raw', category: 'generic', tags: ['protein', 'category:Fruits and Fruit Juices', 'seed:common-foods'], ...MACROS };
  const USDA_STORED = { id: 'u1', name: 'Milk, 2% fat', category: 'generic', tags: ['usda:746778', 'category:Dairy and Egg Products', 'basic-food'], ...MACROS };
  const USDA_LIVE = { id: 'usda-171890', name: 'Beverages, coffee, brewed', category: 'Beverages', tags: [], ...MACROS };
  const FNDDS_LIVE = { id: 'usda-2341', name: 'Pork sausage', category: 'Sausages', tags: [], ...MACROS };
  const OFF_STORED = { id: 'o1', name: 'Oat crunch bar', category: 'generic', tags: ['off:3017620422003'], image_url: 'https://images.example.test/oat.jpg', ...MACROS };
  const OFF_LIVE = { id: 'off-3017620422003', name: 'Oat crunch bar', category: 'generic', tags: [], ...MACROS };
  const CUSTOM = { id: 'c1', name: 'My protein shake', category: 'generic', ...MACROS };

  it('a built-in food stored as generic reads its category: tag (H1)', () => {
    expect(groupOf(mapRaw(FRUIT_SEED))).toBe('Fruits and Fruit Juices');
    expect(foodGroupOf(FRUIT_SEED)).toBe('Fruits and Fruit Juices');
  });
  it('a loaded USDA row (usda:, category:, basic-food) reads its group', () => {
    expect(groupOf(mapRaw(USDA_STORED))).toBe('Dairy and Egg Products');
  });
  it('a live USDA hit (tags [], category = USDA foodCategory, food.service.ts:886-893) reads its category', () => {
    expect(groupOf(mapRaw(USDA_LIVE))).toBe('Beverages');
    expect(groupOf(mapRaw(FNDDS_LIVE))).toBe('Sausages');
  });
  it('the first category: tag wins over the column, and over a later tag', () => {
    expect(foodGroupOf({ category: 'Beverages', tags: ['x', 'category:Sweets', 'category:Beverages'] })).toBe('Sweets');
  });
  it.each([
    ['an Open Food Facts row stored', OFF_STORED],
    ['an Open Food Facts row live', OFF_LIVE],
    ['a custom food', CUSTOM],
    ['tags null', { ...CUSTOM, tags: null }],
    ['an empty category: tag', { ...CUSTOM, tags: ['category:'] }],
    ...(['generic', 'packaged', 'fast_food', 'restaurant', 'recipe_ingredient'].map((category) => [`row type ${category}`, { ...CUSTOM, category }] as [string, object])),
  ])('%s: no group, and no food_group key (green at both)', (_label, raw) => {
    const mapped = mapRaw(raw);
    expect(Object.prototype.hasOwnProperty.call(mapped, 'food_group')).toBe(false);
  });
  it('mapLogEntryToFood carries the group from the entry\'s food_item tags (Recent, Frequent)', () => {
    const mapped: any = mapLogEntryToFood({ food_item: FRUIT_SEED, food_name: 'Banana, raw' } as any);
    expect(groupOf(mapped)).toBe('Fruits and Fruit Juices');
    const live: any = mapLogEntryToFood({ foodItem: USDA_LIVE } as any);
    expect(groupOf(live)).toBe('Beverages');
  });
  it('mapLogEntryToFood with no food_item, or one with no group: no food_group key (green at both)', () => {
    const bare: any = mapLogEntryToFood({ food_name: 'Toast', calories: 80 });
    expect(Object.prototype.hasOwnProperty.call(bare, 'food_group')).toBe(false);
    const off: any = mapLogEntryToFood({ food_item: OFF_STORED } as any);
    expect(Object.prototype.hasOwnProperty.call(off, 'food_group')).toBe(false);
  });
  it('only foodGroupOf reads tags: the mapped row carries no tags field (green at both)', () => {
    expect(Object.prototype.hasOwnProperty.call(mapRaw(FRUIT_SEED), 'tags')).toBe(false);
  });

  // e. Negatives, green at both: food_category, the save payload and the density read are what main computes.
  describe('e. what a save sends does not change (H6)', () => {
    const FIXTURES = [FRUIT_SEED, USDA_STORED, USDA_LIVE, FNDDS_LIVE, OFF_STORED, OFF_LIVE, CUSTOM];
    it.each(FIXTURES.map((f) => [f.name, f]))('%s: food_category is main\'s item.food_category ?? item.category (mapFoodItem.ts:98)', (_n, raw: any) => {
      expect(mapRaw(raw).food_category).toBe(raw.food_category ?? raw.category);
      const logged: any = mapLogEntryToFood({ food_item: raw } as any);
      expect(logged.food_category).toBe(raw.food_category ?? raw.category);
    });
    it('buildFoodPayload (logSubmit.ts:68-89) for a row with tags and a group deep-equals main\'s', () => {
      expect(buildFoodPayload(mapRaw(USDA_LIVE))).toStrictEqual({
        name: 'Beverages, coffee, brewed', brand_or_restaurant: null, category: 'Beverages', serving_description: '100 g',
        serving_size_grams: 100, nutrient_basis: 'PER_100G', calories: 100, protein_g: 1, carbs_g: 1, fat_g: 1, tags: [], search_aliases: [],
      });
      expect(buildFoodPayload(mapRaw(FRUIT_SEED))).toStrictEqual({
        name: 'Banana, raw', brand_or_restaurant: null, category: 'generic', serving_description: '100 g', serving_size_grams: 100,
        nutrient_basis: 'PER_100G', calories: 100, protein_g: 1, carbs_g: 1, fat_g: 1, tags: [], search_aliases: [],
      });
    });
    it('densityGramsFor (macros.ts:54-66) is unchanged for a \'milk\' row', () => {
      const milk = mapRaw({ ...CUSTOM, name: 'Milk', category: 'milk' });
      expect(milk.food_category).toBe('milk');
      expect(densityGramsFor(milk, 'cup')).toBe(244);
      expect(densityGramsFor(mapRaw(USDA_STORED), 'cup')).toBeNull();
    });
  });
});
