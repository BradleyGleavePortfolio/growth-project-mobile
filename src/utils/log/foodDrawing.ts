// FOOD-IMAGES-M (owner #191-E3; how: #191-D2 op 1, #192-E6): a food with no photo shows the line drawing for its food
// group on the cream tile, as the picked C2 Style C add sheet draws its rows. Pure, no React.
import type { FoodDrawingKind } from '../../components/FoodDrawing';

const CATEGORY_TAG = 'category:';
// FoodCategory (prisma/schema.prisma:85-91) says what kind of row it is, never its food group.
const ROW_TYPES = new Set(['generic', 'packaged', 'fast_food', 'restaurant', 'recipe_ingredient']);

/** R3: the food group the server already sends. A stored row keeps it as its first category: tag (seeded and USDA rows,
 *  stored as 'generic'); a live USDA hit sends it as its category. Anything else (Open Food Facts, a custom food): none. */
export function foodGroupOf(item: { tags?: unknown; category?: unknown }): string | undefined {
  const tag = Array.isArray(item.tags)
    ? item.tags.find((t): t is string => typeof t === 'string' && t.startsWith(CATEGORY_TAG) && t.length > CATEGORY_TAG.length)
    : undefined;
  const group = (tag ? tag.slice(CATEGORY_TAG.length) : typeof item.category === 'string' ? item.category : '').trim();
  return group && !ROW_TYPES.has(group) ? group : undefined;
}

const DAIRY = 'Dairy and Egg Products';
const LEGUMES = 'Legumes and Legume Products';
const NUTS = 'Nut and Seed Products';
const SOUPS = 'Soups, Sauces, and Gravies';

// R4: the drawing for each of the 25 USDA groups (usda-foods.jsonl.gz usda_category).
const DEFAULT_KIND = new Map<string, FoodDrawingKind>(([
  ['glass', ['Beverages']],
  ['bowl', ['Fruits and Fruit Juices', 'Vegetables and Vegetable Products', LEGUMES, NUTS, 'Cereal Grains and Pasta',
    'Breakfast Cereals', SOUPS]],
  ['jar', [DAIRY, 'Fats and Oils', 'Spices and Herbs', 'Sweets', 'Baby Foods']],
  ['plate', ['Beef Products', 'Pork Products', 'Poultry Products', 'Lamb, Veal, and Game Products', 'Finfish and Shellfish Products',
    'Sausages and Luncheon Meats', 'Baked Products', 'Snacks', 'Fast Foods', 'Restaurant Foods', 'Meals, Entrees, and Side Dishes',
    'American Indian/Alaska Native Foods']],
] as const).flatMap(([kind, groups]) => groups.map((group) => [group, kind] as [string, FoodDrawingKind])));

const HOT_DRINK = ['coffee', 'espresso', 'latte', 'cappuccino', 'americano', 'macchiato', 'mocha', 'tea', 'chai', 'cocoa',
  'hot chocolate', 'flat white'];
const DRINK = ['juice', 'juices', 'nectar', 'smoothie', 'shake', 'shakes', 'milk', 'soymilk', 'buttermilk', 'kefir', 'drink',
  'drinks', 'beverage', 'eggnog'];
const DRINK_GROUPS = new Set(['Fruits and Fruit Juices', 'Vegetables and Vegetable Products', DAIRY, LEGUMES, NUTS]);

// Any other group text (FNDDS, Branded, a future one): the first entry with a word in it wins; 'dairy' reads the row as
// Dairy and Egg Products, its name moves included. A word matches its plural too.
const KEYWORDS: Array<[FoodDrawingKind | 'dairy', string[]]> = [
  ['cup', ['coffee', 'tea']],
  ['glass', ['beverage', 'drink', 'juice', 'water', 'soda', 'smoothie', 'shake', 'beer', 'wine', 'liquor', 'cocktail']],
  ['dairy', ['yogurt', 'yoghurt', 'milk', 'dairy', 'cream', 'cheese']],
  ['plate', ['sandwich', 'burger', 'pizza']],
  ['jar', ['dressing', 'sauce', 'condiment']],
  ['bowl', ['fruit', 'vegetable', 'salad', 'legume', 'bean', 'grain', 'pasta', 'rice', 'cereal', 'oat', 'soup']],
  ['jar', ['oil', 'fat', 'butter', 'spread', 'spice', 'herb', 'jam', 'honey', 'syrup', 'sweet', 'candy', 'baby', 'chocolate',
    'seasoning', 'salt', 'marinade']],
  ['plate', ['meat', 'beef', 'pork', 'poultry', 'chicken', 'turkey', 'fish', 'seafood', 'bacon', 'sausage', 'entree', 'dish',
    'meal', 'bread', 'bun', 'baked', 'snack', 'chip', 'cracker', 'cookie', 'egg', 'cold cut', 'deli', 'pancake', 'waffle',
    'toast', 'cake', 'pie', 'nacho', 'appetizer']],
];

const wordsOf = (text: string) => text.toLowerCase().replace(/[^a-z]+/g, ' ').trim().split(' ').filter(Boolean);

/** Whole words or phrases, case-insensitive; with plurals, a word also matches its -s, -es and -ies forms. */
function has(words: string[], phrases: string[], plurals = false): boolean {
  const text = ` ${words.join(' ')} `;
  return phrases.some((p) => [p, ...(plurals ? [`${p}s`, `${p}es`, ...(p.endsWith('y') ? [`${p.slice(0, -1)}ies`] : [])] : [])]
    .some((form) => text.includes(` ${form} `)));
}

// USDA's group words before the food ("Beverages, coffee, brewed"; "Nuts, almond butter"), and a brand in capitals
// before it ("SILK Chocolate, soymilk"), are skipped: the next part is the food's own words. A name written all in
// capitals (USDA's Branded foods, "MILK, WHOLE") has no brand head.
const SKIPPED_HEADS = new Set(['beverages', 'alcoholic beverage', 'alcoholic beverages', 'nuts', 'seeds']);
const BRAND = /\b[A-Z][A-Z'&!.-]+\b/;

/** The food's own words: its name before the first comma; words in parentheses read as after a comma. */
function ownWords(name: string): string[] {
  const parts = name.replace(/\(([^)]*)\)/g, ',$1,').split(',').map((part) => part.trim());
  const brand = name !== name.toUpperCase() && BRAND.test(parts[0]);
  const skip = parts.length > 1 && (SKIPPED_HEADS.has(parts[0].toLowerCase()) || brand);
  return wordsOf(parts[skip ? 1 : 0]);
}

/** The food's own words move it only inside its group. */
function nameMove(group: string, words: string[]): FoodDrawingKind | undefined {
  if (group === 'Beverages') return has(words, HOT_DRINK) ? 'cup' : undefined;
  if (group === DAIRY && has(words, ['ice cream', 'dessert bar'])) return 'bowl';
  if (group === DAIRY && has(words, ['sauce', 'spread', 'dip'])) return 'jar';
  if (DRINK_GROUPS.has(group) && has(words, DRINK)) return 'glass';
  if (group === DAIRY && has(words, ['egg', 'eggs', 'omelet', 'omelette', 'cheese'])) return 'plate';
  if ((group === LEGUMES || group === NUTS) && has(words, ['butter', 'spread'])) return 'jar';
  if (group === SOUPS && has(words, ['sauce', 'gravy', 'dip', 'salsa', 'dressing'])) return 'jar';
  return undefined;
}

/** R4: which of the five drawings a row with no photo shows. No group, or a group no word places: the bowl, as before. */
export function drawingFor(name: string, group?: string): FoodDrawingKind {
  let known = group?.trim();
  if (!known) return 'bowl';
  if (!DEFAULT_KIND.has(known)) {
    const hit = KEYWORDS.find(([, words]) => has(wordsOf(known!), words, true))?.[0];
    if (!hit) return 'bowl';
    if (hit !== 'dairy') return hit;
    known = DAIRY;
  }
  return nameMove(known, ownWords(name || '')) ?? DEFAULT_KIND.get(known) ?? 'bowl';
}
