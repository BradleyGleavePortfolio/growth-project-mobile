import { getDatabase } from './database';
import { Recipe } from '../types';
import { generateId } from '../utils/date';

export async function searchFoods(query: string): Promise<Recipe[]> {
  const db = await getDatabase();
  return db.getAllAsync<Recipe>(
    `SELECT * FROM recipes WHERE category = 'food' AND name LIKE ? ORDER BY name ASC LIMIT 20`,
    [`%${query}%`]
  );
}

export async function getAllFoods(): Promise<Recipe[]> {
  const db = await getDatabase();
  return db.getAllAsync<Recipe>(
    `SELECT * FROM recipes WHERE category = 'food' ORDER BY name ASC`
  );
}

export async function searchRecipes(query: string): Promise<Recipe[]> {
  const db = await getDatabase();
  return db.getAllAsync<Recipe>(
    `SELECT * FROM recipes WHERE category = 'recipe' AND name LIKE ? ORDER BY name ASC LIMIT 30`,
    [`%${query}%`]
  );
}

export async function getRecipesByTag(tag: string): Promise<Recipe[]> {
  const db = await getDatabase();
  return db.getAllAsync<Recipe>(
    `SELECT * FROM recipes WHERE category = 'recipe' AND tags LIKE ? ORDER BY name ASC`,
    [`%${tag}%`]
  );
}

export async function getAllRecipes(): Promise<Recipe[]> {
  const db = await getDatabase();
  return db.getAllAsync<Recipe>(
    `SELECT * FROM recipes WHERE category = 'recipe' ORDER BY name ASC`
  );
}

export async function getRecipeById(id: string): Promise<Recipe | null> {
  const db = await getDatabase();
  return db.getFirstAsync<Recipe>(
    `SELECT * FROM recipes WHERE id = ?`,
    [id]
  );
}

export async function getRecentFoods(userId: string, limit: number = 5): Promise<{ foodName: string; calories: number; protein: number; carbs: number; fat: number; unit: string }[]> {
  const db = await getDatabase();
  return db.getAllAsync(
    `SELECT foodName, calories, protein, carbs, fat, unit FROM food_logs
     WHERE userId = ?
     GROUP BY foodName
     ORDER BY MAX(createdAt) DESC
     LIMIT ?`,
    [userId, limit]
  );
}

export async function seedFoodsIfNeeded(): Promise<void> {
  const db = await getDatabase();
  const count = await db.getFirstAsync<{ c: number }>(
    `SELECT COUNT(*) as c FROM recipes WHERE category = 'food'`
  );
  if (count && count.c >= 200) return;

  // If upgrading from old seed, delete old foods and re-seed with 200
  if (count && count.c > 0 && count.c < 200) {
    await db.runAsync(`DELETE FROM recipes WHERE category = 'food' AND isCustom = 0`);
  }

  const now = new Date().toISOString();
  const foods: { name: string; calories: number; protein: number; carbs: number; fat: number; unit: string; img: string }[] = [
    // === PROTEINS (40) ===
    { name: 'Chicken Breast (cooked, 100g)', calories: 165, protein: 31, carbs: 0, fat: 3.6, unit: '100g', img: 'https://images.unsplash.com/photo-1604503468506-a8da13d82791?w=200&h=200&fit=crop' },
    { name: 'Salmon Fillet (4 oz)', calories: 234, protein: 25, carbs: 0, fat: 14, unit: '4oz', img: 'https://images.unsplash.com/photo-1467003909585-2f8a72700288?w=200&h=200&fit=crop' },
    { name: 'Eggs (large, 1)', calories: 72, protein: 6, carbs: 0.4, fat: 5, unit: 'egg', img: 'https://images.unsplash.com/photo-1582722872445-44dc5f7e3c8f?w=200&h=200&fit=crop' },
    { name: 'Turkey Breast (3 oz)', calories: 125, protein: 26, carbs: 0, fat: 1.8, unit: '3oz', img: 'https://images.unsplash.com/photo-1574672280600-4accfa5b6f98?w=200&h=200&fit=crop' },
    { name: 'Ground Beef 90% Lean (4 oz)', calories: 200, protein: 22, carbs: 0, fat: 11, unit: '4oz', img: 'https://images.unsplash.com/photo-1588168333986-5078d3ae3976?w=200&h=200&fit=crop' },
    { name: 'Tuna (canned, 3 oz)', calories: 109, protein: 20, carbs: 0, fat: 2.5, unit: '3oz', img: 'https://images.unsplash.com/photo-1558618666-fcd25c85f82e?w=200&h=200&fit=crop' },
    { name: 'Tilapia (4 oz)', calories: 110, protein: 23, carbs: 0, fat: 2, unit: '4oz', img: 'https://images.unsplash.com/photo-1510130113581-a4e645b48b5c?w=200&h=200&fit=crop' },
    { name: 'Shrimp (3 oz)', calories: 84, protein: 18, carbs: 0.2, fat: 0.9, unit: '3oz', img: 'https://images.unsplash.com/photo-1565680018093-ebb6e4c4b211?w=200&h=200&fit=crop' },
    { name: 'Tofu Firm (4 oz)', calories: 88, protein: 10, carbs: 2, fat: 5, unit: '4oz', img: 'https://images.unsplash.com/photo-1628689469838-524a4a973b8e?w=200&h=200&fit=crop' },
    { name: 'Tempeh (3 oz)', calories: 162, protein: 15, carbs: 9, fat: 9, unit: '3oz', img: 'https://images.unsplash.com/photo-1615485290382-441e4d049cb5?w=200&h=200&fit=crop' },
    { name: 'Pork Tenderloin (4 oz)', calories: 123, protein: 22, carbs: 0, fat: 3, unit: '4oz', img: 'https://images.unsplash.com/photo-1432139555190-58524dae6a55?w=200&h=200&fit=crop' },
    { name: 'Lamb Chop (4 oz)', calories: 229, protein: 21, carbs: 0, fat: 16, unit: '4oz', img: 'https://images.unsplash.com/photo-1603048297172-c92544798d5a?w=200&h=200&fit=crop' },
    { name: 'Cod Fillet (4 oz)', calories: 93, protein: 20, carbs: 0, fat: 0.8, unit: '4oz', img: 'https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?w=200&h=200&fit=crop' },
    { name: 'Chicken Thigh (4 oz)', calories: 209, protein: 26, carbs: 0, fat: 11, unit: '4oz', img: 'https://images.unsplash.com/photo-1587593810167-a84920ea0781?w=200&h=200&fit=crop' },
    { name: 'Ground Turkey (4 oz)', calories: 170, protein: 21, carbs: 0, fat: 9, unit: '4oz', img: 'https://images.unsplash.com/photo-1602491453631-e2a5ad90a131?w=200&h=200&fit=crop' },
    { name: 'Scallops (3 oz)', calories: 75, protein: 14, carbs: 3, fat: 0.6, unit: '3oz', img: 'https://images.unsplash.com/photo-1559737558-2f5a35f4523b?w=200&h=200&fit=crop' },
    { name: 'Bison Burger (4 oz)', calories: 166, protein: 24, carbs: 0, fat: 8, unit: '4oz', img: 'https://images.unsplash.com/photo-1594212699903-ec8a3eca50f5?w=200&h=200&fit=crop' },
    { name: 'Sardines (canned, 3 oz)', calories: 177, protein: 21, carbs: 0, fat: 10, unit: '3oz', img: 'https://images.unsplash.com/photo-1599084993091-1cb5c0721cc6?w=200&h=200&fit=crop' },
    { name: 'Duck Breast (4 oz)', calories: 228, protein: 26, carbs: 0, fat: 13, unit: '4oz', img: 'https://images.unsplash.com/photo-1504472478235-9bc48ba4d60f?w=200&h=200&fit=crop' },
    { name: 'Egg Whites (3 large)', calories: 51, protein: 11, carbs: 0.7, fat: 0.2, unit: '3 whites', img: 'https://images.unsplash.com/photo-1482049016688-2d3e1b311543?w=200&h=200&fit=crop' },
    { name: 'Whey Protein Shake (1 scoop)', calories: 120, protein: 24, carbs: 3, fat: 1.5, unit: 'scoop', img: 'https://images.unsplash.com/photo-1593095948071-474c5cc2c1cf?w=200&h=200&fit=crop' },
    { name: 'Protein Bar (generic, 1 bar)', calories: 210, protein: 20, carbs: 22, fat: 7, unit: 'bar', img: 'https://images.unsplash.com/photo-1622484212850-eb596d769edc?w=200&h=200&fit=crop' },
    { name: 'Cottage Cheese (1/2 cup)', calories: 110, protein: 13, carbs: 4, fat: 5, unit: '1/2 cup', img: 'https://images.unsplash.com/photo-1488477181946-6428a0291777?w=200&h=200&fit=crop' },
    { name: 'Greek Yogurt (plain, 1 cup)', calories: 130, protein: 22, carbs: 9, fat: 0.7, unit: 'cup', img: 'https://images.unsplash.com/photo-1488477181946-6428a0291777?w=200&h=200&fit=crop' },
    { name: 'Mahi Mahi (4 oz)', calories: 93, protein: 20, carbs: 0, fat: 0.8, unit: '4oz', img: 'https://images.unsplash.com/photo-1534604973900-c43ab4c2e0ab?w=200&h=200&fit=crop' },
    { name: 'Crab Meat (3 oz)', calories: 74, protein: 15, carbs: 0, fat: 0.9, unit: '3oz', img: 'https://images.unsplash.com/photo-1559737558-2f5a35f4523b?w=200&h=200&fit=crop' },
    { name: 'Beef Jerky (1 oz)', calories: 82, protein: 14, carbs: 3, fat: 1, unit: 'oz', img: 'https://images.unsplash.com/photo-1613946069412-38f7f1ff0b65?w=200&h=200&fit=crop' },
    { name: 'Sausage (chicken, 1 link)', calories: 140, protein: 14, carbs: 2, fat: 8, unit: 'link', img: 'https://images.unsplash.com/photo-1601628828688-632f38a5a7d0?w=200&h=200&fit=crop' },
    { name: 'Ham Deli (3 oz)', calories: 90, protein: 14, carbs: 2, fat: 3, unit: '3oz', img: 'https://images.unsplash.com/photo-1529692236671-f1f6cf9683ba?w=200&h=200&fit=crop' },
    { name: 'Turkey Deli (3 oz)', calories: 80, protein: 16, carbs: 1, fat: 1, unit: '3oz', img: 'https://images.unsplash.com/photo-1574672280600-4accfa5b6f98?w=200&h=200&fit=crop' },
    { name: 'Bacon (2 slices)', calories: 86, protein: 6, carbs: 0.2, fat: 7, unit: '2 slices', img: 'https://images.unsplash.com/photo-1606851094291-6efae152bb87?w=200&h=200&fit=crop' },
    { name: 'Smoked Salmon (2 oz)', calories: 66, protein: 10, carbs: 0, fat: 2.6, unit: '2oz', img: 'https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?w=200&h=200&fit=crop' },
    { name: 'Seitan (3 oz)', calories: 120, protein: 21, carbs: 6, fat: 1, unit: '3oz', img: 'https://images.unsplash.com/photo-1628689469838-524a4a973b8e?w=200&h=200&fit=crop' },
    { name: 'Edamame (1/2 cup)', calories: 95, protein: 9, carbs: 7, fat: 4, unit: '1/2 cup', img: 'https://images.unsplash.com/photo-1615485290382-441e4d049cb5?w=200&h=200&fit=crop' },
    { name: 'Black Beans (1/2 cup)', calories: 114, protein: 8, carbs: 20, fat: 0.5, unit: '1/2 cup', img: 'https://images.unsplash.com/photo-1536304929831-ee1ca9d44906?w=200&h=200&fit=crop' },
    { name: 'Lentils (1/2 cup cooked)', calories: 115, protein: 9, carbs: 20, fat: 0.4, unit: '1/2 cup', img: 'https://images.unsplash.com/photo-1546549032-9571cd6b27df?w=200&h=200&fit=crop' },
    { name: 'Chickpeas (1/2 cup)', calories: 134, protein: 7, carbs: 22, fat: 2, unit: '1/2 cup', img: 'https://images.unsplash.com/photo-1515543904823-6b9fc67b5853?w=200&h=200&fit=crop' },
    { name: 'Kidney Beans (1/2 cup)', calories: 112, protein: 8, carbs: 20, fat: 0.4, unit: '1/2 cup', img: 'https://images.unsplash.com/photo-1536304929831-ee1ca9d44906?w=200&h=200&fit=crop' },
    { name: 'Navy Beans (1/2 cup)', calories: 127, protein: 7, carbs: 24, fat: 0.5, unit: '1/2 cup', img: 'https://images.unsplash.com/photo-1536304929831-ee1ca9d44906?w=200&h=200&fit=crop' },
    { name: 'Collagen Peptides (1 scoop)', calories: 35, protein: 9, carbs: 0, fat: 0, unit: 'scoop', img: 'https://images.unsplash.com/photo-1593095948071-474c5cc2c1cf?w=200&h=200&fit=crop' },

    // === GRAINS & CARBS (30) ===
    { name: 'Brown Rice (cooked, 1 cup)', calories: 216, protein: 5, carbs: 45, fat: 1.8, unit: 'cup', img: 'https://images.unsplash.com/photo-1586201375761-83865001e31c?w=200&h=200&fit=crop' },
    { name: 'White Rice (cooked, 1 cup)', calories: 206, protein: 4.3, carbs: 45, fat: 0.4, unit: 'cup', img: 'https://images.unsplash.com/photo-1586201375761-83865001e31c?w=200&h=200&fit=crop' },
    { name: 'Oatmeal (cooked, 1 cup)', calories: 166, protein: 6, carbs: 28, fat: 3.5, unit: 'cup', img: 'https://images.unsplash.com/photo-1517673400267-0251440c45dc?w=200&h=200&fit=crop' },
    { name: 'Quinoa (cooked, 1 cup)', calories: 222, protein: 8, carbs: 39, fat: 3.6, unit: 'cup', img: 'https://images.unsplash.com/photo-1586201375761-83865001e31c?w=200&h=200&fit=crop' },
    { name: 'Pasta (cooked, 1 cup)', calories: 220, protein: 8, carbs: 43, fat: 1.3, unit: 'cup', img: 'https://images.unsplash.com/photo-1551462147-37885acc36f1?w=200&h=200&fit=crop' },
    { name: 'Whole Wheat Bread (1 slice)', calories: 81, protein: 4, carbs: 14, fat: 1, unit: 'slice', img: 'https://images.unsplash.com/photo-1549931319-a545753467c8?w=200&h=200&fit=crop' },
    { name: 'White Bread (1 slice)', calories: 75, protein: 2.5, carbs: 14, fat: 1, unit: 'slice', img: 'https://images.unsplash.com/photo-1549931319-a545753467c8?w=200&h=200&fit=crop' },
    { name: 'Sourdough Bread (1 slice)', calories: 93, protein: 4, carbs: 18, fat: 0.6, unit: 'slice', img: 'https://images.unsplash.com/photo-1549931319-a545753467c8?w=200&h=200&fit=crop' },
    { name: 'Bagel (1 plain medium)', calories: 270, protein: 10, carbs: 53, fat: 1.5, unit: 'bagel', img: 'https://images.unsplash.com/photo-1585445490387-f47934b73b54?w=200&h=200&fit=crop' },
    { name: 'English Muffin (1)', calories: 132, protein: 5, carbs: 26, fat: 1, unit: 'muffin', img: 'https://images.unsplash.com/photo-1549931319-a545753467c8?w=200&h=200&fit=crop' },
    { name: 'Tortilla Flour (1 medium)', calories: 144, protein: 4, carbs: 24, fat: 3.5, unit: 'tortilla', img: 'https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=200&h=200&fit=crop' },
    { name: 'Corn Tortilla (2 small)', calories: 104, protein: 3, carbs: 22, fat: 1.5, unit: '2 tortillas', img: 'https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=200&h=200&fit=crop' },
    { name: 'Sweet Potato (medium)', calories: 103, protein: 2, carbs: 24, fat: 0.1, unit: 'medium', img: 'https://images.unsplash.com/photo-1596097635121-14b63a7e0e75?w=200&h=200&fit=crop' },
    { name: 'Russet Potato (medium)', calories: 168, protein: 5, carbs: 37, fat: 0.2, unit: 'medium', img: 'https://images.unsplash.com/photo-1518977676601-b53f82ber633?w=200&h=200&fit=crop' },
    { name: 'Couscous (cooked, 1 cup)', calories: 176, protein: 6, carbs: 36, fat: 0.3, unit: 'cup', img: 'https://images.unsplash.com/photo-1586201375761-83865001e31c?w=200&h=200&fit=crop' },
    { name: 'Farro (cooked, 1 cup)', calories: 200, protein: 8, carbs: 37, fat: 1.4, unit: 'cup', img: 'https://images.unsplash.com/photo-1586201375761-83865001e31c?w=200&h=200&fit=crop' },
    { name: 'Jasmine Rice (cooked, 1 cup)', calories: 213, protein: 4, carbs: 46, fat: 0.4, unit: 'cup', img: 'https://images.unsplash.com/photo-1586201375761-83865001e31c?w=200&h=200&fit=crop' },
    { name: 'Pita Bread (1 whole wheat)', calories: 170, protein: 6, carbs: 33, fat: 2, unit: 'pita', img: 'https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=200&h=200&fit=crop' },
    { name: 'Naan Bread (1 piece)', calories: 260, protein: 9, carbs: 45, fat: 5, unit: 'piece', img: 'https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=200&h=200&fit=crop' },
    { name: 'Rice Cakes (2)', calories: 70, protein: 2, carbs: 15, fat: 0.5, unit: '2 cakes', img: 'https://images.unsplash.com/photo-1586201375761-83865001e31c?w=200&h=200&fit=crop' },
    { name: 'Granola (1/4 cup)', calories: 120, protein: 3, carbs: 18, fat: 4.5, unit: '1/4 cup', img: 'https://images.unsplash.com/photo-1517673400267-0251440c45dc?w=200&h=200&fit=crop' },
    { name: 'Pancake Mix (1/3 cup dry)', calories: 160, protein: 4, carbs: 32, fat: 2, unit: '1/3 cup', img: 'https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445?w=200&h=200&fit=crop' },
    { name: 'Waffle (frozen, 1)', calories: 95, protein: 2.5, carbs: 16, fat: 3, unit: 'waffle', img: 'https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445?w=200&h=200&fit=crop' },
    { name: 'Crackers Whole Wheat (6)', calories: 120, protein: 3, carbs: 20, fat: 3.5, unit: '6 crackers', img: 'https://images.unsplash.com/photo-1558961363-fa8fdf82db35?w=200&h=200&fit=crop' },
    { name: 'Popcorn (air-popped, 3 cups)', calories: 93, protein: 3, carbs: 19, fat: 1, unit: '3 cups', img: 'https://images.unsplash.com/photo-1585735078006-6176a8917c7c?w=200&h=200&fit=crop' },
    { name: 'Pretzels (1 oz)', calories: 108, protein: 3, carbs: 23, fat: 0.8, unit: 'oz', img: 'https://images.unsplash.com/photo-1558961363-fa8fdf82db35?w=200&h=200&fit=crop' },
    { name: 'Corn on the Cob (1 ear)', calories: 88, protein: 3, carbs: 19, fat: 1.4, unit: 'ear', img: 'https://images.unsplash.com/photo-1551754655-cd27e38d2076?w=200&h=200&fit=crop' },
    { name: 'Buckwheat (cooked, 1 cup)', calories: 155, protein: 6, carbs: 33, fat: 1, unit: 'cup', img: 'https://images.unsplash.com/photo-1586201375761-83865001e31c?w=200&h=200&fit=crop' },
    { name: 'Cereal (bran flakes, 1 cup)', calories: 128, protein: 4, carbs: 31, fat: 0.7, unit: 'cup', img: 'https://images.unsplash.com/photo-1517673400267-0251440c45dc?w=200&h=200&fit=crop' },
    { name: 'Muesli (1/2 cup)', calories: 150, protein: 4, carbs: 27, fat: 4, unit: '1/2 cup', img: 'https://images.unsplash.com/photo-1517673400267-0251440c45dc?w=200&h=200&fit=crop' },

    // === FRUITS (30) ===
    { name: 'Banana (medium)', calories: 105, protein: 1.3, carbs: 27, fat: 0.4, unit: 'medium', img: 'https://images.unsplash.com/photo-1571771894821-ce9b6c11b08e?w=200&h=200&fit=crop' },
    { name: 'Apple (medium)', calories: 95, protein: 0.5, carbs: 25, fat: 0.3, unit: 'medium', img: 'https://images.unsplash.com/photo-1560806887-1e4cd0b6cbd6?w=200&h=200&fit=crop' },
    { name: 'Orange (medium)', calories: 62, protein: 1.2, carbs: 15, fat: 0.2, unit: 'medium', img: 'https://images.unsplash.com/photo-1547514701-42782101795e?w=200&h=200&fit=crop' },
    { name: 'Blueberries (1 cup)', calories: 84, protein: 1.1, carbs: 21, fat: 0.5, unit: 'cup', img: 'https://images.unsplash.com/photo-1498557850523-fd3d118b962e?w=200&h=200&fit=crop' },
    { name: 'Strawberries (1 cup)', calories: 49, protein: 1, carbs: 12, fat: 0.5, unit: 'cup', img: 'https://images.unsplash.com/photo-1464965911861-746a04b4bca6?w=200&h=200&fit=crop' },
    { name: 'Raspberries (1 cup)', calories: 64, protein: 1.5, carbs: 15, fat: 0.8, unit: 'cup', img: 'https://images.unsplash.com/photo-1577069861033-55d04cec4ef5?w=200&h=200&fit=crop' },
    { name: 'Grapes (1 cup)', calories: 104, protein: 1.1, carbs: 27, fat: 0.2, unit: 'cup', img: 'https://images.unsplash.com/photo-1537640538966-79f369143f8f?w=200&h=200&fit=crop' },
    { name: 'Watermelon (1 cup diced)', calories: 46, protein: 0.9, carbs: 12, fat: 0.2, unit: 'cup', img: 'https://images.unsplash.com/photo-1563114773-84221bd62daa?w=200&h=200&fit=crop' },
    { name: 'Pineapple (1 cup chunks)', calories: 82, protein: 0.9, carbs: 22, fat: 0.2, unit: 'cup', img: 'https://images.unsplash.com/photo-1550258987-190a2d41a8ba?w=200&h=200&fit=crop' },
    { name: 'Mango (1 cup sliced)', calories: 99, protein: 1.4, carbs: 25, fat: 0.6, unit: 'cup', img: 'https://images.unsplash.com/photo-1553279768-865429fa0078?w=200&h=200&fit=crop' },
    { name: 'Peach (medium)', calories: 59, protein: 1.4, carbs: 14, fat: 0.4, unit: 'medium', img: 'https://images.unsplash.com/photo-1595124216702-4aff11be3a00?w=200&h=200&fit=crop' },
    { name: 'Pear (medium)', calories: 101, protein: 0.7, carbs: 27, fat: 0.2, unit: 'medium', img: 'https://images.unsplash.com/photo-1514756331096-242fdeb70d4a?w=200&h=200&fit=crop' },
    { name: 'Avocado (half)', calories: 160, protein: 2, carbs: 9, fat: 15, unit: 'half', img: 'https://images.unsplash.com/photo-1523049673857-eb18f1d7b578?w=200&h=200&fit=crop' },
    { name: 'Kiwi (1 medium)', calories: 42, protein: 0.8, carbs: 10, fat: 0.4, unit: 'medium', img: 'https://images.unsplash.com/photo-1585059895524-72359e06133a?w=200&h=200&fit=crop' },
    { name: 'Grapefruit (half)', calories: 52, protein: 0.9, carbs: 13, fat: 0.2, unit: 'half', img: 'https://images.unsplash.com/photo-1577234286642-fc512a5f8f11?w=200&h=200&fit=crop' },
    { name: 'Cherries (1 cup)', calories: 87, protein: 1.5, carbs: 22, fat: 0.3, unit: 'cup', img: 'https://images.unsplash.com/photo-1528821128474-27f963b062bf?w=200&h=200&fit=crop' },
    { name: 'Cantaloupe (1 cup diced)', calories: 54, protein: 1.3, carbs: 13, fat: 0.3, unit: 'cup', img: 'https://images.unsplash.com/photo-1563114773-84221bd62daa?w=200&h=200&fit=crop' },
    { name: 'Papaya (1 cup chunks)', calories: 55, protein: 0.9, carbs: 14, fat: 0.2, unit: 'cup', img: 'https://images.unsplash.com/photo-1517282009859-f000ec3b26fe?w=200&h=200&fit=crop' },
    { name: 'Plum (1 medium)', calories: 30, protein: 0.5, carbs: 8, fat: 0.2, unit: 'medium', img: 'https://images.unsplash.com/photo-1595124216702-4aff11be3a00?w=200&h=200&fit=crop' },
    { name: 'Dried Cranberries (1/4 cup)', calories: 123, protein: 0.1, carbs: 33, fat: 0.4, unit: '1/4 cup', img: 'https://images.unsplash.com/photo-1577069861033-55d04cec4ef5?w=200&h=200&fit=crop' },
    { name: 'Raisins (1/4 cup)', calories: 130, protein: 1.3, carbs: 34, fat: 0.2, unit: '1/4 cup', img: 'https://images.unsplash.com/photo-1537640538966-79f369143f8f?w=200&h=200&fit=crop' },
    { name: 'Dates (2 medjool)', calories: 133, protein: 0.8, carbs: 36, fat: 0.1, unit: '2 dates', img: 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=200&h=200&fit=crop' },
    { name: 'Coconut (shredded, 2 tbsp)', calories: 71, protein: 0.7, carbs: 3, fat: 7, unit: '2 tbsp', img: 'https://images.unsplash.com/photo-1550258987-190a2d41a8ba?w=200&h=200&fit=crop' },
    { name: 'Lemon (1 medium)', calories: 17, protein: 0.6, carbs: 5, fat: 0.2, unit: 'medium', img: 'https://images.unsplash.com/photo-1590502593747-42a996133562?w=200&h=200&fit=crop' },
    { name: 'Lime (1 medium)', calories: 20, protein: 0.5, carbs: 7, fat: 0.1, unit: 'medium', img: 'https://images.unsplash.com/photo-1590502593747-42a996133562?w=200&h=200&fit=crop' },
    { name: 'Pomegranate Seeds (1/2 cup)', calories: 72, protein: 1.5, carbs: 16, fat: 1, unit: '1/2 cup', img: 'https://images.unsplash.com/photo-1541344999736-83eca272f6fc?w=200&h=200&fit=crop' },
    { name: 'Dried Apricots (5 pieces)', calories: 84, protein: 1, carbs: 22, fat: 0.2, unit: '5 pieces', img: 'https://images.unsplash.com/photo-1595124216702-4aff11be3a00?w=200&h=200&fit=crop' },
    { name: 'Frozen Mixed Berries (1 cup)', calories: 70, protein: 1, carbs: 17, fat: 0.5, unit: 'cup', img: 'https://images.unsplash.com/photo-1498557850523-fd3d118b962e?w=200&h=200&fit=crop' },
    { name: 'Applesauce (1/2 cup)', calories: 50, protein: 0.2, carbs: 14, fat: 0, unit: '1/2 cup', img: 'https://images.unsplash.com/photo-1560806887-1e4cd0b6cbd6?w=200&h=200&fit=crop' },
    { name: 'Plantain (1/2 cup cooked)', calories: 89, protein: 0.6, carbs: 24, fat: 0.1, unit: '1/2 cup', img: 'https://images.unsplash.com/photo-1571771894821-ce9b6c11b08e?w=200&h=200&fit=crop' },

    // === VEGETABLES (30) ===
    { name: 'Broccoli (1 cup)', calories: 55, protein: 3.7, carbs: 11, fat: 0.6, unit: 'cup', img: 'https://images.unsplash.com/photo-1459411552884-841db9b3cc2a?w=200&h=200&fit=crop' },
    { name: 'Spinach (1 cup raw)', calories: 7, protein: 0.9, carbs: 1.1, fat: 0.1, unit: 'cup', img: 'https://images.unsplash.com/photo-1576045057995-568f588f82fb?w=200&h=200&fit=crop' },
    { name: 'Kale (1 cup raw)', calories: 33, protein: 2.9, carbs: 6, fat: 0.6, unit: 'cup', img: 'https://images.unsplash.com/photo-1576045057995-568f588f82fb?w=200&h=200&fit=crop' },
    { name: 'Bell Pepper (1 medium)', calories: 31, protein: 1, carbs: 6, fat: 0.3, unit: 'medium', img: 'https://images.unsplash.com/photo-1563565375-f3fdfdbefa83?w=200&h=200&fit=crop' },
    { name: 'Tomato (1 medium)', calories: 22, protein: 1.1, carbs: 5, fat: 0.2, unit: 'medium', img: 'https://images.unsplash.com/photo-1546470427-0d4db154ceb8?w=200&h=200&fit=crop' },
    { name: 'Cucumber (1/2 medium)', calories: 8, protein: 0.3, carbs: 2, fat: 0.1, unit: '1/2 medium', img: 'https://images.unsplash.com/photo-1449300079323-02e209d9d3a6?w=200&h=200&fit=crop' },
    { name: 'Carrot (1 medium)', calories: 25, protein: 0.6, carbs: 6, fat: 0.1, unit: 'medium', img: 'https://images.unsplash.com/photo-1447175008436-054170c2e979?w=200&h=200&fit=crop' },
    { name: 'Zucchini (1 medium)', calories: 33, protein: 2.4, carbs: 6, fat: 0.6, unit: 'medium', img: 'https://images.unsplash.com/photo-1563565375-f3fdfdbefa83?w=200&h=200&fit=crop' },
    { name: 'Cauliflower (1 cup)', calories: 27, protein: 2, carbs: 5, fat: 0.3, unit: 'cup', img: 'https://images.unsplash.com/photo-1459411552884-841db9b3cc2a?w=200&h=200&fit=crop' },
    { name: 'Asparagus (6 spears)', calories: 20, protein: 2.2, carbs: 4, fat: 0.2, unit: '6 spears', img: 'https://images.unsplash.com/photo-1515471209610-dae1c92d8777?w=200&h=200&fit=crop' },
    { name: 'Green Beans (1 cup)', calories: 31, protein: 1.8, carbs: 7, fat: 0.1, unit: 'cup', img: 'https://images.unsplash.com/photo-1515471209610-dae1c92d8777?w=200&h=200&fit=crop' },
    { name: 'Brussels Sprouts (1 cup)', calories: 56, protein: 4, carbs: 11, fat: 0.8, unit: 'cup', img: 'https://images.unsplash.com/photo-1459411552884-841db9b3cc2a?w=200&h=200&fit=crop' },
    { name: 'Mushrooms (1 cup sliced)', calories: 15, protein: 2.2, carbs: 2.3, fat: 0.2, unit: 'cup', img: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=200&h=200&fit=crop' },
    { name: 'Onion (1 medium)', calories: 44, protein: 1.2, carbs: 10, fat: 0.1, unit: 'medium', img: 'https://images.unsplash.com/photo-1518977956812-cd3dbadaaf31?w=200&h=200&fit=crop' },
    { name: 'Celery (2 stalks)', calories: 13, protein: 0.6, carbs: 3, fat: 0.1, unit: '2 stalks', img: 'https://images.unsplash.com/photo-1515471209610-dae1c92d8777?w=200&h=200&fit=crop' },
    { name: 'Lettuce Romaine (2 cups)', calories: 16, protein: 1.2, carbs: 3.3, fat: 0.3, unit: '2 cups', img: 'https://images.unsplash.com/photo-1576045057995-568f588f82fb?w=200&h=200&fit=crop' },
    { name: 'Cabbage (1 cup shredded)', calories: 22, protein: 1, carbs: 5, fat: 0.1, unit: 'cup', img: 'https://images.unsplash.com/photo-1576045057995-568f588f82fb?w=200&h=200&fit=crop' },
    { name: 'Eggplant (1 cup cubed)', calories: 20, protein: 0.8, carbs: 5, fat: 0.2, unit: 'cup', img: 'https://images.unsplash.com/photo-1563565375-f3fdfdbefa83?w=200&h=200&fit=crop' },
    { name: 'Snow Peas (1 cup)', calories: 26, protein: 2, carbs: 5, fat: 0.1, unit: 'cup', img: 'https://images.unsplash.com/photo-1515471209610-dae1c92d8777?w=200&h=200&fit=crop' },
    { name: 'Artichoke (1 medium)', calories: 60, protein: 4, carbs: 13, fat: 0.2, unit: 'medium', img: 'https://images.unsplash.com/photo-1515471209610-dae1c92d8777?w=200&h=200&fit=crop' },
    { name: 'Beet (1 medium)', calories: 35, protein: 1.3, carbs: 8, fat: 0.1, unit: 'medium', img: 'https://images.unsplash.com/photo-1546470427-0d4db154ceb8?w=200&h=200&fit=crop' },
    { name: 'Radishes (5 medium)', calories: 8, protein: 0.4, carbs: 2, fat: 0.1, unit: '5 medium', img: 'https://images.unsplash.com/photo-1546470427-0d4db154ceb8?w=200&h=200&fit=crop' },
    { name: 'Butternut Squash (1 cup cubed)', calories: 63, protein: 1.4, carbs: 16, fat: 0.1, unit: 'cup', img: 'https://images.unsplash.com/photo-1596097635121-14b63a7e0e75?w=200&h=200&fit=crop' },
    { name: 'Frozen Peas (1/2 cup)', calories: 62, protein: 4, carbs: 11, fat: 0.3, unit: '1/2 cup', img: 'https://images.unsplash.com/photo-1515471209610-dae1c92d8777?w=200&h=200&fit=crop' },
    { name: 'Mixed Salad Greens (2 cups)', calories: 18, protein: 1.5, carbs: 3, fat: 0.2, unit: '2 cups', img: 'https://images.unsplash.com/photo-1576045057995-568f588f82fb?w=200&h=200&fit=crop' },
    { name: 'Cherry Tomatoes (1 cup)', calories: 27, protein: 1.3, carbs: 6, fat: 0.3, unit: 'cup', img: 'https://images.unsplash.com/photo-1546470427-0d4db154ceb8?w=200&h=200&fit=crop' },
    { name: 'Jalapeno (1 pepper)', calories: 4, protein: 0.1, carbs: 0.9, fat: 0, unit: 'pepper', img: 'https://images.unsplash.com/photo-1563565375-f3fdfdbefa83?w=200&h=200&fit=crop' },
    { name: 'Garlic (3 cloves)', calories: 13, protein: 0.6, carbs: 3, fat: 0, unit: '3 cloves', img: 'https://images.unsplash.com/photo-1518977956812-cd3dbadaaf31?w=200&h=200&fit=crop' },
    { name: 'Bok Choy (1 cup)', calories: 9, protein: 1, carbs: 1.5, fat: 0.1, unit: 'cup', img: 'https://images.unsplash.com/photo-1576045057995-568f588f82fb?w=200&h=200&fit=crop' },
    { name: 'Arugula (1 cup)', calories: 5, protein: 0.5, carbs: 0.7, fat: 0.1, unit: 'cup', img: 'https://images.unsplash.com/photo-1576045057995-568f588f82fb?w=200&h=200&fit=crop' },

    // === DAIRY & ALTERNATIVES (20) ===
    { name: 'Milk (whole, 1 cup)', calories: 149, protein: 8, carbs: 12, fat: 8, unit: 'cup', img: 'https://images.unsplash.com/photo-1563636619-e9143da7973b?w=200&h=200&fit=crop' },
    { name: 'Milk (2%, 1 cup)', calories: 122, protein: 8, carbs: 12, fat: 5, unit: 'cup', img: 'https://images.unsplash.com/photo-1563636619-e9143da7973b?w=200&h=200&fit=crop' },
    { name: 'Skim Milk (1 cup)', calories: 83, protein: 8, carbs: 12, fat: 0.2, unit: 'cup', img: 'https://images.unsplash.com/photo-1563636619-e9143da7973b?w=200&h=200&fit=crop' },
    { name: 'Almond Milk (unsweetened, 1 cup)', calories: 30, protein: 1, carbs: 1, fat: 2.5, unit: 'cup', img: 'https://images.unsplash.com/photo-1563636619-e9143da7973b?w=200&h=200&fit=crop' },
    { name: 'Oat Milk (1 cup)', calories: 120, protein: 3, carbs: 16, fat: 5, unit: 'cup', img: 'https://images.unsplash.com/photo-1563636619-e9143da7973b?w=200&h=200&fit=crop' },
    { name: 'Cheddar Cheese (1 oz)', calories: 113, protein: 7, carbs: 0.4, fat: 9, unit: 'oz', img: 'https://images.unsplash.com/photo-1552767059-ce182ead6c1b?w=200&h=200&fit=crop' },
    { name: 'Mozzarella (1 oz)', calories: 85, protein: 6, carbs: 0.7, fat: 6, unit: 'oz', img: 'https://images.unsplash.com/photo-1552767059-ce182ead6c1b?w=200&h=200&fit=crop' },
    { name: 'Parmesan (2 tbsp grated)', calories: 43, protein: 4, carbs: 0.4, fat: 3, unit: '2 tbsp', img: 'https://images.unsplash.com/photo-1552767059-ce182ead6c1b?w=200&h=200&fit=crop' },
    { name: 'Cream Cheese (2 tbsp)', calories: 100, protein: 2, carbs: 1, fat: 10, unit: '2 tbsp', img: 'https://images.unsplash.com/photo-1552767059-ce182ead6c1b?w=200&h=200&fit=crop' },
    { name: 'Feta Cheese (1 oz)', calories: 75, protein: 4, carbs: 1.2, fat: 6, unit: 'oz', img: 'https://images.unsplash.com/photo-1552767059-ce182ead6c1b?w=200&h=200&fit=crop' },
    { name: 'Ricotta Cheese (1/4 cup)', calories: 86, protein: 7, carbs: 2, fat: 6, unit: '1/4 cup', img: 'https://images.unsplash.com/photo-1552767059-ce182ead6c1b?w=200&h=200&fit=crop' },
    { name: 'Swiss Cheese (1 oz)', calories: 106, protein: 8, carbs: 1.5, fat: 8, unit: 'oz', img: 'https://images.unsplash.com/photo-1552767059-ce182ead6c1b?w=200&h=200&fit=crop' },
    { name: 'String Cheese (1 stick)', calories: 80, protein: 7, carbs: 1, fat: 6, unit: 'stick', img: 'https://images.unsplash.com/photo-1552767059-ce182ead6c1b?w=200&h=200&fit=crop' },
    { name: 'Sour Cream (2 tbsp)', calories: 60, protein: 0.7, carbs: 1, fat: 6, unit: '2 tbsp', img: 'https://images.unsplash.com/photo-1488477181946-6428a0291777?w=200&h=200&fit=crop' },
    { name: 'Heavy Cream (1 tbsp)', calories: 51, protein: 0.4, carbs: 0.4, fat: 5.4, unit: 'tbsp', img: 'https://images.unsplash.com/photo-1563636619-e9143da7973b?w=200&h=200&fit=crop' },
    { name: 'Butter (1 tbsp)', calories: 102, protein: 0.1, carbs: 0, fat: 12, unit: 'tbsp', img: 'https://images.unsplash.com/photo-1589985270826-4b7bb135bc9d?w=200&h=200&fit=crop' },
    { name: 'Yogurt (flavored, 6 oz)', calories: 150, protein: 6, carbs: 28, fat: 1.5, unit: '6oz', img: 'https://images.unsplash.com/photo-1488477181946-6428a0291777?w=200&h=200&fit=crop' },
    { name: 'Kefir (1 cup)', calories: 104, protein: 9, carbs: 12, fat: 2, unit: 'cup', img: 'https://images.unsplash.com/photo-1563636619-e9143da7973b?w=200&h=200&fit=crop' },
    { name: 'Coconut Yogurt (3/4 cup)', calories: 140, protein: 1, carbs: 18, fat: 7, unit: '3/4 cup', img: 'https://images.unsplash.com/photo-1488477181946-6428a0291777?w=200&h=200&fit=crop' },
    { name: 'Ghee (1 tbsp)', calories: 112, protein: 0, carbs: 0, fat: 13, unit: 'tbsp', img: 'https://images.unsplash.com/photo-1589985270826-4b7bb135bc9d?w=200&h=200&fit=crop' },

    // === NUTS, SEEDS & FATS (20) ===
    { name: 'Almonds (1 oz)', calories: 164, protein: 6, carbs: 6, fat: 14, unit: 'oz', img: 'https://images.unsplash.com/photo-1508061253366-f7da158b6d46?w=200&h=200&fit=crop' },
    { name: 'Walnuts (1 oz)', calories: 185, protein: 4.3, carbs: 4, fat: 18, unit: 'oz', img: 'https://images.unsplash.com/photo-1508061253366-f7da158b6d46?w=200&h=200&fit=crop' },
    { name: 'Cashews (1 oz)', calories: 157, protein: 5, carbs: 9, fat: 12, unit: 'oz', img: 'https://images.unsplash.com/photo-1508061253366-f7da158b6d46?w=200&h=200&fit=crop' },
    { name: 'Peanuts (1 oz)', calories: 161, protein: 7, carbs: 5, fat: 14, unit: 'oz', img: 'https://images.unsplash.com/photo-1508061253366-f7da158b6d46?w=200&h=200&fit=crop' },
    { name: 'Pecans (1 oz)', calories: 196, protein: 2.6, carbs: 4, fat: 20, unit: 'oz', img: 'https://images.unsplash.com/photo-1508061253366-f7da158b6d46?w=200&h=200&fit=crop' },
    { name: 'Pistachios (1 oz)', calories: 159, protein: 6, carbs: 8, fat: 13, unit: 'oz', img: 'https://images.unsplash.com/photo-1508061253366-f7da158b6d46?w=200&h=200&fit=crop' },
    { name: 'Macadamia Nuts (1 oz)', calories: 204, protein: 2.2, carbs: 4, fat: 22, unit: 'oz', img: 'https://images.unsplash.com/photo-1508061253366-f7da158b6d46?w=200&h=200&fit=crop' },
    { name: 'Peanut Butter (2 tbsp)', calories: 188, protein: 8, carbs: 6, fat: 16, unit: '2 tbsp', img: 'https://images.unsplash.com/photo-1558642452-9d2a7deb7f62?w=200&h=200&fit=crop' },
    { name: 'Almond Butter (2 tbsp)', calories: 196, protein: 7, carbs: 6, fat: 18, unit: '2 tbsp', img: 'https://images.unsplash.com/photo-1558642452-9d2a7deb7f62?w=200&h=200&fit=crop' },
    { name: 'Chia Seeds (1 tbsp)', calories: 58, protein: 2, carbs: 5, fat: 4, unit: 'tbsp', img: 'https://images.unsplash.com/photo-1508061253366-f7da158b6d46?w=200&h=200&fit=crop' },
    { name: 'Flax Seeds (1 tbsp)', calories: 55, protein: 2, carbs: 3, fat: 4.3, unit: 'tbsp', img: 'https://images.unsplash.com/photo-1508061253366-f7da158b6d46?w=200&h=200&fit=crop' },
    { name: 'Pumpkin Seeds (1 oz)', calories: 151, protein: 7, carbs: 5, fat: 13, unit: 'oz', img: 'https://images.unsplash.com/photo-1508061253366-f7da158b6d46?w=200&h=200&fit=crop' },
    { name: 'Sunflower Seeds (1 oz)', calories: 165, protein: 5.5, carbs: 7, fat: 14, unit: 'oz', img: 'https://images.unsplash.com/photo-1508061253366-f7da158b6d46?w=200&h=200&fit=crop' },
    { name: 'Hemp Hearts (2 tbsp)', calories: 113, protein: 7, carbs: 2, fat: 10, unit: '2 tbsp', img: 'https://images.unsplash.com/photo-1508061253366-f7da158b6d46?w=200&h=200&fit=crop' },
    { name: 'Olive Oil (1 tbsp)', calories: 119, protein: 0, carbs: 0, fat: 14, unit: 'tbsp', img: 'https://images.unsplash.com/photo-1474979266404-7eaacdc948b6?w=200&h=200&fit=crop' },
    { name: 'Coconut Oil (1 tbsp)', calories: 121, protein: 0, carbs: 0, fat: 14, unit: 'tbsp', img: 'https://images.unsplash.com/photo-1474979266404-7eaacdc948b6?w=200&h=200&fit=crop' },
    { name: 'Avocado Oil (1 tbsp)', calories: 124, protein: 0, carbs: 0, fat: 14, unit: 'tbsp', img: 'https://images.unsplash.com/photo-1474979266404-7eaacdc948b6?w=200&h=200&fit=crop' },
    { name: 'Hummus (2 tbsp)', calories: 70, protein: 2, carbs: 6, fat: 5, unit: '2 tbsp', img: 'https://images.unsplash.com/photo-1558642452-9d2a7deb7f62?w=200&h=200&fit=crop' },
    { name: 'Tahini (1 tbsp)', calories: 89, protein: 3, carbs: 3, fat: 8, unit: 'tbsp', img: 'https://images.unsplash.com/photo-1558642452-9d2a7deb7f62?w=200&h=200&fit=crop' },
    { name: 'Mixed Nuts (1 oz)', calories: 172, protein: 5, carbs: 6, fat: 15, unit: 'oz', img: 'https://images.unsplash.com/photo-1508061253366-f7da158b6d46?w=200&h=200&fit=crop' },

    // === CONDIMENTS & SAUCES (15) ===
    { name: 'Honey (1 tbsp)', calories: 64, protein: 0.1, carbs: 17, fat: 0, unit: 'tbsp', img: 'https://images.unsplash.com/photo-1587049352846-4a222e784d38?w=200&h=200&fit=crop' },
    { name: 'Maple Syrup (1 tbsp)', calories: 52, protein: 0, carbs: 13, fat: 0, unit: 'tbsp', img: 'https://images.unsplash.com/photo-1587049352846-4a222e784d38?w=200&h=200&fit=crop' },
    { name: 'Salsa (2 tbsp)', calories: 10, protein: 0.5, carbs: 2, fat: 0, unit: '2 tbsp', img: 'https://images.unsplash.com/photo-1558642452-9d2a7deb7f62?w=200&h=200&fit=crop' },
    { name: 'Soy Sauce (1 tbsp)', calories: 9, protein: 1, carbs: 1, fat: 0, unit: 'tbsp', img: 'https://images.unsplash.com/photo-1558642452-9d2a7deb7f62?w=200&h=200&fit=crop' },
    { name: 'Ranch Dressing (2 tbsp)', calories: 129, protein: 0.4, carbs: 2, fat: 13, unit: '2 tbsp', img: 'https://images.unsplash.com/photo-1558642452-9d2a7deb7f62?w=200&h=200&fit=crop' },
    { name: 'Balsamic Vinaigrette (2 tbsp)', calories: 90, protein: 0, carbs: 4, fat: 8, unit: '2 tbsp', img: 'https://images.unsplash.com/photo-1474979266404-7eaacdc948b6?w=200&h=200&fit=crop' },
    { name: 'Mustard (1 tbsp)', calories: 10, protein: 0.7, carbs: 0.6, fat: 0.7, unit: 'tbsp', img: 'https://images.unsplash.com/photo-1558642452-9d2a7deb7f62?w=200&h=200&fit=crop' },
    { name: 'Ketchup (1 tbsp)', calories: 20, protein: 0.2, carbs: 5, fat: 0, unit: 'tbsp', img: 'https://images.unsplash.com/photo-1558642452-9d2a7deb7f62?w=200&h=200&fit=crop' },
    { name: 'Mayonnaise (1 tbsp)', calories: 94, protein: 0.1, carbs: 0.1, fat: 10, unit: 'tbsp', img: 'https://images.unsplash.com/photo-1558642452-9d2a7deb7f62?w=200&h=200&fit=crop' },
    { name: 'Hot Sauce (1 tsp)', calories: 1, protein: 0, carbs: 0, fat: 0, unit: 'tsp', img: 'https://images.unsplash.com/photo-1558642452-9d2a7deb7f62?w=200&h=200&fit=crop' },
    { name: 'BBQ Sauce (2 tbsp)', calories: 70, protein: 0, carbs: 17, fat: 0, unit: '2 tbsp', img: 'https://images.unsplash.com/photo-1558642452-9d2a7deb7f62?w=200&h=200&fit=crop' },
    { name: 'Teriyaki Sauce (2 tbsp)', calories: 60, protein: 2, carbs: 13, fat: 0, unit: '2 tbsp', img: 'https://images.unsplash.com/photo-1558642452-9d2a7deb7f62?w=200&h=200&fit=crop' },
    { name: 'Pesto Sauce (2 tbsp)', calories: 160, protein: 3, carbs: 2, fat: 15, unit: '2 tbsp', img: 'https://images.unsplash.com/photo-1558642452-9d2a7deb7f62?w=200&h=200&fit=crop' },
    { name: 'Guacamole (2 tbsp)', calories: 50, protein: 0.6, carbs: 3, fat: 4.5, unit: '2 tbsp', img: 'https://images.unsplash.com/photo-1523049673857-eb18f1d7b578?w=200&h=200&fit=crop' },
    { name: 'Sriracha (1 tsp)', calories: 5, protein: 0.1, carbs: 1, fat: 0, unit: 'tsp', img: 'https://images.unsplash.com/photo-1558642452-9d2a7deb7f62?w=200&h=200&fit=crop' },

    // === BEVERAGES (15) ===
    { name: 'Coffee Black (8 fl oz)', calories: 2, protein: 0.3, carbs: 0, fat: 0, unit: '8oz', img: 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=200&h=200&fit=crop' },
    { name: 'Green Tea (8 fl oz)', calories: 2, protein: 0.5, carbs: 0, fat: 0, unit: '8oz', img: 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?w=200&h=200&fit=crop' },
    { name: 'Orange Juice (8 fl oz)', calories: 112, protein: 2, carbs: 26, fat: 0.5, unit: '8oz', img: 'https://images.unsplash.com/photo-1621506289937-a8e4df240d0b?w=200&h=200&fit=crop' },
    { name: 'Diet Soda (12 fl oz)', calories: 0, protein: 0, carbs: 0, fat: 0, unit: '12oz', img: 'https://images.unsplash.com/photo-1527960471264-932f39eb5846?w=200&h=200&fit=crop' },
    { name: 'Sparkling Water (12 fl oz)', calories: 0, protein: 0, carbs: 0, fat: 0, unit: '12oz', img: 'https://images.unsplash.com/photo-1527960471264-932f39eb5846?w=200&h=200&fit=crop' },
    { name: 'Coconut Water (8 fl oz)', calories: 46, protein: 2, carbs: 9, fat: 0.5, unit: '8oz', img: 'https://images.unsplash.com/photo-1527960471264-932f39eb5846?w=200&h=200&fit=crop' },
    { name: 'Apple Juice (8 fl oz)', calories: 114, protein: 0.3, carbs: 28, fat: 0.3, unit: '8oz', img: 'https://images.unsplash.com/photo-1621506289937-a8e4df240d0b?w=200&h=200&fit=crop' },
    { name: 'Protein Smoothie (12 fl oz)', calories: 250, protein: 25, carbs: 30, fat: 5, unit: '12oz', img: 'https://images.unsplash.com/photo-1505252585461-04db1eb84625?w=200&h=200&fit=crop' },
    { name: 'Latte with Milk (12 fl oz)', calories: 150, protein: 10, carbs: 15, fat: 6, unit: '12oz', img: 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=200&h=200&fit=crop' },
    { name: 'Chai Tea Latte (12 fl oz)', calories: 190, protein: 6, carbs: 34, fat: 4, unit: '12oz', img: 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?w=200&h=200&fit=crop' },
    { name: 'Sports Drink (20 fl oz)', calories: 140, protein: 0, carbs: 36, fat: 0, unit: '20oz', img: 'https://images.unsplash.com/photo-1527960471264-932f39eb5846?w=200&h=200&fit=crop' },
    { name: 'Kombucha (8 fl oz)', calories: 30, protein: 0, carbs: 7, fat: 0, unit: '8oz', img: 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?w=200&h=200&fit=crop' },
    { name: 'Cranberry Juice (8 fl oz)', calories: 116, protein: 0, carbs: 31, fat: 0.1, unit: '8oz', img: 'https://images.unsplash.com/photo-1621506289937-a8e4df240d0b?w=200&h=200&fit=crop' },
    { name: 'Hot Chocolate (8 fl oz)', calories: 190, protein: 2, carbs: 27, fat: 8, unit: '8oz', img: 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=200&h=200&fit=crop' },
    { name: 'Matcha Latte (12 fl oz)', calories: 120, protein: 4, carbs: 20, fat: 3, unit: '12oz', img: 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?w=200&h=200&fit=crop' },

    // === SWEETS & SNACKS (20) ===
    { name: 'Dark Chocolate (1 oz)', calories: 155, protein: 2, carbs: 17, fat: 9, unit: 'oz', img: 'https://images.unsplash.com/photo-1481391319762-47dff72954d9?w=200&h=200&fit=crop' },
    { name: 'Milk Chocolate (1 oz)', calories: 150, protein: 2, carbs: 17, fat: 9, unit: 'oz', img: 'https://images.unsplash.com/photo-1481391319762-47dff72954d9?w=200&h=200&fit=crop' },
    { name: 'Ice Cream (1/2 cup)', calories: 137, protein: 2.3, carbs: 16, fat: 7, unit: '1/2 cup', img: 'https://images.unsplash.com/photo-1497034825429-c343d7c6a68f?w=200&h=200&fit=crop' },
    { name: 'Frozen Yogurt (1/2 cup)', calories: 114, protein: 3, carbs: 22, fat: 2, unit: '1/2 cup', img: 'https://images.unsplash.com/photo-1497034825429-c343d7c6a68f?w=200&h=200&fit=crop' },
    { name: 'Granola Bar (1 bar)', calories: 140, protein: 3, carbs: 24, fat: 5, unit: 'bar', img: 'https://images.unsplash.com/photo-1622484212850-eb596d769edc?w=200&h=200&fit=crop' },
    { name: 'Trail Mix (1/4 cup)', calories: 175, protein: 5, carbs: 15, fat: 12, unit: '1/4 cup', img: 'https://images.unsplash.com/photo-1508061253366-f7da158b6d46?w=200&h=200&fit=crop' },
    { name: 'Chips (tortilla, 1 oz)', calories: 140, protein: 2, carbs: 18, fat: 7, unit: 'oz', img: 'https://images.unsplash.com/photo-1558961363-fa8fdf82db35?w=200&h=200&fit=crop' },
    { name: 'Chips (potato, 1 oz)', calories: 152, protein: 2, carbs: 15, fat: 10, unit: 'oz', img: 'https://images.unsplash.com/photo-1558961363-fa8fdf82db35?w=200&h=200&fit=crop' },
    { name: 'Cookie (chocolate chip, 1)', calories: 140, protein: 1.5, carbs: 20, fat: 7, unit: 'cookie', img: 'https://images.unsplash.com/photo-1558961363-fa8fdf82db35?w=200&h=200&fit=crop' },
    { name: 'Brownie (1 small)', calories: 160, protein: 2, carbs: 24, fat: 7, unit: 'brownie', img: 'https://images.unsplash.com/photo-1481391319762-47dff72954d9?w=200&h=200&fit=crop' },
    { name: 'Muffin (blueberry, 1 small)', calories: 195, protein: 3, carbs: 33, fat: 6, unit: 'muffin', img: 'https://images.unsplash.com/photo-1558961363-fa8fdf82db35?w=200&h=200&fit=crop' },
    { name: 'Energy Bites (2)', calories: 120, protein: 4, carbs: 16, fat: 5, unit: '2 bites', img: 'https://images.unsplash.com/photo-1622484212850-eb596d769edc?w=200&h=200&fit=crop' },
    { name: 'Rice Krispie Treat (1)', calories: 90, protein: 1, carbs: 18, fat: 2, unit: 'treat', img: 'https://images.unsplash.com/photo-1558961363-fa8fdf82db35?w=200&h=200&fit=crop' },
    { name: 'Banana Chips (1 oz)', calories: 147, protein: 0.6, carbs: 17, fat: 10, unit: 'oz', img: 'https://images.unsplash.com/photo-1558961363-fa8fdf82db35?w=200&h=200&fit=crop' },
    { name: 'Fruit Snacks (1 pouch)', calories: 80, protein: 0, carbs: 20, fat: 0, unit: 'pouch', img: 'https://images.unsplash.com/photo-1558961363-fa8fdf82db35?w=200&h=200&fit=crop' },
    { name: 'Graham Crackers (2 sheets)', calories: 130, protein: 2, carbs: 24, fat: 3, unit: '2 sheets', img: 'https://images.unsplash.com/photo-1558961363-fa8fdf82db35?w=200&h=200&fit=crop' },
    { name: 'Popsicle (fruit, 1)', calories: 40, protein: 0, carbs: 10, fat: 0, unit: 'popsicle', img: 'https://images.unsplash.com/photo-1497034825429-c343d7c6a68f?w=200&h=200&fit=crop' },
    { name: 'Gummy Bears (17 pieces)', calories: 130, protein: 3, carbs: 30, fat: 0, unit: '17 pieces', img: 'https://images.unsplash.com/photo-1558961363-fa8fdf82db35?w=200&h=200&fit=crop' },
    { name: 'Dried Mango (1/4 cup)', calories: 128, protein: 0.5, carbs: 32, fat: 0.2, unit: '1/4 cup', img: 'https://images.unsplash.com/photo-1553279768-865429fa0078?w=200&h=200&fit=crop' },
    { name: 'Beef Stick (1)', calories: 80, protein: 7, carbs: 1, fat: 5, unit: 'stick', img: 'https://images.unsplash.com/photo-1613946069412-38f7f1ff0b65?w=200&h=200&fit=crop' },
  ];

  for (const f of foods) {
    const id = 'food_' + generateId();
    await db.runAsync(
      `INSERT INTO recipes (id, name, category, calories, protein, carbs, fat, servings, ingredients, instructions, tags, isCustom, imageUrl, createdAt)
       VALUES (?, ?, 'food', ?, ?, ?, ?, 1, '[]', '', '[]', 0, ?, ?)`,
      [id, f.name, f.calories, f.protein, f.carbs, f.fat, f.img, now]
    );
  }
}

export async function seedRecipesIfNeeded(): Promise<void> {
  const db = await getDatabase();
  const count = await db.getFirstAsync<{ c: number }>(
    `SELECT COUNT(*) as c FROM recipes WHERE category = 'recipe'`
  );
  // Re-seed if fewer than 20 recipes (handles wiped or partially-seeded DB)
  if (count && count.c >= 20) return;

  // Clear any partial data before re-seeding
  if (count && count.c > 0 && count.c < 20) {
    await db.runAsync(`DELETE FROM recipes WHERE category = 'recipe' AND isCustom = 0`);
  }

  const now = new Date().toISOString();

  interface RecipeSeed {
    name: string;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    servings: number;
    ingredients: string[];
    instructions: string;
    tags: string[];
  }

  const recipes: RecipeSeed[] = [
    // High-protein meals (20)
    { name: 'Grilled Chicken & Broccoli', calories: 380, protein: 42, carbs: 12, fat: 16, servings: 1, ingredients: ['8oz chicken breast', '2 cups broccoli', '1 tbsp olive oil', 'Garlic', 'Salt & pepper'], instructions: '1. Season chicken with garlic, salt and pepper.\n2. Grill chicken 6-7 min per side.\n3. Steam broccoli until tender.\n4. Drizzle with olive oil.', tags: ['high-protein', 'dinner', 'lunch', 'img:grilled-chicken-broccoli'] },
    { name: 'Salmon with Asparagus', calories: 420, protein: 38, carbs: 8, fat: 26, servings: 1, ingredients: ['6oz salmon fillet', '1 bunch asparagus', '1 tbsp olive oil', 'Lemon', 'Dill'], instructions: '1. Preheat oven to 400F.\n2. Season salmon with dill and lemon.\n3. Toss asparagus with olive oil.\n4. Bake 12-15 minutes.', tags: ['high-protein', 'dinner', 'low-carb', 'img:salmon-asparagus'] },
    { name: 'Turkey Meatballs', calories: 340, protein: 36, carbs: 14, fat: 15, servings: 4, ingredients: ['1lb ground turkey', '1/2 cup breadcrumbs', '1 egg', 'Garlic', 'Italian seasoning', 'Marinara sauce'], instructions: '1. Mix turkey, breadcrumbs, egg and spices.\n2. Form into 12 balls.\n3. Bake at 400F for 20 min.\n4. Serve with marinara.', tags: ['high-protein', 'dinner', 'international', 'img:turkey-meatballs'] },
    { name: 'Beef Stir Fry', calories: 410, protein: 35, carbs: 22, fat: 20, servings: 2, ingredients: ['12oz flank steak', '2 cups mixed veggies', '2 tbsp soy sauce', '1 tbsp sesame oil', 'Ginger', 'Garlic'], instructions: '1. Slice beef thinly.\n2. Heat sesame oil in wok.\n3. Stir-fry beef 3 min.\n4. Add veggies and soy sauce.\n5. Cook 5 min more.', tags: ['high-protein', 'dinner', 'quick', 'img:beef-stir-fry'] },
    { name: 'Shrimp Tacos', calories: 320, protein: 30, carbs: 28, fat: 10, servings: 2, ingredients: ['1lb shrimp', '6 corn tortillas', '1 avocado', 'Lime', 'Cilantro', 'Cabbage slaw'], instructions: '1. Season shrimp with chili powder.\n2. Sear shrimp 2 min per side.\n3. Warm tortillas.\n4. Top with slaw and avocado.', tags: ['high-protein', 'dinner', 'quick', 'img:shrimp-tacos'] },
    { name: 'Chicken Caesar Salad', calories: 360, protein: 38, carbs: 12, fat: 18, servings: 1, ingredients: ['6oz grilled chicken', 'Romaine lettuce', '2 tbsp Caesar dressing', 'Parmesan', 'Croutons'], instructions: '1. Chop romaine.\n2. Slice grilled chicken.\n3. Toss with dressing.\n4. Top with parmesan and croutons.', tags: ['high-protein', 'lunch', 'img:chicken-caesar-salad'] },
    { name: 'Tuna Poke Bowl', calories: 390, protein: 32, carbs: 42, fat: 10, servings: 1, ingredients: ['6oz sushi-grade tuna', '1 cup sushi rice', 'Edamame', 'Avocado', 'Soy sauce', 'Sesame seeds'], instructions: '1. Cook sushi rice.\n2. Cube tuna.\n3. Arrange rice, tuna, edamame and avocado.\n4. Drizzle with soy sauce.', tags: ['high-protein', 'lunch', 'img:tuna-poke-bowl'] },
    { name: 'Protein Pancakes', calories: 310, protein: 30, carbs: 28, fat: 8, servings: 3, ingredients: ['1 scoop whey protein', '1/2 cup oats', '1 banana', '2 egg whites', '1/2 tsp baking powder'], instructions: '1. Blend all ingredients.\n2. Cook on griddle 2-3 min per side.\n3. Serve with berries.', tags: ['high-protein', 'breakfast', 'img:protein-pancakes'] },
    { name: 'Egg White Omelette', calories: 220, protein: 28, carbs: 6, fat: 9, servings: 1, ingredients: ['6 egg whites', '1/4 cup spinach', '1/4 cup mushrooms', '1oz feta cheese', 'Salt & pepper'], instructions: '1. Whisk egg whites.\n2. Sauté veggies.\n3. Pour eggs, cook 3 min.\n4. Add feta, fold and serve.', tags: ['high-protein', 'breakfast', 'low-carb', 'img:egg-white-omelette'] },
    { name: 'Lean Burger Lettuce Wrap', calories: 350, protein: 34, carbs: 5, fat: 22, servings: 1, ingredients: ['6oz 93% lean ground beef', 'Butter lettuce leaves', 'Tomato', 'Onion', 'Mustard', 'Pickles'], instructions: '1. Form patty, season well.\n2. Grill 4 min per side.\n3. Wrap in lettuce with toppings.', tags: ['high-protein', 'lunch', 'low-carb', 'img:lettuce-wrap-burger'] },
    { name: 'Chicken Thigh with Sweet Potato', calories: 440, protein: 35, carbs: 38, fat: 16, servings: 1, ingredients: ['6oz chicken thigh boneless', '1 medium sweet potato', '1 tbsp olive oil', 'Paprika', 'Garlic powder'], instructions: '1. Season chicken with paprika and garlic.\n2. Bake at 400F for 25 min.\n3. Cube and roast sweet potato alongside.', tags: ['high-protein', 'dinner', 'img:chicken-sweet-potato'] },
    { name: 'Cottage Cheese Power Bowl', calories: 280, protein: 30, carbs: 22, fat: 8, servings: 1, ingredients: ['1 cup cottage cheese', '1/2 cup blueberries', '2 tbsp honey', '1/4 cup granola', 'Chia seeds'], instructions: '1. Scoop cottage cheese into bowl.\n2. Top with berries, granola and chia.\n3. Drizzle honey.', tags: ['high-protein', 'breakfast', 'snack', 'img:cottage-cheese-bowl'] },
    { name: 'Baked Cod with Veggies', calories: 290, protein: 34, carbs: 15, fat: 10, servings: 1, ingredients: ['6oz cod fillet', 'Zucchini', 'Cherry tomatoes', '1 tbsp olive oil', 'Lemon', 'Herbs'], instructions: '1. Preheat oven to 375F.\n2. Place cod and veggies on sheet pan.\n3. Season and drizzle oil.\n4. Bake 15 min.', tags: ['high-protein', 'dinner', 'low-carb', 'img:baked-cod-vegetables'] },
    { name: 'Greek Chicken Bowl', calories: 450, protein: 40, carbs: 30, fat: 18, servings: 1, ingredients: ['6oz chicken breast', '1/2 cup rice', 'Cucumber', 'Tomato', 'Feta', 'Tzatziki', 'Olives'], instructions: '1. Grill chicken with oregano.\n2. Cook rice.\n3. Dice veggies.\n4. Assemble bowl with tzatziki.', tags: ['high-protein', 'lunch', 'dinner', 'international', 'img:greek-chicken-bowl'] },
    { name: 'Steak & Eggs', calories: 480, protein: 44, carbs: 2, fat: 32, servings: 1, ingredients: ['6oz sirloin steak', '3 eggs', '1 tbsp butter', 'Salt & pepper'], instructions: '1. Season steak.\n2. Pan-sear 4 min per side.\n3. Fry eggs in butter.\n4. Rest steak, then serve.', tags: ['high-protein', 'breakfast', 'low-carb', 'img:steak-and-eggs'] },
    { name: 'Chicken Burrito Bowl', calories: 470, protein: 38, carbs: 42, fat: 16, servings: 1, ingredients: ['6oz chicken', '1/2 cup rice', 'Black beans', 'Corn', 'Salsa', 'Cheese', 'Lettuce'], instructions: '1. Season and grill chicken.\n2. Cook rice.\n3. Layer all ingredients in bowl.\n4. Top with salsa and cheese.', tags: ['high-protein', 'lunch', 'dinner', 'img:chicken-burrito-bowl'] },
    { name: 'Tofu Scramble', calories: 250, protein: 22, carbs: 10, fat: 14, servings: 1, ingredients: ['1 block firm tofu', 'Bell pepper', 'Onion', 'Turmeric', 'Nutritional yeast', 'Spinach'], instructions: '1. Crumble tofu.\n2. Sauté veggies.\n3. Add tofu and turmeric.\n4. Cook 5 min, add spinach.', tags: ['high-protein', 'breakfast', 'vegetarian', 'img:tofu-scramble'] },
    { name: 'BBQ Chicken Breast', calories: 360, protein: 42, carbs: 16, fat: 12, servings: 1, ingredients: ['8oz chicken breast', '2 tbsp BBQ sauce', 'Coleslaw', 'Pickles'], instructions: '1. Grill chicken until cooked.\n2. Brush with BBQ sauce.\n3. Grill 1 more minute.\n4. Serve with coleslaw.', tags: ['high-protein', 'dinner', 'img:bbq-chicken'] },
    { name: 'Lentil & Chicken Soup', calories: 340, protein: 32, carbs: 30, fat: 8, servings: 3, ingredients: ['8oz chicken breast', '1 cup lentils', 'Carrots', 'Celery', 'Onion', 'Chicken broth'], instructions: '1. Sauté onion, carrots, celery.\n2. Add broth and lentils.\n3. Add diced chicken.\n4. Simmer 25 min.', tags: ['high-protein', 'lunch', 'dinner', 'img:chicken-lentil-soup'] },
    { name: 'Tuna Salad Wrap', calories: 310, protein: 28, carbs: 26, fat: 10, servings: 1, ingredients: ['5oz canned tuna', '1 tbsp mayo', 'Celery', 'Flour tortilla', 'Lettuce', 'Tomato'], instructions: '1. Mix tuna, mayo and diced celery.\n2. Lay on tortilla with lettuce and tomato.\n3. Roll tightly.', tags: ['high-protein', 'lunch', 'quick', 'img:tuna-wrap'] },

    // Breakfast options (15, some overlap with above)
    { name: 'Overnight Oats', calories: 350, protein: 14, carbs: 52, fat: 10, servings: 1, ingredients: ['1/2 cup oats', '1/2 cup milk', '1/4 cup Greek yogurt', '1 tbsp chia seeds', 'Honey', 'Berries'], instructions: '1. Mix oats, milk, yogurt and chia.\n2. Refrigerate overnight.\n3. Top with berries and honey.', tags: ['breakfast', 'img:overnight-oats'] },
    { name: 'Avocado Toast with Egg', calories: 380, protein: 16, carbs: 30, fat: 22, servings: 1, ingredients: ['2 slices whole wheat bread', '1 avocado', '2 eggs', 'Red pepper flakes', 'Salt'], instructions: '1. Toast bread.\n2. Mash avocado on toast.\n3. Fry eggs.\n4. Top toast with eggs.', tags: ['breakfast', 'quick', 'img:avocado-toast-egg'] },
    { name: 'Berry Smoothie Bowl', calories: 320, protein: 18, carbs: 48, fat: 6, servings: 1, ingredients: ['1 cup frozen berries', '1 banana', '1 scoop protein powder', '1/4 cup granola', 'Almond milk'], instructions: '1. Blend berries, banana, protein and milk until thick.\n2. Pour into bowl.\n3. Top with granola.', tags: ['breakfast', 'img:smoothie-bowl'] },
    { name: 'Breakfast Burrito', calories: 420, protein: 24, carbs: 36, fat: 20, servings: 1, ingredients: ['2 eggs', 'Flour tortilla', 'Black beans', 'Cheese', 'Salsa', 'Avocado'], instructions: '1. Scramble eggs.\n2. Warm tortilla.\n3. Fill with eggs, beans, cheese.\n4. Top with salsa and avocado.', tags: ['breakfast', 'img:breakfast-burrito'] },
    { name: 'Banana Peanut Butter Smoothie', calories: 380, protein: 20, carbs: 44, fat: 16, servings: 1, ingredients: ['1 banana', '2 tbsp peanut butter', '1 cup milk', '1 scoop protein powder', 'Ice'], instructions: '1. Add all ingredients to blender.\n2. Blend until smooth.\n3. Serve immediately.', tags: ['breakfast', 'quick', 'img:peanut-butter-smoothie'] },
    { name: 'Veggie Frittata', calories: 290, protein: 22, carbs: 8, fat: 18, servings: 4, ingredients: ['8 eggs', 'Bell peppers', 'Onion', 'Spinach', 'Feta cheese', 'Olive oil'], instructions: '1. Sauté veggies in oven-safe skillet.\n2. Pour beaten eggs over veggies.\n3. Top with feta.\n4. Bake at 375F for 15 min.', tags: ['breakfast', 'low-carb', 'vegetarian', 'img:veggie-frittata'] },
    { name: 'French Toast', calories: 340, protein: 14, carbs: 40, fat: 14, servings: 2, ingredients: ['4 slices bread', '2 eggs', '1/4 cup milk', 'Cinnamon', 'Vanilla', 'Maple syrup'], instructions: '1. Mix eggs, milk, cinnamon, vanilla.\n2. Dip bread slices.\n3. Cook on griddle 3 min per side.\n4. Serve with syrup.', tags: ['breakfast', 'img:french-toast'] },
    { name: 'Chia Pudding', calories: 260, protein: 10, carbs: 28, fat: 14, servings: 1, ingredients: ['3 tbsp chia seeds', '1 cup almond milk', '1 tbsp honey', 'Vanilla', 'Mango'], instructions: '1. Mix chia, milk, honey, vanilla.\n2. Refrigerate 4 hours.\n3. Top with mango.', tags: ['breakfast', 'snack', 'vegetarian', 'img:chia-pudding'] },
    { name: 'Breakfast Oat Bar', calories: 200, protein: 8, carbs: 32, fat: 6, servings: 8, ingredients: ['2 cups oats', '2 bananas', '1/4 cup honey', 'Peanut butter', 'Chocolate chips'], instructions: '1. Mash bananas.\n2. Mix with oats, honey, PB.\n3. Press into pan.\n4. Bake at 350F for 20 min.\n5. Cut into bars.', tags: ['breakfast', 'snack', 'img:oat-bar'] },
    { name: 'Yogurt Parfait', calories: 280, protein: 18, carbs: 36, fat: 8, servings: 1, ingredients: ['1 cup Greek yogurt', '1/2 cup granola', 'Mixed berries', 'Honey'], instructions: '1. Layer yogurt, granola and berries.\n2. Repeat layers.\n3. Drizzle with honey.', tags: ['breakfast', 'quick', 'img:yogurt-parfait'] },

    // Quick meals (10)
    { name: 'Chicken Quesadilla', calories: 420, protein: 32, carbs: 30, fat: 18, servings: 1, ingredients: ['4oz chicken', '2 flour tortillas', 'Cheese', 'Bell pepper', 'Salsa'], instructions: '1. Shred chicken.\n2. Fill tortilla with chicken, cheese, peppers.\n3. Cook on skillet 3 min per side.\n4. Serve with salsa.', tags: ['quick', 'lunch', 'img:chicken-quesadilla'] },
    { name: 'Caprese Sandwich', calories: 380, protein: 18, carbs: 34, fat: 20, servings: 1, ingredients: ['Ciabatta roll', 'Fresh mozzarella', 'Tomato', 'Basil', 'Balsamic glaze'], instructions: '1. Slice roll.\n2. Layer mozzarella, tomato, basil.\n3. Drizzle balsamic.\n4. Close and serve.', tags: ['quick', 'lunch', 'vegetarian', 'img:caprese-sandwich'] },
    { name: '5-Minute Egg Fried Rice', calories: 390, protein: 16, carbs: 48, fat: 14, servings: 1, ingredients: ['1.5 cups leftover rice', '2 eggs', '1 cup frozen peas & carrots', 'Soy sauce', 'Sesame oil'], instructions: '1. Heat oil, scramble eggs.\n2. Add rice and veggies.\n3. Stir-fry 3 min.\n4. Add soy sauce.', tags: ['quick', 'dinner', 'img:egg-fried-rice'] },
    { name: 'BLT Sandwich', calories: 350, protein: 14, carbs: 28, fat: 20, servings: 1, ingredients: ['3 slices bacon', '2 slices bread', 'Lettuce', 'Tomato', 'Mayo'], instructions: '1. Cook bacon until crispy.\n2. Toast bread.\n3. Layer bacon, lettuce, tomato.\n4. Spread mayo and close.', tags: ['quick', 'lunch', 'img:blt-sandwich'] },
    { name: 'Microwave Mug Omelette', calories: 180, protein: 16, carbs: 2, fat: 12, servings: 1, ingredients: ['2 eggs', 'Cheese', 'Ham', 'Bell pepper', 'Salt & pepper'], instructions: '1. Whisk eggs in mug.\n2. Add diced ham, pepper, cheese.\n3. Microwave 90 seconds.\n4. Stir and microwave 30 more seconds.', tags: ['quick', 'breakfast', 'low-carb', 'img:mug-omelette'] },
    { name: 'Mediterranean Wrap', calories: 360, protein: 16, carbs: 36, fat: 18, servings: 1, ingredients: ['Flour tortilla', 'Hummus', 'Cucumber', 'Tomato', 'Feta', 'Olives', 'Spinach'], instructions: '1. Spread hummus on tortilla.\n2. Add veggies, feta and olives.\n3. Roll tightly.', tags: ['quick', 'lunch', 'vegetarian', 'img:mediterranean-wrap'] },
    { name: 'Peanut Noodles', calories: 420, protein: 14, carbs: 50, fat: 18, servings: 2, ingredients: ['8oz noodles', '3 tbsp peanut butter', '2 tbsp soy sauce', 'Lime', 'Sriracha', 'Green onions'], instructions: '1. Cook noodles.\n2. Mix PB, soy, lime, sriracha.\n3. Toss noodles in sauce.\n4. Garnish with green onions.', tags: ['quick', 'dinner', 'vegetarian', 'img:peanut-noodles'] },
    { name: 'Greek Salad with Grilled Chicken', calories: 380, protein: 34, carbs: 14, fat: 22, servings: 1, ingredients: ['5oz chicken breast', 'Cucumber', 'Tomatoes', 'Red onion', 'Feta', 'Olive oil', 'Oregano'], instructions: '1. Grill seasoned chicken.\n2. Chop veggies.\n3. Slice chicken and add to salad.\n4. Drizzle olive oil and oregano.', tags: ['quick', 'lunch', 'low-carb', 'img:greek-salad-chicken'] },
    { name: 'Taco Salad', calories: 400, protein: 26, carbs: 22, fat: 24, servings: 1, ingredients: ['4oz ground beef', 'Romaine', 'Tomato', 'Cheese', 'Sour cream', 'Tortilla chips', 'Salsa'], instructions: '1. Brown and season beef.\n2. Layer lettuce, beef, toppings.\n3. Crush chips on top.\n4. Add salsa.', tags: ['quick', 'dinner', 'img:taco-salad'] },
    { name: 'Turkey & Cheese Roll-Ups', calories: 220, protein: 24, carbs: 4, fat: 12, servings: 1, ingredients: ['4oz turkey breast slices', '2 slices Swiss cheese', 'Mustard', 'Lettuce'], instructions: '1. Lay out turkey slices.\n2. Place cheese and lettuce on top.\n3. Spread mustard.\n4. Roll up.', tags: ['quick', 'lunch', 'snack', 'low-carb', 'img:turkey-roll-ups'] },

    // Low-carb options (10)
    { name: 'Zucchini Noodle Bolognese', calories: 320, protein: 28, carbs: 12, fat: 18, servings: 2, ingredients: ['2 zucchini', '8oz ground beef', 'Marinara sauce', 'Garlic', 'Onion', 'Parmesan'], instructions: '1. Spiralize zucchini.\n2. Brown beef with garlic and onion.\n3. Add marinara and simmer.\n4. Serve over zucchini noodles.', tags: ['low-carb', 'dinner', 'img:zucchini-bolognese'] },
    { name: 'Cauliflower Fried Rice', calories: 240, protein: 18, carbs: 10, fat: 14, servings: 2, ingredients: ['1 head cauliflower', '2 eggs', 'Peas', 'Carrots', 'Soy sauce', 'Sesame oil'], instructions: '1. Rice cauliflower in food processor.\n2. Sauté veggies.\n3. Add cauliflower and eggs.\n4. Season with soy sauce.', tags: ['low-carb', 'dinner', 'vegetarian', 'img:cauliflower-fried-rice'] },
    { name: 'Stuffed Bell Peppers', calories: 340, protein: 26, carbs: 16, fat: 18, servings: 4, ingredients: ['4 bell peppers', '1lb ground turkey', '1/2 cup rice', 'Tomato sauce', 'Cheese', 'Onion'], instructions: '1. Cut tops off peppers.\n2. Mix turkey, rice, sauce, onion.\n3. Stuff peppers.\n4. Bake at 375F for 30 min.\n5. Top with cheese.', tags: ['low-carb', 'dinner', 'img:stuffed-peppers'] },
    { name: 'Keto Chicken Wings', calories: 380, protein: 30, carbs: 2, fat: 28, servings: 2, ingredients: ['1lb chicken wings', 'Baking powder', 'Garlic powder', 'Butter', 'Hot sauce'], instructions: '1. Toss wings with baking powder and garlic.\n2. Bake at 425F for 45 min.\n3. Toss in butter and hot sauce.', tags: ['low-carb', 'dinner', 'snack', 'img:chicken-wings'] },
    { name: 'Spinach & Feta Stuffed Chicken', calories: 360, protein: 40, carbs: 4, fat: 20, servings: 2, ingredients: ['2 chicken breasts', 'Spinach', 'Feta cheese', 'Garlic', 'Olive oil'], instructions: '1. Cut pocket in chicken.\n2. Mix spinach, feta, garlic.\n3. Stuff chicken.\n4. Bake at 375F for 25 min.', tags: ['low-carb', 'dinner', 'high-protein', 'img:stuffed-chicken-spinach'] },
    { name: 'Cucumber Tuna Boats', calories: 180, protein: 22, carbs: 6, fat: 8, servings: 1, ingredients: ['2 cucumbers', '5oz canned tuna', 'Mayo', 'Dill', 'Red onion'], instructions: '1. Halve cucumbers, scoop centers.\n2. Mix tuna, mayo, dill, onion.\n3. Fill cucumber boats.', tags: ['low-carb', 'lunch', 'snack', 'img:cucumber-tuna-boats'] },
    { name: 'Chicken Cobb Salad', calories: 420, protein: 36, carbs: 10, fat: 28, servings: 1, ingredients: ['5oz chicken', 'Romaine', 'Bacon', 'Avocado', 'Hard-boiled egg', 'Blue cheese', 'Tomato'], instructions: '1. Grill and slice chicken.\n2. Arrange romaine in bowl.\n3. Row all toppings on top.\n4. Drizzle with dressing.', tags: ['low-carb', 'lunch', 'high-protein', 'img:cobb-salad'] },
    { name: 'Garlic Butter Shrimp', calories: 260, protein: 28, carbs: 3, fat: 16, servings: 1, ingredients: ['8oz shrimp', '2 tbsp butter', '4 cloves garlic', 'Parsley', 'Lemon'], instructions: '1. Melt butter, sauté garlic.\n2. Add shrimp, cook 2 min per side.\n3. Squeeze lemon.\n4. Garnish with parsley.', tags: ['low-carb', 'dinner', 'quick', 'img:garlic-butter-shrimp'] },
    { name: 'Caprese Chicken', calories: 380, protein: 38, carbs: 6, fat: 22, servings: 1, ingredients: ['6oz chicken breast', 'Fresh mozzarella', 'Tomato', 'Basil', 'Balsamic glaze'], instructions: '1. Grill chicken.\n2. Top with mozzarella.\n3. Broil until melted.\n4. Add tomato, basil, balsamic.', tags: ['low-carb', 'dinner', 'img:caprese-chicken'] },
    { name: 'Egg Drop Soup', calories: 110, protein: 8, carbs: 6, fat: 6, servings: 2, ingredients: ['4 cups chicken broth', '3 eggs', 'Green onions', 'Ginger', 'Sesame oil', 'Soy sauce'], instructions: '1. Bring broth to simmer with ginger.\n2. Beat eggs.\n3. Slowly drizzle eggs into broth while stirring.\n4. Season with soy and sesame.', tags: ['low-carb', 'lunch', 'quick', 'img:egg-drop-soup'] },

    // International dishes (10)
    { name: 'Korean Bulgogi', calories: 420, protein: 32, carbs: 28, fat: 20, servings: 3, ingredients: ['1lb beef sirloin', 'Soy sauce', 'Sesame oil', 'Garlic', 'Ginger', 'Pear', 'Rice', 'Green onions'], instructions: '1. Marinate sliced beef in soy, sesame oil, garlic, ginger, pear puree.\n2. Grill or pan-fry beef.\n3. Serve over rice with green onions.', tags: ['international', 'dinner', 'high-protein', 'img:korean-bulgogi'] },
    { name: 'Thai Basil Turkey', calories: 380, protein: 30, carbs: 32, fat: 14, servings: 2, ingredients: ['1lb ground turkey', 'Thai basil', 'Garlic', 'Chili', 'Soy sauce', 'Fish sauce', 'Rice'], instructions: '1. Stir-fry garlic and chili.\n2. Add turkey, cook through.\n3. Add soy sauce and fish sauce.\n4. Toss in basil.\n5. Serve over rice.', tags: ['international', 'dinner', 'high-protein', 'img:thai-basil-turkey'] },
    { name: 'Japanese Miso Salmon', calories: 380, protein: 34, carbs: 16, fat: 20, servings: 2, ingredients: ['2 salmon fillets', 'White miso paste', 'Mirin', 'Soy sauce', 'Rice', 'Bok choy'], instructions: '1. Mix miso, mirin, soy.\n2. Marinate salmon 30 min.\n3. Broil 8 min.\n4. Serve with rice and steamed bok choy.', tags: ['international', 'dinner', 'high-protein', 'img:miso-salmon'] },
    { name: 'Indian Chicken Tikka', calories: 360, protein: 34, carbs: 20, fat: 16, servings: 3, ingredients: ['1lb chicken breast', 'Yogurt', 'Tikka spice mix', 'Naan bread', 'Rice', 'Cilantro'], instructions: '1. Marinate chicken in yogurt and spices.\n2. Grill or broil until charred.\n3. Serve with naan or rice.\n4. Garnish with cilantro.', tags: ['international', 'dinner', 'high-protein', 'img:chicken-tikka'] },
    { name: 'Moroccan Chickpea Stew', calories: 320, protein: 14, carbs: 44, fat: 10, servings: 4, ingredients: ['2 cans chickpeas', 'Tomatoes', 'Sweet potato', 'Cumin', 'Cinnamon', 'Cilantro', 'Couscous'], instructions: '1. Sauté onion with cumin and cinnamon.\n2. Add sweet potato, tomatoes, chickpeas.\n3. Simmer 25 min.\n4. Serve over couscous.', tags: ['international', 'dinner', 'vegetarian', 'img:moroccan-chickpea-stew'] },
    { name: 'Mexican Burrito Bowl', calories: 480, protein: 28, carbs: 52, fat: 18, servings: 1, ingredients: ['4oz chicken', 'Rice', 'Black beans', 'Corn', 'Guacamole', 'Salsa', 'Sour cream', 'Cheese'], instructions: '1. Cook seasoned chicken.\n2. Prepare rice.\n3. Assemble bowl with all toppings.', tags: ['international', 'lunch', 'dinner', 'img:burrito-bowl'] },
    { name: 'Vietnamese Pho', calories: 360, protein: 26, carbs: 42, fat: 8, servings: 2, ingredients: ['Beef broth', '6oz sirloin', 'Rice noodles', 'Bean sprouts', 'Basil', 'Lime', 'Hoisin', 'Sriracha'], instructions: '1. Simmer broth with star anise and ginger.\n2. Cook rice noodles.\n3. Slice beef thinly.\n4. Pour hot broth over noodles and beef.\n5. Serve with garnishes.', tags: ['international', 'dinner', 'img:vietnamese-pho'] },
    { name: 'Italian Turkey Meatballs', calories: 380, protein: 34, carbs: 22, fat: 16, servings: 4, ingredients: ['1lb ground turkey', 'Breadcrumbs', 'Parmesan', 'Egg', 'Italian herbs', 'Marinara', 'Spaghetti'], instructions: '1. Mix turkey, breadcrumbs, parmesan, egg, herbs.\n2. Form balls.\n3. Bake at 400F for 20 min.\n4. Serve with marinara and pasta.', tags: ['international', 'dinner', 'high-protein', 'img:italian-meatballs'] },
    { name: 'Spanish Tortilla', calories: 280, protein: 14, carbs: 24, fat: 14, servings: 6, ingredients: ['6 eggs', '3 potatoes', '1 onion', 'Olive oil', 'Salt'], instructions: '1. Slice potatoes thin.\n2. Fry potatoes and onion in oil.\n3. Mix with beaten eggs.\n4. Cook in skillet, flip once.\n5. Serve warm or cold.', tags: ['international', 'breakfast', 'lunch', 'vegetarian', 'img:spanish-tortilla'] },
    { name: 'Teriyaki Chicken Bowl', calories: 440, protein: 34, carbs: 48, fat: 12, servings: 1, ingredients: ['6oz chicken thigh', 'Teriyaki sauce', 'Rice', 'Broccoli', 'Carrots', 'Sesame seeds'], instructions: '1. Cook chicken in teriyaki sauce.\n2. Steam broccoli and carrots.\n3. Serve over rice.\n4. Sprinkle sesame seeds.', tags: ['international', 'dinner', 'img:teriyaki-chicken-bowl'] },

    // Vegetarian/vegan (5)
    { name: 'Black Bean Veggie Burger', calories: 320, protein: 16, carbs: 40, fat: 12, servings: 4, ingredients: ['2 cans black beans', 'Oats', 'Onion', 'Garlic', 'Cumin', 'Burger buns', 'Avocado'], instructions: '1. Mash beans.\n2. Mix with oats, onion, garlic, cumin.\n3. Form patties.\n4. Cook on skillet 4 min per side.\n5. Serve on buns.', tags: ['vegetarian', 'dinner', 'img:veggie-burger'] },
    { name: 'Chickpea Curry', calories: 360, protein: 14, carbs: 42, fat: 16, servings: 3, ingredients: ['2 cans chickpeas', 'Coconut milk', 'Curry paste', 'Spinach', 'Onion', 'Rice'], instructions: '1. Sauté onion.\n2. Add curry paste.\n3. Add chickpeas and coconut milk.\n4. Simmer 15 min.\n5. Stir in spinach.', tags: ['vegetarian', 'dinner', 'international', 'img:chickpea-curry'] },
    { name: 'Lentil Dal', calories: 300, protein: 18, carbs: 42, fat: 6, servings: 4, ingredients: ['1.5 cups red lentils', 'Onion', 'Garlic', 'Ginger', 'Turmeric', 'Cumin', 'Tomatoes', 'Cilantro'], instructions: '1. Sauté onion, garlic, ginger.\n2. Add spices.\n3. Add lentils and water.\n4. Simmer until thick.\n5. Serve with rice.', tags: ['vegetarian', 'dinner', 'international', 'img:lentil-dal'] },
    { name: 'Veggie Stir Fry with Tofu', calories: 310, protein: 18, carbs: 26, fat: 16, servings: 2, ingredients: ['1 block firm tofu', 'Broccoli', 'Bell pepper', 'Snow peas', 'Soy sauce', 'Sesame oil', 'Rice'], instructions: '1. Press and cube tofu.\n2. Pan-fry tofu until golden.\n3. Stir-fry veggies.\n4. Add soy sauce.\n5. Serve over rice.', tags: ['vegetarian', 'dinner', 'img:veggie-tofu-stir-fry'] },
    { name: 'Mushroom Risotto', calories: 380, protein: 10, carbs: 52, fat: 14, servings: 3, ingredients: ['1.5 cups arborio rice', 'Mixed mushrooms', 'Onion', 'White wine', 'Parmesan', 'Vegetable broth', 'Butter'], instructions: '1. Sauté mushrooms and onion.\n2. Add rice, toast 1 min.\n3. Add wine.\n4. Gradually add broth, stirring.\n5. Stir in parmesan and butter.', tags: ['vegetarian', 'dinner', 'international', 'img:mushroom-risotto'] },

    // Snacks/sides (10)
    { name: 'Trail Mix', calories: 180, protein: 5, carbs: 16, fat: 12, servings: 1, ingredients: ['Almonds', 'Cashews', 'Dried cranberries', 'Dark chocolate chips', 'Pumpkin seeds'], instructions: '1. Combine all ingredients.\n2. Store in airtight container.\n3. Serve 1/4 cup portions.', tags: ['snack', 'img:trail-mix'] },
    { name: 'Apple Slices with Peanut Butter', calories: 200, protein: 6, carbs: 22, fat: 12, servings: 1, ingredients: ['1 apple', '2 tbsp peanut butter'], instructions: '1. Slice apple.\n2. Serve with peanut butter for dipping.', tags: ['snack', 'quick', 'img:apple-peanut-butter'] },
    { name: 'Protein Energy Balls', calories: 160, protein: 8, carbs: 18, fat: 8, servings: 12, ingredients: ['1 cup oats', '1/2 cup peanut butter', '1/3 cup honey', '1/2 cup chocolate chips', 'Protein powder'], instructions: '1. Mix all ingredients.\n2. Roll into 12 balls.\n3. Refrigerate 30 min.', tags: ['snack', 'high-protein', 'img:energy-balls'] },
    { name: 'Guacamole with Veggies', calories: 180, protein: 3, carbs: 14, fat: 14, servings: 2, ingredients: ['2 avocados', 'Lime', 'Onion', 'Tomato', 'Cilantro', 'Carrot sticks', 'Cucumber'], instructions: '1. Mash avocados.\n2. Mix in lime, onion, tomato, cilantro.\n3. Serve with veggie sticks.', tags: ['snack', 'vegetarian', 'img:guacamole-veggies'] },
    { name: 'Hard-Boiled Eggs', calories: 144, protein: 12, carbs: 1, fat: 10, servings: 1, ingredients: ['2 eggs', 'Salt & pepper'], instructions: '1. Place eggs in pot, cover with water.\n2. Bring to boil.\n3. Cover, remove from heat, let sit 10 min.\n4. Cool in ice bath.', tags: ['snack', 'high-protein', 'low-carb', 'quick', 'img:hard-boiled-eggs'] },
    { name: 'Roasted Sweet Potato Fries', calories: 190, protein: 2, carbs: 36, fat: 5, servings: 2, ingredients: ['2 sweet potatoes', '1 tbsp olive oil', 'Paprika', 'Garlic powder', 'Salt'], instructions: '1. Cut sweet potatoes into wedges.\n2. Toss with oil and spices.\n3. Bake at 425F for 25 min.', tags: ['snack', 'side', 'img:sweet-potato-fries'] },
    { name: 'Greek Tzatziki with Pita', calories: 200, protein: 8, carbs: 26, fat: 8, servings: 2, ingredients: ['1 cup Greek yogurt', 'Cucumber', 'Garlic', 'Dill', 'Lemon', 'Pita bread'], instructions: '1. Grate and squeeze cucumber.\n2. Mix with yogurt, garlic, dill, lemon.\n3. Serve with warm pita.', tags: ['snack', 'vegetarian', 'img:tzatziki-pita'] },
    { name: 'Edamame Bowl', calories: 190, protein: 17, carbs: 14, fat: 8, servings: 1, ingredients: ['2 cups edamame in shell', 'Sea salt', 'Red pepper flakes'], instructions: '1. Steam or microwave edamame.\n2. Sprinkle with salt and red pepper flakes.\n3. Serve warm.', tags: ['snack', 'high-protein', 'vegetarian', 'img:edamame-bowl'] },
    { name: 'Banana Nice Cream', calories: 150, protein: 2, carbs: 36, fat: 1, servings: 1, ingredients: ['2 frozen bananas', 'Cocoa powder', 'Almond milk splash'], instructions: '1. Blend frozen bananas until creamy.\n2. Add cocoa powder.\n3. Serve immediately.', tags: ['snack', 'vegetarian', 'img:banana-nice-cream'] },
    { name: 'Cheese & Crackers Plate', calories: 240, protein: 10, carbs: 18, fat: 14, servings: 1, ingredients: ['2oz cheddar cheese', '8 whole wheat crackers', 'Grapes'], instructions: '1. Slice cheese.\n2. Arrange with crackers and grapes.', tags: ['snack', 'quick', 'img:cheese-crackers'] },
  ];

  for (const r of recipes) {
    const id = 'recipe_' + generateId();
    const imageUrl = `https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=200&h=200&fit=crop`;
    await db.runAsync(
      `INSERT INTO recipes (id, name, category, calories, protein, carbs, fat, servings, ingredients, instructions, tags, isCustom, imageUrl, createdAt)
       VALUES (?, ?, 'recipe', ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      [id, r.name, r.calories, r.protein, r.carbs, r.fat, r.servings, JSON.stringify(r.ingredients), r.instructions, JSON.stringify(r.tags), imageUrl, now]
    );
  }
}
