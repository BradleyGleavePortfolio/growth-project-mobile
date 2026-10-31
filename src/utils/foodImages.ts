/**
 * Returns food photo URLs based on food name.
 * Uses Unsplash image CDN with curated photo IDs for common foods.
 */

// FOOD-1-M R1 (operator ruling): a food shows a photo only when the photo is of that food. Every photo
// here was looked at, one by one, on 10-30 and shows the food its key names; a key whose photo showed
// another food (a tiger for ground turkey, a honey jar for ketchup) or whose link was dead was taken
// out, so those foods show the plain placeholder. Keys are matched whole (see getFoodImageUrl).
const FOOD_PHOTOS: Record<string, string> = {
  // Meat, fish and eggs
  chicken: 'https://images.unsplash.com/photo-1598103442097-8b74394b95c6?w=100&h=100&fit=crop',
  turkey: 'https://images.unsplash.com/photo-1574672280600-4accfa5b6f98?w=100&h=100&fit=crop',
  beef: 'https://images.unsplash.com/photo-1588168333986-5078d3ae3976?w=100&h=100&fit=crop',
  pork: 'https://images.unsplash.com/photo-1432139555190-58524dae6a55?w=100&h=100&fit=crop',
  steak: 'https://images.unsplash.com/photo-1600891964092-4316c288032e?w=100&h=100&fit=crop',
  salmon: 'https://images.unsplash.com/photo-1467003909585-2f8a72700288?w=100&h=100&fit=crop',
  fish: 'https://images.unsplash.com/photo-1510130387422-82bed34b37e9?w=100&h=100&fit=crop',
  shrimp: 'https://images.unsplash.com/photo-1565680018434-b513d5e5fd47?w=100&h=100&fit=crop',
  egg: 'https://images.unsplash.com/photo-1482049016688-2d3e1b311543?w=100&h=100&fit=crop',
  // Grains, bread and cereal
  rice: 'https://images.unsplash.com/photo-1516684732162-798a0062be99?w=100&h=100&fit=crop',
  white_rice: 'https://images.unsplash.com/photo-1586201375761-83865001e31c?w=100&h=100&fit=crop',
  jasmine_rice: 'https://images.unsplash.com/photo-1586201375761-83865001e31c?w=100&h=100&fit=crop',
  fried_rice: 'https://images.unsplash.com/photo-1512058564366-18510be2db19?w=100&h=100&fit=crop',
  pasta: 'https://images.unsplash.com/photo-1621996346565-e3dbc646d9a9?w=100&h=100&fit=crop',
  bread: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=100&h=100&fit=crop',
  bagel: 'https://images.unsplash.com/photo-1585445490387-f47934b73b54?w=100&h=100&fit=crop',
  cereal: 'https://images.unsplash.com/photo-1521483451569-e33803c0330c?w=100&h=100&fit=crop',
  pancake: 'https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445?w=100&h=100&fit=crop',
  taco: 'https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=100&h=100&fit=crop',
  // Fruit
  apple: 'https://images.unsplash.com/photo-1560806887-1e4cd0b6cbd6?w=100&h=100&fit=crop',
  banana: 'https://images.unsplash.com/photo-1571771894821-ce9b6c11b08e?w=100&h=100&fit=crop',
  orange: 'https://images.unsplash.com/photo-1547514701-42782101795e?w=100&h=100&fit=crop',
  strawberry: 'https://images.unsplash.com/photo-1464965911861-746a04b4bca6?w=100&h=100&fit=crop',
  raspberry: 'https://images.unsplash.com/photo-1577069861033-55d04cec4ef5?w=100&h=100&fit=crop',
  blueberry: 'https://images.unsplash.com/photo-1498557850523-fd3d118b962e?w=100&h=100&fit=crop',
  berry: 'https://images.unsplash.com/photo-1498557850523-fd3d118b962e?w=100&h=100&fit=crop',
  grape: 'https://images.unsplash.com/photo-1537640538966-79f369143f8f?w=100&h=100&fit=crop',
  grapefruit: 'https://images.unsplash.com/photo-1577234286642-fc512a5f8f11?w=100&h=100&fit=crop',
  watermelon: 'https://images.unsplash.com/photo-1563114773-84221bd62daa?w=100&h=100&fit=crop',
  pineapple: 'https://images.unsplash.com/photo-1550258987-190a2d41a8ba?w=100&h=100&fit=crop',
  pear: 'https://images.unsplash.com/photo-1514756331096-242fdeb70d4a?w=100&h=100&fit=crop',
  kiwi: 'https://images.unsplash.com/photo-1585059895524-72359e06133a?w=100&h=100&fit=crop',
  cherry: 'https://images.unsplash.com/photo-1528821128474-27f963b062bf?w=100&h=100&fit=crop',
  mango: 'https://images.unsplash.com/photo-1553279768-865429fa0078?w=100&h=100&fit=crop',
  papaya: 'https://images.unsplash.com/photo-1517282009859-f000ec3b26fe?w=100&h=100&fit=crop',
  pomegranate: 'https://images.unsplash.com/photo-1541344999736-83eca272f6fc?w=100&h=100&fit=crop',
  lemon: 'https://images.unsplash.com/photo-1590502593747-42a996133562?w=100&h=100&fit=crop',
  avocado: 'https://images.unsplash.com/photo-1523049673857-eb18f1d7b578?w=100&h=100&fit=crop',
  // Vegetables
  broccoli: 'https://images.unsplash.com/photo-1615485290382-441e4d049cb5?w=100&h=100&fit=crop',
  spinach: 'https://images.unsplash.com/photo-1576045057995-568f588f82fb?w=100&h=100&fit=crop',
  asparagus: 'https://images.unsplash.com/photo-1515471209610-dae1c92d8777?w=100&h=100&fit=crop',
  bell_pepper: 'https://images.unsplash.com/photo-1563565375-f3fdfdbefa83?w=100&h=100&fit=crop',
  carrot: 'https://images.unsplash.com/photo-1447175008436-054170c2e979?w=100&h=100&fit=crop',
  corn: 'https://images.unsplash.com/photo-1551754655-cd27e38d2076?w=100&h=100&fit=crop',
  cucumber: 'https://images.unsplash.com/photo-1449300079323-02e209d9d3a6?w=100&h=100&fit=crop',
  onion: 'https://images.unsplash.com/photo-1518977956812-cd3dbadaaf31?w=100&h=100&fit=crop',
  salad: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=100&h=100&fit=crop',
  // Dairy
  milk: 'https://images.unsplash.com/photo-1563636619-e9143da7973b?w=100&h=100&fit=crop',
  whole_milk: 'https://images.unsplash.com/photo-1563636619-e9143da7973b?w=100&h=100&fit=crop',
  skim_milk: 'https://images.unsplash.com/photo-1563636619-e9143da7973b?w=100&h=100&fit=crop',
  cheese: 'https://images.unsplash.com/photo-1486297678162-eb2a19b0a32d?w=100&h=100&fit=crop',
  butter: 'https://images.unsplash.com/photo-1589985270826-4b7bb135bc9d?w=100&h=100&fit=crop',
  ice_cream: 'https://images.unsplash.com/photo-1497034825429-c343d7c6a68f?w=100&h=100&fit=crop',
  // Nuts, sweets and snacks
  almond: 'https://images.unsplash.com/photo-1508061253366-f7da158b6d46?w=100&h=100&fit=crop',
  honey: 'https://images.unsplash.com/photo-1558642452-9d2a7deb7f62?w=100&h=100&fit=crop',
  chocolate: 'https://images.unsplash.com/photo-1481391319762-47dff72954d9?w=100&h=100&fit=crop',
  cookie: 'https://images.unsplash.com/photo-1558961363-fa8fdf82db35?w=100&h=100&fit=crop',
  // Drinks
  coffee: 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=100&h=100&fit=crop',
  latte: 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=100&h=100&fit=crop',
  tea: 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?w=100&h=100&fit=crop',
  juice: 'https://images.unsplash.com/photo-1621506289937-a8e4df240d0b?w=100&h=100&fit=crop',
  soda: 'https://images.unsplash.com/photo-1527960471264-932f39eb5846?w=100&h=100&fit=crop',
  smoothie: 'https://images.unsplash.com/photo-1505252585461-04db1eb84625?w=100&h=100&fit=crop',
  // Meals
  pizza: 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=100&h=100&fit=crop',
  burger: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=100&h=100&fit=crop',
  hamburger: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=100&h=100&fit=crop',
  sandwich: 'https://images.unsplash.com/photo-1528736235302-52922df5c122?w=100&h=100&fit=crop',
  soup: 'https://images.unsplash.com/photo-1547592166-23ac45744acd?w=100&h=100&fit=crop',
  sushi: 'https://images.unsplash.com/photo-1579871494447-9811cf80d66c?w=100&h=100&fit=crop',
};

// Generic fallback URLs for food categories
const CATEGORY_FALLBACKS: Record<string, string> = {
  meat: 'https://images.unsplash.com/photo-1607623814075-e51df1bdc82f?w=100&h=100&fit=crop',
  fruit: 'https://images.unsplash.com/photo-1619566636858-adf3ef46400b?w=100&h=100&fit=crop',
  vegetable: 'https://images.unsplash.com/photo-1540420773420-3366772f4999?w=100&h=100&fit=crop',
  dairy: 'https://images.unsplash.com/photo-1628088062854-d1870b4553da?w=100&h=100&fit=crop',
  grain: 'https://images.unsplash.com/photo-1586201375761-83865001e31c?w=100&h=100&fit=crop',
  snack: 'https://images.unsplash.com/photo-1599490659213-e2b9527bd087?w=100&h=100&fit=crop',
  drink: 'https://images.unsplash.com/photo-1544145945-f90425340c7e?w=100&h=100&fit=crop',
  default: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=100&h=100&fit=crop',
};

// FOOD-1-M R1 (operator ruling): a food shows a photo only when the photo is of that food. Words a
// food name may add without becoming another food: "Pineapple, raw" and "Large eggs" are still the map's
// pineapple and egg, while "Banana chips" and "Egg, Benedict" are not the map's banana and egg.
const PLAIN_WORDS = new Set([
  'raw', 'fresh', 'frozen', 'cooked', 'uncooked', 'dry', 'boiled', 'baked', 'roasted', 'grilled', 'steamed',
  'drained', 'whole', 'plain', 'large', 'medium', 'small', 'sliced', 'chopped', 'diced', 'peeled', 'nonfat',
  'lowfat', 'skinless', 'boneless', 'unsweetened', 'unsalted', 'organic',
]);

function mapKey(words: string[]): string | null {
  if (words.length === 0) return null;
  const last = words[words.length - 1];
  const singular = last.replace(/ies$/, 'y').replace(/(ch|sh|x|ss|o)es$/, '$1').replace(/([^s])s$/, '$1');
  for (const w of [last, singular]) {
    const key = [...words.slice(0, -1), w].join('_');
    if (Object.prototype.hasOwnProperty.call(FOOD_PHOTOS, key)) return key;
  }
  return null;
}

/**
 * The phone's photo for a food, only on an exact match: the name (its first part, before a comma, in
 * the "Food, kind" order USDA uses) is a food in the map, singular or plural, and every other word is
 * a plain word above. No word inside another word, no nearest word and no category photo: '' means
 * there is no photo of this food, and FoodImage shows the plain placeholder.
 */
export function getFoodImageUrl(foodName: string): string {
  const parts = foodName.toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z,\s]/g, ' ').split(',')
    .map((part) => part.split(/\s+/).filter(Boolean));
  const [head = [], ...rest] = parts;
  if (rest.some((part) => part.some((w) => !PLAIN_WORDS.has(w)))) return '';
  const key = mapKey(head) ?? mapKey(head.filter((w) => !PLAIN_WORDS.has(w)));
  return key ? FOOD_PHOTOS[key] : '';
}

// Recipe-specific images for all 75 recipes
const RECIPE_IMAGES: Record<string, string> = {
  // High-protein meals (20)
  'grilled chicken & broccoli': 'https://images.unsplash.com/photo-1598103442097-8b74394b95c6?w=200&h=160&fit=crop',
  'salmon with asparagus': 'https://images.unsplash.com/photo-1467003909585-2f8a72700288?w=200&h=160&fit=crop',
  'turkey meatball': 'https://images.unsplash.com/photo-1529042410759-befb1204b468?w=200&h=160&fit=crop',
  'beef stir fry': 'https://images.unsplash.com/photo-1512058564366-18510be2db19?w=200&h=160&fit=crop',
  'shrimp taco': 'https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=200&h=160&fit=crop',
  'chicken caesar salad': 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=200&h=160&fit=crop',
  'tuna poke bowl': 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=200&h=160&fit=crop',
  'protein pancake': 'https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445?w=200&h=160&fit=crop',
  'egg white omelette': 'https://images.unsplash.com/photo-1482049016688-2d3e1b311543?w=200&h=160&fit=crop',
  'lean burger lettuce wrap': 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=200&h=160&fit=crop',
  'chicken thigh with sweet potato': 'https://images.unsplash.com/photo-1598103442097-8b74394b95c6?w=200&h=160&fit=crop',
  'cottage cheese power bowl': 'https://images.unsplash.com/photo-1488477181946-6428a0291777?w=200&h=160&fit=crop',
  'baked cod with veggies': 'https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?w=200&h=160&fit=crop',
  'greek chicken bowl': 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=200&h=160&fit=crop',
  'steak & eggs': 'https://images.unsplash.com/photo-1600891964092-4316c288032e?w=200&h=160&fit=crop',
  'chicken burrito bowl': 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=200&h=160&fit=crop',
  'tofu scramble': 'https://images.unsplash.com/photo-1628689469838-524a4a973b8e?w=200&h=160&fit=crop',
  'bbq chicken breast': 'https://images.unsplash.com/photo-1598103442097-8b74394b95c6?w=200&h=160&fit=crop',
  'lentil & chicken soup': 'https://images.unsplash.com/photo-1547592166-23ac45744acd?w=200&h=160&fit=crop',
  'tuna salad wrap': 'https://images.unsplash.com/photo-1528736235302-52922df5c122?w=200&h=160&fit=crop',

  // Breakfast options (10)
  'overnight oats': 'https://images.unsplash.com/photo-1517673400267-0251440c45dc?w=200&h=160&fit=crop',
  'avocado toast with egg': 'https://images.unsplash.com/photo-1523049673857-eb18f1d7b578?w=200&h=160&fit=crop',
  'berry smoothie bowl': 'https://images.unsplash.com/photo-1505252585461-04db1eb84625?w=200&h=160&fit=crop',
  'breakfast burrito': 'https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=200&h=160&fit=crop',
  'banana peanut butter smoothie': 'https://images.unsplash.com/photo-1505252585461-04db1eb84625?w=200&h=160&fit=crop',
  'veggie frittata': 'https://images.unsplash.com/photo-1482049016688-2d3e1b311543?w=200&h=160&fit=crop',
  'french toast': 'https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445?w=200&h=160&fit=crop',
  'chia pudding': 'https://images.unsplash.com/photo-1508061253366-f7da158b6d46?w=200&h=160&fit=crop',
  'breakfast oat bar': 'https://images.unsplash.com/photo-1622484212850-eb596d769edc?w=200&h=160&fit=crop',
  'yogurt parfait': 'https://images.unsplash.com/photo-1488477181946-6428a0291777?w=200&h=160&fit=crop',

  // Quick meals (10)
  'chicken quesadilla': 'https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=200&h=160&fit=crop',
  'caprese sandwich': 'https://images.unsplash.com/photo-1528736235302-52922df5c122?w=200&h=160&fit=crop',
  '5-minute egg fried rice': 'https://images.unsplash.com/photo-1512058564366-18510be2db19?w=200&h=160&fit=crop',
  'blt sandwich': 'https://images.unsplash.com/photo-1528736235302-52922df5c122?w=200&h=160&fit=crop',
  'microwave mug omelette': 'https://images.unsplash.com/photo-1482049016688-2d3e1b311543?w=200&h=160&fit=crop',
  'mediterranean wrap': 'https://images.unsplash.com/photo-1528736235302-52922df5c122?w=200&h=160&fit=crop',
  'peanut noodles': 'https://images.unsplash.com/photo-1621996346565-e3dbc646d9a9?w=200&h=160&fit=crop',
  'greek salad with grilled chicken': 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=200&h=160&fit=crop',
  'taco salad': 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=200&h=160&fit=crop',
  'turkey & cheese roll-ups': 'https://images.unsplash.com/photo-1574672280600-4accfa404c94?w=200&h=160&fit=crop',

  // Low-carb options (10)
  'zucchini noodle bolognese': 'https://images.unsplash.com/photo-1563565375-f3fdfdbefa83?w=200&h=160&fit=crop',
  'cauliflower fried rice': 'https://images.unsplash.com/photo-1459411552884-841db9b3cc2a?w=200&h=160&fit=crop',
  'stuffed bell pepper': 'https://images.unsplash.com/photo-1563565375-f3fdfdbefa83?w=200&h=160&fit=crop',
  'keto chicken wings': 'https://images.unsplash.com/photo-1527477396000-e27163b4bdb5?w=200&h=160&fit=crop',
  'spinach & feta stuffed chicken': 'https://images.unsplash.com/photo-1598103442097-8b74394b95c6?w=200&h=160&fit=crop',
  'cucumber tuna boats': 'https://images.unsplash.com/photo-1449300079323-02e209d9d3a6?w=200&h=160&fit=crop',
  'chicken cobb salad': 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=200&h=160&fit=crop',
  'garlic butter shrimp': 'https://images.unsplash.com/photo-1565680018434-b513d5e5fd47?w=200&h=160&fit=crop',
  'caprese chicken': 'https://images.unsplash.com/photo-1598103442097-8b74394b95c6?w=200&h=160&fit=crop',
  'egg drop soup': 'https://images.unsplash.com/photo-1547592166-23ac45744acd?w=200&h=160&fit=crop',

  // International dishes (10)
  'korean bulgogi': 'https://images.unsplash.com/photo-1588168333986-5078d3ae3976?w=200&h=160&fit=crop',
  'thai basil turkey': 'https://images.unsplash.com/photo-1512058564366-18510be2db19?w=200&h=160&fit=crop',
  'japanese miso salmon': 'https://images.unsplash.com/photo-1467003909585-2f8a72700288?w=200&h=160&fit=crop',
  'indian chicken tikka': 'https://images.unsplash.com/photo-1598103442097-8b74394b95c6?w=200&h=160&fit=crop',
  'moroccan chickpea stew': 'https://images.unsplash.com/photo-1547592166-23ac45744acd?w=200&h=160&fit=crop',
  'mexican burrito bowl': 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=200&h=160&fit=crop',
  'vietnamese pho': 'https://images.unsplash.com/photo-1547592166-23ac45744acd?w=200&h=160&fit=crop',
  'italian turkey meatball': 'https://images.unsplash.com/photo-1529042410759-befb1204b468?w=200&h=160&fit=crop',
  'spanish tortilla': 'https://images.unsplash.com/photo-1482049016688-2d3e1b311543?w=200&h=160&fit=crop',
  'teriyaki chicken bowl': 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=200&h=160&fit=crop',

  // Vegetarian/vegan (5)
  'black bean veggie burger': 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=200&h=160&fit=crop',
  'chickpea curry': 'https://images.unsplash.com/photo-1547592166-23ac45744acd?w=200&h=160&fit=crop',
  'lentil dal': 'https://images.unsplash.com/photo-1546549032-9571cd6b27df?w=200&h=160&fit=crop',
  'veggie stir fry with tofu': 'https://images.unsplash.com/photo-1512058564366-18510be2db19?w=200&h=160&fit=crop',
  'mushroom risotto': 'https://images.unsplash.com/photo-1621996346565-e3dbc646d9a9?w=200&h=160&fit=crop',

  // Snacks/sides (10)
  'trail mix': 'https://images.unsplash.com/photo-1508061253366-f7da158b6d46?w=200&h=160&fit=crop',
  'apple slices with peanut butter': 'https://images.unsplash.com/photo-1560806887-1e4cd0b6cbd6?w=200&h=160&fit=crop',
  'protein energy balls': 'https://images.unsplash.com/photo-1622484212850-eb596d769edc?w=200&h=160&fit=crop',
  'guacamole with veggies': 'https://images.unsplash.com/photo-1523049673857-eb18f1d7b578?w=200&h=160&fit=crop',
  'hard-boiled eggs': 'https://images.unsplash.com/photo-1482049016688-2d3e1b311543?w=200&h=160&fit=crop',
  'roasted sweet potato fries': 'https://images.unsplash.com/photo-1596097635121-14b63a7e0e75?w=200&h=160&fit=crop',
  'greek tzatziki with pita': 'https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=200&h=160&fit=crop',
  'edamame bowl': 'https://images.unsplash.com/photo-1615485290382-441e4d049cb5?w=200&h=160&fit=crop',
  'banana nice cream': 'https://images.unsplash.com/photo-1497034825429-c343d7c6a68f?w=200&h=160&fit=crop',
  'cheese & crackers plate': 'https://images.unsplash.com/photo-1486297678162-eb2a19b0a32d?w=200&h=160&fit=crop',
};

export function getRecipeImageUrl(recipeName: string): string {
  const lower = recipeName.toLowerCase().replace(/[()]/g, '');
  const underscored = lower.replace(/\s+/g, '_');

  // Check RECIPE_IMAGES first for exact recipe name matches
  for (const [keyword, url] of Object.entries(RECIPE_IMAGES)) {
    if (lower.includes(keyword)) return url;
  }

  // Check specific compound keywords first
  for (const [keyword, url] of Object.entries(FOOD_PHOTOS)) {
    if (keyword.includes('_')) {
      const spaced = keyword.replace(/_/g, ' ');
      if (lower.includes(spaced) || underscored.includes(keyword)) return url.replace('w=100&h=100', 'w=200&h=160');
    }
  }

  // Then check single-word keywords
  for (const [keyword, url] of Object.entries(FOOD_PHOTOS)) {
    if (!keyword.includes('_') && lower.includes(keyword)) return url.replace('w=100&h=100', 'w=200&h=160');
  }

  if (/chicken|beef|steak|pork|turkey|lamb|bacon|ham|sausage/.test(lower)) return CATEGORY_FALLBACKS.meat.replace('w=100&h=100', 'w=200&h=160');
  if (/apple|banana|orange|berry|mango|grape|melon|pear|peach/.test(lower)) return CATEGORY_FALLBACKS.fruit.replace('w=100&h=100', 'w=200&h=160');
  if (/broccoli|spinach|kale|carrot|pepper|onion|tomato|lettuce|celery|cucumber/.test(lower)) return CATEGORY_FALLBACKS.vegetable.replace('w=100&h=100', 'w=200&h=160');
  if (/milk|cheese|yogurt|cream|butter/.test(lower)) return CATEGORY_FALLBACKS.dairy.replace('w=100&h=100', 'w=200&h=160');
  if (/rice|bread|pasta|oat|wheat|flour|cereal|tortilla|naan/.test(lower)) return CATEGORY_FALLBACKS.grain.replace('w=100&h=100', 'w=200&h=160');
  if (/bar|chip|cracker|cookie|cake|candy|snack/.test(lower)) return CATEGORY_FALLBACKS.snack.replace('w=100&h=100', 'w=200&h=160');
  if (/juice|soda|water|tea|coffee|shake|smoothie|drink/.test(lower)) return CATEGORY_FALLBACKS.drink.replace('w=100&h=100', 'w=200&h=160');

  return CATEGORY_FALLBACKS.default.replace('w=100&h=100', 'w=200&h=160');
}

// Restaurant and brand logo mappings using Clearbit Logo API
const RESTAURANT_LOGOS: Record<string, string> = {
  'mcdonald': 'https://logo.clearbit.com/mcdonalds.com',
  'burger king': 'https://logo.clearbit.com/bk.com',
  'wendy': 'https://logo.clearbit.com/wendys.com',
  'chick-fil-a': 'https://logo.clearbit.com/chick-fil-a.com',
  'chickfila': 'https://logo.clearbit.com/chick-fil-a.com',
  'subway': 'https://logo.clearbit.com/subway.com',
  'taco bell': 'https://logo.clearbit.com/tacobell.com',
  'chipotle': 'https://logo.clearbit.com/chipotle.com',
  'starbucks': 'https://logo.clearbit.com/starbucks.com',
  'dunkin': 'https://logo.clearbit.com/dunkindonuts.com',
  'domino': 'https://logo.clearbit.com/dominos.com',
  'pizza hut': 'https://logo.clearbit.com/pizzahut.com',
  'papa john': 'https://logo.clearbit.com/papajohns.com',
  'kfc': 'https://logo.clearbit.com/kfc.com',
  'popeye': 'https://logo.clearbit.com/popeyes.com',
  'arby': 'https://logo.clearbit.com/arbys.com',
  'panera': 'https://logo.clearbit.com/panerabread.com',
  'five guys': 'https://logo.clearbit.com/fiveguys.com',
  'in-n-out': 'https://logo.clearbit.com/in-n-out.com',
  'jack in the box': 'https://logo.clearbit.com/jackinthebox.com',
  'sonic': 'https://logo.clearbit.com/sonicdrivein.com',
  'whataburger': 'https://logo.clearbit.com/whataburger.com',
  'del taco': 'https://logo.clearbit.com/deltaco.com',
  'raising cane': 'https://logo.clearbit.com/raisingcanes.com',
  'wingstop': 'https://logo.clearbit.com/wingstop.com',
  'panda express': 'https://logo.clearbit.com/pandaexpress.com',
  'olive garden': 'https://logo.clearbit.com/olivegarden.com',
  'applebee': 'https://logo.clearbit.com/applebees.com',
  'chili': 'https://logo.clearbit.com/chilis.com',
  'denny': 'https://logo.clearbit.com/dennys.com',
  'ihop': 'https://logo.clearbit.com/ihop.com',
  'waffle house': 'https://logo.clearbit.com/wafflehouse.com',
  'wegman': 'https://logo.clearbit.com/wegmans.com',
  'trader joe': 'https://logo.clearbit.com/traderjoes.com',
  'whole foods': 'https://logo.clearbit.com/wholefoodsmarket.com',
  'kroger': 'https://logo.clearbit.com/kroger.com',
  'costco': 'https://logo.clearbit.com/costco.com',
  'walmart': 'https://logo.clearbit.com/walmart.com',
  'target': 'https://logo.clearbit.com/target.com',
  'aldi': 'https://logo.clearbit.com/aldi.us',
  'publix': 'https://logo.clearbit.com/publix.com',
};

export function getRestaurantLogo(foodName: string, brand?: string): string | null {
  const searchText = `${foodName} ${brand || ''}`.toLowerCase();
  for (const [keyword, logoUrl] of Object.entries(RESTAURANT_LOGOS)) {
    if (searchText.includes(keyword)) return logoUrl;
  }
  return null;
}
