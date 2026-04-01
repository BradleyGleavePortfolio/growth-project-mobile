/**
 * Returns food photo URLs based on food name.
 * Uses Unsplash image CDN with curated photo IDs for common foods.
 */

// Pre-mapped high-quality Unsplash photos for common food keywords (200+)
// More specific entries (e.g. "chicken_breast") MUST come before generic ones (e.g. "chicken")
// so the matching logic can prefer them.
const FOOD_PHOTOS: Record<string, string> = {
  // === PROTEINS - Specific first ===
  chicken_breast: 'https://images.unsplash.com/photo-1604503468506-a8da13d82791?w=100&h=100&fit=crop',
  chicken_thigh: 'https://images.unsplash.com/photo-1587593810167-a84920ea0781?w=100&h=100&fit=crop',
  chicken_wing: 'https://images.unsplash.com/photo-1527477396000-e27163b4bdb5?w=100&h=100&fit=crop',
  ground_turkey: 'https://images.unsplash.com/photo-1602491453631-e2a5ad90a131?w=100&h=100&fit=crop',
  turkey_breast: 'https://images.unsplash.com/photo-1574672280600-4accfa5b6f98?w=100&h=100&fit=crop',
  ground_beef: 'https://images.unsplash.com/photo-1588168333986-5078d3ae3976?w=100&h=100&fit=crop',
  beef_jerky: 'https://images.unsplash.com/photo-1613946069412-38f7f1ff0b65?w=100&h=100&fit=crop',
  egg_white: 'https://images.unsplash.com/photo-1482049016688-2d3e1b311543?w=100&h=100&fit=crop',
  smoked_salmon: 'https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?w=100&h=100&fit=crop',
  pork_tenderloin: 'https://images.unsplash.com/photo-1432139555190-58524dae6a55?w=100&h=100&fit=crop',
  lamb_chop: 'https://images.unsplash.com/photo-1603048297172-c92544798d5a?w=100&h=100&fit=crop',
  crab_meat: 'https://images.unsplash.com/photo-1559737558-2f5a35f4523b?w=100&h=100&fit=crop',
  protein_bar: 'https://images.unsplash.com/photo-1622484212850-eb596d769edc?w=100&h=100&fit=crop',
  protein_shake: 'https://images.unsplash.com/photo-1593095948071-474c5cc2c5d9?w=100&h=100&fit=crop',
  whey_protein: 'https://images.unsplash.com/photo-1593095948071-474c5cc2c5d9?w=100&h=100&fit=crop',
  cottage_cheese: 'https://images.unsplash.com/photo-1488477181946-6428a0291777?w=100&h=100&fit=crop',
  greek_yogurt: 'https://images.unsplash.com/photo-1488477181946-6428a0291777?w=100&h=100&fit=crop',
  black_bean: 'https://images.unsplash.com/photo-1536304929831-ee1ca9d44906?w=100&h=100&fit=crop',
  kidney_bean: 'https://images.unsplash.com/photo-1536304929831-ee1ca9d44906?w=100&h=100&fit=crop',
  navy_bean: 'https://images.unsplash.com/photo-1536304929831-ee1ca9d44906?w=100&h=100&fit=crop',
  // Generic proteins
  chicken: 'https://images.unsplash.com/photo-1598103442097-8b74394b95c6?w=100&h=100&fit=crop',
  beef: 'https://images.unsplash.com/photo-1588168333986-5078d3ae3976?w=100&h=100&fit=crop',
  steak: 'https://images.unsplash.com/photo-1600891964092-4316c288032e?w=100&h=100&fit=crop',
  salmon: 'https://images.unsplash.com/photo-1467003909585-2f8a72700288?w=100&h=100&fit=crop',
  fish: 'https://images.unsplash.com/photo-1510130387422-82bed34b37e9?w=100&h=100&fit=crop',
  egg: 'https://images.unsplash.com/photo-1482049016688-2d3e1b311543?w=100&h=100&fit=crop',
  turkey: 'https://images.unsplash.com/photo-1574672280600-4accfa404c94?w=100&h=100&fit=crop',
  pork: 'https://images.unsplash.com/photo-1432139555190-58524dae6a55?w=100&h=100&fit=crop',
  shrimp: 'https://images.unsplash.com/photo-1565680018434-b513d5e5fd47?w=100&h=100&fit=crop',
  tuna: 'https://images.unsplash.com/photo-1534604973900-c43ab4c2e0ab?w=100&h=100&fit=crop',
  tilapia: 'https://images.unsplash.com/photo-1510130387422-82bed34b37e9?w=100&h=100&fit=crop',
  cod: 'https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?w=100&h=100&fit=crop',
  mahi: 'https://images.unsplash.com/photo-1534604973900-c43ab4c2e0ab?w=100&h=100&fit=crop',
  scallop: 'https://images.unsplash.com/photo-1559737558-2f5a35f4523b?w=100&h=100&fit=crop',
  bison: 'https://images.unsplash.com/photo-1594212699903-ec8a3eca50f5?w=100&h=100&fit=crop',
  sardine: 'https://images.unsplash.com/photo-1599084993091-1cb5c0721cc6?w=100&h=100&fit=crop',
  duck: 'https://images.unsplash.com/photo-1504472478235-9bc48ba4d60f?w=100&h=100&fit=crop',
  crab: 'https://images.unsplash.com/photo-1559737558-2f5a35f4523b?w=100&h=100&fit=crop',
  ham: 'https://images.unsplash.com/photo-1529692236671-f1f6cf9683ba?w=100&h=100&fit=crop',
  sausage: 'https://images.unsplash.com/photo-1601628828688-632f38a5a7d0?w=100&h=100&fit=crop',
  bacon: 'https://images.unsplash.com/photo-1606851091851-e483b7ea1d54?w=100&h=100&fit=crop',
  lamb: 'https://images.unsplash.com/photo-1603048297172-c92544798d5a?w=100&h=100&fit=crop',
  tempeh: 'https://images.unsplash.com/photo-1615485290382-441e4d049cb5?w=100&h=100&fit=crop',
  tofu: 'https://images.unsplash.com/photo-1628689469838-524a4a973b8e?w=100&h=100&fit=crop',
  seitan: 'https://images.unsplash.com/photo-1628689469838-524a4a973b8e?w=100&h=100&fit=crop',
  edamame: 'https://images.unsplash.com/photo-1615485290382-441e4d049cb5?w=100&h=100&fit=crop',
  collagen: 'https://images.unsplash.com/photo-1593095948071-474c5cc2c5d9?w=100&h=100&fit=crop',
  whey: 'https://images.unsplash.com/photo-1593095948071-474c5cc2c5d9?w=100&h=100&fit=crop',
  protein: 'https://images.unsplash.com/photo-1593095948071-474c5cc2c5d9?w=100&h=100&fit=crop',
  chickpea: 'https://images.unsplash.com/photo-1515543904823-6b9fc67b5853?w=100&h=100&fit=crop',
  beans: 'https://images.unsplash.com/photo-1536304929831-ee1ca9d44906?w=100&h=100&fit=crop',
  lentil: 'https://images.unsplash.com/photo-1546549032-9571cd6b27df?w=100&h=100&fit=crop',
  jerky: 'https://images.unsplash.com/photo-1613946069412-38f7f1ff0b65?w=100&h=100&fit=crop',

  // === GRAINS & CARBS - Specific first ===
  brown_rice: 'https://images.unsplash.com/photo-1586201375761-83865001e31c?w=100&h=100&fit=crop',
  white_rice: 'https://images.unsplash.com/photo-1586201375761-83865001e31c?w=100&h=100&fit=crop',
  jasmine_rice: 'https://images.unsplash.com/photo-1586201375761-83865001e31c?w=100&h=100&fit=crop',
  rice_cake: 'https://images.unsplash.com/photo-1586201375761-83865001e31c?w=100&h=100&fit=crop',
  fried_rice: 'https://images.unsplash.com/photo-1512058564366-18510be2db19?w=100&h=100&fit=crop',
  whole_wheat_bread: 'https://images.unsplash.com/photo-1549931319-a545753467c8?w=100&h=100&fit=crop',
  white_bread: 'https://images.unsplash.com/photo-1549931319-a545753467c8?w=100&h=100&fit=crop',
  sourdough: 'https://images.unsplash.com/photo-1549931319-a545753467c8?w=100&h=100&fit=crop',
  english_muffin: 'https://images.unsplash.com/photo-1549931319-a545753467c8?w=100&h=100&fit=crop',
  corn_tortilla: 'https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=100&h=100&fit=crop',
  sweet_potato: 'https://images.unsplash.com/photo-1596097635121-14b63a7e0e75?w=100&h=100&fit=crop',
  russet_potato: 'https://images.unsplash.com/photo-1518977676601-b53f82ber633?w=100&h=100&fit=crop',
  bran_cereal: 'https://images.unsplash.com/photo-1521483451569-e33803c0330c?w=100&h=100&fit=crop',
  pita_bread: 'https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=100&h=100&fit=crop',
  naan_bread: 'https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=100&h=100&fit=crop',
  pancake_mix: 'https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445?w=100&h=100&fit=crop',
  // Generic grains
  rice: 'https://images.unsplash.com/photo-1516684732162-798a0062be99?w=100&h=100&fit=crop',
  pasta: 'https://images.unsplash.com/photo-1621996346565-e3dbc646d9a9?w=100&h=100&fit=crop',
  noodle: 'https://images.unsplash.com/photo-1621996346565-e3dbc646d9a9?w=100&h=100&fit=crop',
  bread: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=100&h=100&fit=crop',
  oats: 'https://images.unsplash.com/photo-1517673400267-0251440c45dc?w=100&h=100&fit=crop',
  oatmeal: 'https://images.unsplash.com/photo-1517673400267-0251440c45dc?w=100&h=100&fit=crop',
  quinoa: 'https://images.unsplash.com/photo-1586201375761-83865001e31c?w=100&h=100&fit=crop',
  bagel: 'https://images.unsplash.com/photo-1585445490387-f47934b73b54?w=100&h=100&fit=crop',
  tortilla: 'https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=100&h=100&fit=crop',
  potato: 'https://images.unsplash.com/photo-1518977676601-b53f82ber633?w=100&h=100&fit=crop',
  couscous: 'https://images.unsplash.com/photo-1586201375761-83865001e31c?w=100&h=100&fit=crop',
  farro: 'https://images.unsplash.com/photo-1586201375761-83865001e31c?w=100&h=100&fit=crop',
  pita: 'https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=100&h=100&fit=crop',
  naan: 'https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=100&h=100&fit=crop',
  granola: 'https://images.unsplash.com/photo-1517673400267-0251440c45dc?w=100&h=100&fit=crop',
  pancake: 'https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445?w=100&h=100&fit=crop',
  waffle: 'https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445?w=100&h=100&fit=crop',
  cracker: 'https://images.unsplash.com/photo-1558961363-fa8fdf82db35?w=100&h=100&fit=crop',
  popcorn: 'https://images.unsplash.com/photo-1585735078006-6176a8917c7c?w=100&h=100&fit=crop',
  pretzel: 'https://images.unsplash.com/photo-1558961363-fa8fdf82db35?w=100&h=100&fit=crop',
  corn: 'https://images.unsplash.com/photo-1551754655-cd27e38d2076?w=100&h=100&fit=crop',
  buckwheat: 'https://images.unsplash.com/photo-1586201375761-83865001e31c?w=100&h=100&fit=crop',
  muesli: 'https://images.unsplash.com/photo-1517673400267-0251440c45dc?w=100&h=100&fit=crop',
  cereal: 'https://images.unsplash.com/photo-1521483451569-e33803c0330c?w=100&h=100&fit=crop',

  // === FRUITS - Specific first ===
  dried_cranberries: 'https://images.unsplash.com/photo-1577069861033-55d04cec4ef5?w=100&h=100&fit=crop',
  frozen_berries: 'https://images.unsplash.com/photo-1498557850523-fd3d118b962e?w=100&h=100&fit=crop',
  dried_apricot: 'https://images.unsplash.com/photo-1595124216702-4aff11be3a00?w=100&h=100&fit=crop',
  dried_mango: 'https://images.unsplash.com/photo-1553279768-865429fa0078?w=100&h=100&fit=crop',
  pomegranate: 'https://images.unsplash.com/photo-1541344999736-83eca272f6fc?w=100&h=100&fit=crop',
  // Generic fruits
  apple: 'https://images.unsplash.com/photo-1560806887-1e4cd0b6cbd6?w=100&h=100&fit=crop',
  banana: 'https://images.unsplash.com/photo-1571771894821-ce9b6c11b08e?w=100&h=100&fit=crop',
  plantain: 'https://images.unsplash.com/photo-1571771894821-ce9b6c11b08e?w=100&h=100&fit=crop',
  orange: 'https://images.unsplash.com/photo-1547514701-42782101795e?w=100&h=100&fit=crop',
  blueberr: 'https://images.unsplash.com/photo-1498557850523-fd3d118b962e?w=100&h=100&fit=crop',
  strawberr: 'https://images.unsplash.com/photo-1464965911861-746a04b4bca6?w=100&h=100&fit=crop',
  raspberr: 'https://images.unsplash.com/photo-1577069861033-55d04cec4ef5?w=100&h=100&fit=crop',
  grape: 'https://images.unsplash.com/photo-1537640538966-79f369143f8f?w=100&h=100&fit=crop',
  watermelon: 'https://images.unsplash.com/photo-1563114773-84221bd62daa?w=100&h=100&fit=crop',
  pineapple: 'https://images.unsplash.com/photo-1550258987-190a2d41a8ba?w=100&h=100&fit=crop',
  mango: 'https://images.unsplash.com/photo-1553279768-865429fa0078?w=100&h=100&fit=crop',
  peach: 'https://images.unsplash.com/photo-1595124216702-4aff11be3a00?w=100&h=100&fit=crop',
  pear: 'https://images.unsplash.com/photo-1514756331096-242fdeb70d4a?w=100&h=100&fit=crop',
  kiwi: 'https://images.unsplash.com/photo-1585059895524-72359e06133a?w=100&h=100&fit=crop',
  cherr: 'https://images.unsplash.com/photo-1528821128474-27f963b062bf?w=100&h=100&fit=crop',
  cantaloupe: 'https://images.unsplash.com/photo-1563114773-84221bd62daa?w=100&h=100&fit=crop',
  melon: 'https://images.unsplash.com/photo-1563114773-84221bd62daa?w=100&h=100&fit=crop',
  grapefruit: 'https://images.unsplash.com/photo-1577234286642-fc512a5f8f11?w=100&h=100&fit=crop',
  plum: 'https://images.unsplash.com/photo-1595124216702-4aff11be3a00?w=100&h=100&fit=crop',
  fig: 'https://images.unsplash.com/photo-1601379760883-1bb497c558e0?w=100&h=100&fit=crop',
  date: 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=100&h=100&fit=crop',
  raisin: 'https://images.unsplash.com/photo-1537640538966-79f369143f8f?w=100&h=100&fit=crop',
  coconut: 'https://images.unsplash.com/photo-1550258987-190a2d41a8ba?w=100&h=100&fit=crop',
  papaya: 'https://images.unsplash.com/photo-1517282009859-f000ec3b26fe?w=100&h=100&fit=crop',
  lemon: 'https://images.unsplash.com/photo-1590502593747-42a996133562?w=100&h=100&fit=crop',
  lime: 'https://images.unsplash.com/photo-1590502593747-42a996133562?w=100&h=100&fit=crop',
  avocado: 'https://images.unsplash.com/photo-1523049673857-eb18f1d7b578?w=100&h=100&fit=crop',
  berry: 'https://images.unsplash.com/photo-1498557850523-fd3d118b962e?w=100&h=100&fit=crop',
  applesauce: 'https://images.unsplash.com/photo-1560806887-1e4cd0b6cbd6?w=100&h=100&fit=crop',
  cranberr: 'https://images.unsplash.com/photo-1577069861033-55d04cec4ef5?w=100&h=100&fit=crop',

  // === VEGETABLES - Specific first ===
  bell_pepper: 'https://images.unsplash.com/photo-1563565375-f3fdfdbefa83?w=100&h=100&fit=crop',
  green_bean: 'https://images.unsplash.com/photo-1515471209610-dae1c92d8777?w=100&h=100&fit=crop',
  brussels_sprout: 'https://images.unsplash.com/photo-1459411552884-841db9b3cc2a?w=100&h=100&fit=crop',
  sweet_potato_fries: 'https://images.unsplash.com/photo-1596097635121-14b63a7e0e75?w=100&h=100&fit=crop',
  butternut_squash: 'https://images.unsplash.com/photo-1596097635121-14b63a7e0e75?w=100&h=100&fit=crop',
  cherry_tomato: 'https://images.unsplash.com/photo-1546470427-0d4db154ceb8?w=100&h=100&fit=crop',
  bok_choy: 'https://images.unsplash.com/photo-1576045057995-568f588f82fb?w=100&h=100&fit=crop',
  snow_pea: 'https://images.unsplash.com/photo-1515471209610-dae1c92d8777?w=100&h=100&fit=crop',
  salad_green: 'https://images.unsplash.com/photo-1576045057995-568f588f82fb?w=100&h=100&fit=crop',
  // Generic vegetables
  broccoli: 'https://images.unsplash.com/photo-1459411552884-841db9b3cc2a?w=100&h=100&fit=crop',
  spinach: 'https://images.unsplash.com/photo-1576045057995-568f588f82fb?w=100&h=100&fit=crop',
  kale: 'https://images.unsplash.com/photo-1576045057995-568f588f82fb?w=100&h=100&fit=crop',
  asparagus: 'https://images.unsplash.com/photo-1515471209610-dae1c92d8777?w=100&h=100&fit=crop',
  cauliflower: 'https://images.unsplash.com/photo-1459411552884-841db9b3cc2a?w=100&h=100&fit=crop',
  zucchini: 'https://images.unsplash.com/photo-1563565375-f3fdfdbefa83?w=100&h=100&fit=crop',
  mushroom: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=100&h=100&fit=crop',
  onion: 'https://images.unsplash.com/photo-1518977956812-cd3dbadaaf31?w=100&h=100&fit=crop',
  garlic: 'https://images.unsplash.com/photo-1518977956812-cd3dbadaaf31?w=100&h=100&fit=crop',
  tomato: 'https://images.unsplash.com/photo-1546470427-0d4db154ceb8?w=100&h=100&fit=crop',
  cucumber: 'https://images.unsplash.com/photo-1449300079323-02e209d9d3a6?w=100&h=100&fit=crop',
  celery: 'https://images.unsplash.com/photo-1515471209610-dae1c92d8777?w=100&h=100&fit=crop',
  lettuce: 'https://images.unsplash.com/photo-1576045057995-568f588f82fb?w=100&h=100&fit=crop',
  romaine: 'https://images.unsplash.com/photo-1576045057995-568f588f82fb?w=100&h=100&fit=crop',
  cabbage: 'https://images.unsplash.com/photo-1576045057995-568f588f82fb?w=100&h=100&fit=crop',
  eggplant: 'https://images.unsplash.com/photo-1563565375-f3fdfdbefa83?w=100&h=100&fit=crop',
  artichoke: 'https://images.unsplash.com/photo-1515471209610-dae1c92d8777?w=100&h=100&fit=crop',
  beet: 'https://images.unsplash.com/photo-1546470427-0d4db154ceb8?w=100&h=100&fit=crop',
  radish: 'https://images.unsplash.com/photo-1546470427-0d4db154ceb8?w=100&h=100&fit=crop',
  carrot: 'https://images.unsplash.com/photo-1447175008436-054170c2e979?w=100&h=100&fit=crop',
  pepper: 'https://images.unsplash.com/photo-1563565375-f3fdfdbefa83?w=100&h=100&fit=crop',
  pea: 'https://images.unsplash.com/photo-1515471209610-dae1c92d8777?w=100&h=100&fit=crop',
  arugula: 'https://images.unsplash.com/photo-1576045057995-568f588f82fb?w=100&h=100&fit=crop',
  jalapeno: 'https://images.unsplash.com/photo-1563565375-f3fdfdbefa83?w=100&h=100&fit=crop',
  squash: 'https://images.unsplash.com/photo-1596097635121-14b63a7e0e75?w=100&h=100&fit=crop',
  salad: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=100&h=100&fit=crop',

  // === DAIRY & ALTERNATIVES - Specific first ===
  whole_milk: 'https://images.unsplash.com/photo-1563636619-e9143da7973b?w=100&h=100&fit=crop',
  skim_milk: 'https://images.unsplash.com/photo-1563636619-e9143da7973b?w=100&h=100&fit=crop',
  almond_milk: 'https://images.unsplash.com/photo-1563636619-e9143da7973b?w=100&h=100&fit=crop',
  oat_milk: 'https://images.unsplash.com/photo-1563636619-e9143da7973b?w=100&h=100&fit=crop',
  cream_cheese: 'https://images.unsplash.com/photo-1552767059-ce182ead6c1b?w=100&h=100&fit=crop',
  sour_cream: 'https://images.unsplash.com/photo-1488477181946-6428a0291777?w=100&h=100&fit=crop',
  heavy_cream: 'https://images.unsplash.com/photo-1563636619-e9143da7973b?w=100&h=100&fit=crop',
  whipped_cream: 'https://images.unsplash.com/photo-1563636619-e9143da7973b?w=100&h=100&fit=crop',
  ice_cream: 'https://images.unsplash.com/photo-1497034825429-c343d7c6a68f?w=100&h=100&fit=crop',
  coconut_yogurt: 'https://images.unsplash.com/photo-1488477181946-6428a0291777?w=100&h=100&fit=crop',
  string_cheese: 'https://images.unsplash.com/photo-1552767059-ce182ead6c1b?w=100&h=100&fit=crop',
  swiss_cheese: 'https://images.unsplash.com/photo-1552767059-ce182ead6c1b?w=100&h=100&fit=crop',
  // Generic dairy
  milk: 'https://images.unsplash.com/photo-1563636619-e9143da7973b?w=100&h=100&fit=crop',
  cheese: 'https://images.unsplash.com/photo-1486297678162-eb2a19b0a32d?w=100&h=100&fit=crop',
  cheddar: 'https://images.unsplash.com/photo-1552767059-ce182ead6c1b?w=100&h=100&fit=crop',
  mozzarella: 'https://images.unsplash.com/photo-1552767059-ce182ead6c1b?w=100&h=100&fit=crop',
  parmesan: 'https://images.unsplash.com/photo-1552767059-ce182ead6c1b?w=100&h=100&fit=crop',
  feta: 'https://images.unsplash.com/photo-1552767059-ce182ead6c1b?w=100&h=100&fit=crop',
  ricotta: 'https://images.unsplash.com/photo-1552767059-ce182ead6c1b?w=100&h=100&fit=crop',
  yogurt: 'https://images.unsplash.com/photo-1488477181946-6428a0291777?w=100&h=100&fit=crop',
  kefir: 'https://images.unsplash.com/photo-1563636619-e9143da7973b?w=100&h=100&fit=crop',
  butter: 'https://images.unsplash.com/photo-1589985270826-4b7bb135bc9d?w=100&h=100&fit=crop',
  ghee: 'https://images.unsplash.com/photo-1589985270826-4b7bb135bc9d?w=100&h=100&fit=crop',
  cream: 'https://images.unsplash.com/photo-1563636619-e9143da7973b?w=100&h=100&fit=crop',

  // === FATS, NUTS & SEEDS - Specific first ===
  peanut_butter: 'https://images.unsplash.com/photo-1558642452-9d2a7deb7f62?w=100&h=100&fit=crop',
  almond_butter: 'https://images.unsplash.com/photo-1558642452-9d2a7deb7f62?w=100&h=100&fit=crop',
  olive_oil: 'https://images.unsplash.com/photo-1474979266404-7eaacdc948b6?w=100&h=100&fit=crop',
  coconut_oil: 'https://images.unsplash.com/photo-1474979266404-7eaacdc948b6?w=100&h=100&fit=crop',
  avocado_oil: 'https://images.unsplash.com/photo-1474979266404-7eaacdc948b6?w=100&h=100&fit=crop',
  sunflower_seed: 'https://images.unsplash.com/photo-1508061253366-f7da158b6d46?w=100&h=100&fit=crop',
  pumpkin_seed: 'https://images.unsplash.com/photo-1508061253366-f7da158b6d46?w=100&h=100&fit=crop',
  flax_seed: 'https://images.unsplash.com/photo-1508061253366-f7da158b6d46?w=100&h=100&fit=crop',
  flaxseed: 'https://images.unsplash.com/photo-1508061253366-f7da158b6d46?w=100&h=100&fit=crop',
  chia_seed: 'https://images.unsplash.com/photo-1508061253366-f7da158b6d46?w=100&h=100&fit=crop',
  hemp_seed: 'https://images.unsplash.com/photo-1508061253366-f7da158b6d46?w=100&h=100&fit=crop',
  hemp_heart: 'https://images.unsplash.com/photo-1508061253366-f7da158b6d46?w=100&h=100&fit=crop',
  trail_mix: 'https://images.unsplash.com/photo-1508061253366-f7da158b6d46?w=100&h=100&fit=crop',
  mixed_nut: 'https://images.unsplash.com/photo-1508061253366-f7da158b6d46?w=100&h=100&fit=crop',
  // Generic nuts
  peanut: 'https://images.unsplash.com/photo-1566478989037-eec170784d0b?w=100&h=100&fit=crop',
  almond: 'https://images.unsplash.com/photo-1508061253366-f7da158b6d46?w=100&h=100&fit=crop',
  walnut: 'https://images.unsplash.com/photo-1508061253366-f7da158b6d46?w=100&h=100&fit=crop',
  cashew: 'https://images.unsplash.com/photo-1508061253366-f7da158b6d46?w=100&h=100&fit=crop',
  pecan: 'https://images.unsplash.com/photo-1508061253366-f7da158b6d46?w=100&h=100&fit=crop',
  pistachio: 'https://images.unsplash.com/photo-1508061253366-f7da158b6d46?w=100&h=100&fit=crop',
  macadamia: 'https://images.unsplash.com/photo-1508061253366-f7da158b6d46?w=100&h=100&fit=crop',
  chia: 'https://images.unsplash.com/photo-1508061253366-f7da158b6d46?w=100&h=100&fit=crop',
  flax: 'https://images.unsplash.com/photo-1508061253366-f7da158b6d46?w=100&h=100&fit=crop',
  seed: 'https://images.unsplash.com/photo-1508061253366-f7da158b6d46?w=100&h=100&fit=crop',
  hummus: 'https://images.unsplash.com/photo-1558642452-9d2a7deb7f62?w=100&h=100&fit=crop',
  tahini: 'https://images.unsplash.com/photo-1558642452-9d2a7deb7f62?w=100&h=100&fit=crop',
  oil: 'https://images.unsplash.com/photo-1474979266404-7eaacdc948b6?w=100&h=100&fit=crop',

  // === CONDIMENTS & SAUCES ===
  honey: 'https://images.unsplash.com/photo-1587049352846-4a222e784d38?w=100&h=100&fit=crop',
  maple_syrup: 'https://images.unsplash.com/photo-1587049352846-4a222e784d38?w=100&h=100&fit=crop',
  salsa: 'https://images.unsplash.com/photo-1558642452-9d2a7deb7f62?w=100&h=100&fit=crop',
  soy_sauce: 'https://images.unsplash.com/photo-1558642452-9d2a7deb7f62?w=100&h=100&fit=crop',
  ranch: 'https://images.unsplash.com/photo-1558642452-9d2a7deb7f62?w=100&h=100&fit=crop',
  mustard: 'https://images.unsplash.com/photo-1558642452-9d2a7deb7f62?w=100&h=100&fit=crop',
  ketchup: 'https://images.unsplash.com/photo-1558642452-9d2a7deb7f62?w=100&h=100&fit=crop',
  mayonnaise: 'https://images.unsplash.com/photo-1558642452-9d2a7deb7f62?w=100&h=100&fit=crop',
  mayo: 'https://images.unsplash.com/photo-1558642452-9d2a7deb7f62?w=100&h=100&fit=crop',
  hot_sauce: 'https://images.unsplash.com/photo-1558642452-9d2a7deb7f62?w=100&h=100&fit=crop',
  sriracha: 'https://images.unsplash.com/photo-1558642452-9d2a7deb7f62?w=100&h=100&fit=crop',
  bbq_sauce: 'https://images.unsplash.com/photo-1558642452-9d2a7deb7f62?w=100&h=100&fit=crop',
  teriyaki: 'https://images.unsplash.com/photo-1558642452-9d2a7deb7f62?w=100&h=100&fit=crop',
  pesto: 'https://images.unsplash.com/photo-1558642452-9d2a7deb7f62?w=100&h=100&fit=crop',
  guacamole: 'https://images.unsplash.com/photo-1523049673857-eb18f1d7b578?w=100&h=100&fit=crop',
  vinaigrette: 'https://images.unsplash.com/photo-1474979266404-7eaacdc948b6?w=100&h=100&fit=crop',
  balsamic: 'https://images.unsplash.com/photo-1474979266404-7eaacdc948b6?w=100&h=100&fit=crop',

  // === BEVERAGES ===
  coffee: 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=100&h=100&fit=crop',
  latte: 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=100&h=100&fit=crop',
  matcha: 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?w=100&h=100&fit=crop',
  tea: 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?w=100&h=100&fit=crop',
  chai: 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?w=100&h=100&fit=crop',
  kombucha: 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?w=100&h=100&fit=crop',
  juice: 'https://images.unsplash.com/photo-1621506289937-a8e4df240d0b?w=100&h=100&fit=crop',
  soda: 'https://images.unsplash.com/photo-1527960471264-932f39eb5846?w=100&h=100&fit=crop',
  sparkling_water: 'https://images.unsplash.com/photo-1527960471264-932f39eb5846?w=100&h=100&fit=crop',
  coconut_water: 'https://images.unsplash.com/photo-1527960471264-932f39eb5846?w=100&h=100&fit=crop',
  smoothie: 'https://images.unsplash.com/photo-1505252585461-04db1eb84625?w=100&h=100&fit=crop',
  chocolate: 'https://images.unsplash.com/photo-1481391319762-47dff72954d9?w=100&h=100&fit=crop',
  hot_chocolate: 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=100&h=100&fit=crop',
  sports_drink: 'https://images.unsplash.com/photo-1527960471264-932f39eb5846?w=100&h=100&fit=crop',
  water: 'https://images.unsplash.com/photo-1527960471264-932f39eb5846?w=100&h=100&fit=crop',

  // === PREPARED FOODS & MEALS ===
  pizza: 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=100&h=100&fit=crop',
  burger: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=100&h=100&fit=crop',
  sandwich: 'https://images.unsplash.com/photo-1528736235302-52922df5c122?w=100&h=100&fit=crop',
  wrap: 'https://images.unsplash.com/photo-1528736235302-52922df5c122?w=100&h=100&fit=crop',
  taco: 'https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=100&h=100&fit=crop',
  burrito: 'https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=100&h=100&fit=crop',
  quesadilla: 'https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=100&h=100&fit=crop',
  soup: 'https://images.unsplash.com/photo-1547592166-23ac45744acd?w=100&h=100&fit=crop',
  stew: 'https://images.unsplash.com/photo-1547592166-23ac45744acd?w=100&h=100&fit=crop',
  curry: 'https://images.unsplash.com/photo-1547592166-23ac45744acd?w=100&h=100&fit=crop',
  sushi: 'https://images.unsplash.com/photo-1579871494447-9811cf80d66c?w=100&h=100&fit=crop',
  stir_fry: 'https://images.unsplash.com/photo-1512058564366-18510be2db19?w=100&h=100&fit=crop',
  risotto: 'https://images.unsplash.com/photo-1621996346565-e3dbc646d9a9?w=100&h=100&fit=crop',
  frittata: 'https://images.unsplash.com/photo-1482049016688-2d3e1b311543?w=100&h=100&fit=crop',
  omelette: 'https://images.unsplash.com/photo-1482049016688-2d3e1b311543?w=100&h=100&fit=crop',
  french_toast: 'https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445?w=100&h=100&fit=crop',
  pho: 'https://images.unsplash.com/photo-1547592166-23ac45744acd?w=100&h=100&fit=crop',
  dal: 'https://images.unsplash.com/photo-1546549032-9571cd6b27df?w=100&h=100&fit=crop',
  bowl: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=100&h=100&fit=crop',

  // === SWEETS & SNACKS ===
  cookie: 'https://images.unsplash.com/photo-1558961363-fa8fdf82db35?w=100&h=100&fit=crop',
  brownie: 'https://images.unsplash.com/photo-1481391319762-47dff72954d9?w=100&h=100&fit=crop',
  muffin: 'https://images.unsplash.com/photo-1558961363-fa8fdf82db35?w=100&h=100&fit=crop',
  cake: 'https://images.unsplash.com/photo-1558961363-fa8fdf82db35?w=100&h=100&fit=crop',
  candy: 'https://images.unsplash.com/photo-1558961363-fa8fdf82db35?w=100&h=100&fit=crop',
  gummy: 'https://images.unsplash.com/photo-1558961363-fa8fdf82db35?w=100&h=100&fit=crop',
  chip: 'https://images.unsplash.com/photo-1558961363-fa8fdf82db35?w=100&h=100&fit=crop',
  granola_bar: 'https://images.unsplash.com/photo-1622484212850-eb596d769edc?w=100&h=100&fit=crop',
  energy_ball: 'https://images.unsplash.com/photo-1622484212850-eb596d769edc?w=100&h=100&fit=crop',
  popsicle: 'https://images.unsplash.com/photo-1497034825429-c343d7c6a68f?w=100&h=100&fit=crop',
  frozen_yogurt: 'https://images.unsplash.com/photo-1497034825429-c343d7c6a68f?w=100&h=100&fit=crop',
  graham_cracker: 'https://images.unsplash.com/photo-1558961363-fa8fdf82db35?w=100&h=100&fit=crop',
  bar: 'https://images.unsplash.com/photo-1622484212850-eb596d769edc?w=100&h=100&fit=crop',
  snack: 'https://images.unsplash.com/photo-1558961363-fa8fdf82db35?w=100&h=100&fit=crop',
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
  const lower = foodName.toLowerCase().replace(/[()]/g, '');

  // Normalize for multi-word matching: "Chicken Breast" -> also check "chicken_breast"
  const underscored = lower.replace(/\s+/g, '_');

  // Check specific compound keywords first (e.g. chicken_breast, brown_rice, greek_yogurt)
  for (const [keyword, url] of Object.entries(FOOD_PHOTOS)) {
    if (keyword.includes('_')) {
      const spaced = keyword.replace(/_/g, ' ');
      if (lower.includes(spaced) || underscored.includes(keyword)) return url;
    }
  }

  // Then check single-word keywords
  for (const [keyword, url] of Object.entries(FOOD_PHOTOS)) {
    if (!keyword.includes('_') && lower.includes(keyword)) return url;
  }

  // Check category fallbacks
  if (/chicken|beef|steak|pork|turkey|lamb|bacon|ham|sausage|bison|duck|jerky/.test(lower)) return CATEGORY_FALLBACKS.meat;
  if (/apple|banana|orange|berry|mango|grape|melon|pear|peach|kiwi|plum|fig|cherry|papaya|pineapple|coconut|lemon|lime|date|raisin|cranberr/.test(lower)) return CATEGORY_FALLBACKS.fruit;
  if (/broccoli|spinach|kale|carrot|pepper|onion|tomato|lettuce|celery|cucumber|zucchini|cauliflower|asparagus|mushroom|cabbage|eggplant|artichoke|beet|radish|squash|pea|bean/.test(lower)) return CATEGORY_FALLBACKS.vegetable;
  if (/milk|cheese|yogurt|cream|butter|ghee|kefir|ricotta|feta|mozzarella|parmesan|cheddar/.test(lower)) return CATEGORY_FALLBACKS.dairy;
  if (/rice|bread|pasta|oat|wheat|flour|cereal|tortilla|naan|quinoa|bagel|pita|granola|pancake|waffle|cracker|couscous|farro|buckwheat|muesli|pretzel/.test(lower)) return CATEGORY_FALLBACKS.grain;
  if (/bar|chip|cracker|cookie|cake|candy|snack|brownie|gummy|muffin/.test(lower)) return CATEGORY_FALLBACKS.snack;
  if (/juice|soda|water|tea|coffee|shake|smoothie|drink|latte|kombucha|matcha|chai/.test(lower)) return CATEGORY_FALLBACKS.drink;

  return CATEGORY_FALLBACKS.default;
}

export function getRecipeImageUrl(recipeName: string): string {
  const lower = recipeName.toLowerCase().replace(/[()]/g, '');
  const underscored = lower.replace(/\s+/g, '_');

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
