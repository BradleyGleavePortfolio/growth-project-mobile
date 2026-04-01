/**
 * Returns food photo URLs based on food name.
 * Uses Unsplash image CDN with curated photo IDs for common foods.
 */

// Pre-mapped high-quality Unsplash photos for common food keywords
const FOOD_PHOTOS: Record<string, string> = {
  chicken: 'https://images.unsplash.com/photo-1598103442097-8b74394b95c6?w=100&h=100&fit=crop',
  beef: 'https://images.unsplash.com/photo-1588168333986-5078d3ae3976?w=100&h=100&fit=crop',
  steak: 'https://images.unsplash.com/photo-1600891964092-4316c288032e?w=100&h=100&fit=crop',
  salmon: 'https://images.unsplash.com/photo-1467003909585-2f8a72700288?w=100&h=100&fit=crop',
  fish: 'https://images.unsplash.com/photo-1510130387422-82bed34b37e9?w=100&h=100&fit=crop',
  egg: 'https://images.unsplash.com/photo-1482049016688-2d3e1b311543?w=100&h=100&fit=crop',
  rice: 'https://images.unsplash.com/photo-1516684732162-798a0062be99?w=100&h=100&fit=crop',
  pasta: 'https://images.unsplash.com/photo-1621996346565-e3dbc646d9a9?w=100&h=100&fit=crop',
  bread: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=100&h=100&fit=crop',
  milk: 'https://images.unsplash.com/photo-1563636619-e9143da7973b?w=100&h=100&fit=crop',
  cheese: 'https://images.unsplash.com/photo-1486297678162-eb2a19b0a32d?w=100&h=100&fit=crop',
  yogurt: 'https://images.unsplash.com/photo-1488477181946-6428a0291777?w=100&h=100&fit=crop',
  apple: 'https://images.unsplash.com/photo-1560806887-1e4cd0b6cbd6?w=100&h=100&fit=crop',
  banana: 'https://images.unsplash.com/photo-1571771894821-ce9b6c11b08e?w=100&h=100&fit=crop',
  orange: 'https://images.unsplash.com/photo-1547514701-42782101795e?w=100&h=100&fit=crop',
  broccoli: 'https://images.unsplash.com/photo-1459411552884-841db9b3cc2a?w=100&h=100&fit=crop',
  salad: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=100&h=100&fit=crop',
  avocado: 'https://images.unsplash.com/photo-1523049673857-eb18f1d7b578?w=100&h=100&fit=crop',
  oats: 'https://images.unsplash.com/photo-1517673400267-0251440c45dc?w=100&h=100&fit=crop',
  oatmeal: 'https://images.unsplash.com/photo-1517673400267-0251440c45dc?w=100&h=100&fit=crop',
  peanut: 'https://images.unsplash.com/photo-1566478989037-eec170784d0b?w=100&h=100&fit=crop',
  almond: 'https://images.unsplash.com/photo-1508061253366-f7da158b6d46?w=100&h=100&fit=crop',
  protein: 'https://images.unsplash.com/photo-1593095948071-474c5cc2c5d9?w=100&h=100&fit=crop',
  turkey: 'https://images.unsplash.com/photo-1574672280600-4accfa404c94?w=100&h=100&fit=crop',
  pork: 'https://images.unsplash.com/photo-1432139555190-58524dae6a55?w=100&h=100&fit=crop',
  shrimp: 'https://images.unsplash.com/photo-1565680018434-b513d5e5fd47?w=100&h=100&fit=crop',
  tuna: 'https://images.unsplash.com/photo-1534604973900-c43ab4c2e0ab?w=100&h=100&fit=crop',
  potato: 'https://images.unsplash.com/photo-1518977676601-b53f82ber633?w=100&h=100&fit=crop',
  corn: 'https://images.unsplash.com/photo-1551754655-cd27e38d2076?w=100&h=100&fit=crop',
  pizza: 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=100&h=100&fit=crop',
  burger: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=100&h=100&fit=crop',
  sandwich: 'https://images.unsplash.com/photo-1528736235302-52922df5c122?w=100&h=100&fit=crop',
  soup: 'https://images.unsplash.com/photo-1547592166-23ac45744acd?w=100&h=100&fit=crop',
  smoothie: 'https://images.unsplash.com/photo-1505252585461-04db1eb84625?w=100&h=100&fit=crop',
  coffee: 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=100&h=100&fit=crop',
  chocolate: 'https://images.unsplash.com/photo-1481391319762-47dff72954d9?w=100&h=100&fit=crop',
  ice_cream: 'https://images.unsplash.com/photo-1497034825429-c343d7c6a68f?w=100&h=100&fit=crop',
  cereal: 'https://images.unsplash.com/photo-1521483451569-e33803c0330c?w=100&h=100&fit=crop',
  bacon: 'https://images.unsplash.com/photo-1606851091851-e483b7ea1d54?w=100&h=100&fit=crop',
  sushi: 'https://images.unsplash.com/photo-1579871494447-9811cf80d66c?w=100&h=100&fit=crop',
  stir_fry: 'https://images.unsplash.com/photo-1512058564366-18510be2db19?w=100&h=100&fit=crop',
  beans: 'https://images.unsplash.com/photo-1536304929831-ee1ca9d44906?w=100&h=100&fit=crop',
  lentil: 'https://images.unsplash.com/photo-1546549032-9571cd6b27df?w=100&h=100&fit=crop',
  tofu: 'https://images.unsplash.com/photo-1628689469838-524a4a973b8e?w=100&h=100&fit=crop',
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

export function getFoodImageUrl(foodName: string): string {
  const lower = foodName.toLowerCase();

  // Check exact keyword matches first
  for (const [keyword, url] of Object.entries(FOOD_PHOTOS)) {
    if (lower.includes(keyword)) return url;
  }

  // Check category fallbacks
  if (/chicken|beef|steak|pork|turkey|lamb|bacon|ham|sausage/.test(lower)) return CATEGORY_FALLBACKS.meat;
  if (/apple|banana|orange|berry|mango|grape|melon|pear|peach/.test(lower)) return CATEGORY_FALLBACKS.fruit;
  if (/broccoli|spinach|kale|carrot|pepper|onion|tomato|lettuce|celery|cucumber/.test(lower)) return CATEGORY_FALLBACKS.vegetable;
  if (/milk|cheese|yogurt|cream|butter/.test(lower)) return CATEGORY_FALLBACKS.dairy;
  if (/rice|bread|pasta|oat|wheat|flour|cereal|tortilla|naan/.test(lower)) return CATEGORY_FALLBACKS.grain;
  if (/bar|chip|cracker|cookie|cake|candy|snack/.test(lower)) return CATEGORY_FALLBACKS.snack;
  if (/juice|soda|water|tea|coffee|shake|smoothie|drink/.test(lower)) return CATEGORY_FALLBACKS.drink;

  return CATEGORY_FALLBACKS.default;
}

export function getRecipeImageUrl(recipeName: string): string {
  const lower = recipeName.toLowerCase();

  for (const [keyword, url] of Object.entries(FOOD_PHOTOS)) {
    if (lower.includes(keyword)) return url.replace('w=100&h=100', 'w=200&h=160');
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
