/**
 * Demo fixtures for screenshot mode.
 *
 * Values are tuned to make the marketing screens look like a typical day for
 * a returning user roughly two weeks into the program — enough logged data
 * that every chart, ring, and progress line has something to render, but
 * still believable.
 *
 * TGP guardrails honored:
 *  - No diagnosis / treatment language, no medical claims.
 *  - No financial advice, no AI-generated coach text. The AI Guide screen is
 *    intentionally not in the screenshot target set.
 *  - All copy is generic ("Steady week", "Cardio session") with no claim of
 *    outcomes attributable to the app.
 */

import type { CurrentUser } from '../hooks/useCurrentUser';

const DEMO_USER_ID = 'demo-user-screenshot';
const DEMO_COACH_ID = 'demo-coach-screenshot';

export const DEMO_USER: CurrentUser = {
  id: DEMO_USER_ID,
  email: 'demo@trygrowthproject.com',
  name: 'Alex Morgan',
  firstName: 'Alex',
  lastName: 'Morgan',
  role: 'student',
  coach_id: DEMO_COACH_ID,
  createdAt: '2026-04-15T09:00:00Z',
  profile: {
    calorie_target: 2200,
    protein_target: 165,
    carbs_target: 230,
    fat_target: 70,
    current_weight: 178.4,
    target_weight: 170,
    height_cm: 180,
    sex: 'male',
    dob: '1992-06-12',
    activity_level: 'moderate',
    primary_goal: 'fat_loss_lean_gain',
    diet_type: 'balanced',
    workout_days_per_week: 4,
    onboarding_completed: true,
    tdee: 2580,
  },
};

// ─── /log/daily ──────────────────────────────────────────────────────────────
// Wire shape per src/store/clientStore.ts expectations.

export const DEMO_FOOD_LOGS = [
  {
    id: 'log-breakfast',
    user_id: DEMO_USER_ID,
    food_item_id: 'food-oats',
    meal_type: 'breakfast' as const,
    quantity_multiplier: 1,
    logged_at: '2026-05-02T08:12:00Z',
    food_item: {
      name: 'Oats with berries',
      calories: 410,
      protein_g: 18,
      carbs_g: 62,
      fat_g: 9,
    },
  },
  {
    id: 'log-lunch',
    user_id: DEMO_USER_ID,
    food_item_id: 'food-chicken-rice',
    meal_type: 'lunch' as const,
    quantity_multiplier: 1,
    logged_at: '2026-05-02T13:04:00Z',
    food_item: {
      name: 'Chicken, rice, greens',
      calories: 620,
      protein_g: 48,
      carbs_g: 70,
      fat_g: 14,
    },
  },
  {
    id: 'log-snack',
    user_id: DEMO_USER_ID,
    food_item_id: 'food-yogurt',
    meal_type: 'snack' as const,
    quantity_multiplier: 1,
    logged_at: '2026-05-02T16:30:00Z',
    food_item: {
      name: 'Greek yogurt, almonds',
      calories: 240,
      protein_g: 22,
      carbs_g: 14,
      fat_g: 11,
    },
  },
];

export const DEMO_DAILY_TOTAL_ML = 1980;

// ─── /weight/history ─────────────────────────────────────────────────────────

export const DEMO_WEIGHT_HISTORY = (() => {
  // 30 days of gentle downward trend, ~1.4 lb / week. Some noise.
  const today = new Date('2026-05-02T07:00:00Z');
  const out: { id: string; user_id: string; weight_lbs: number; date: string }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const trend = 184 - i * 0.18;
    const noise = (Math.sin(i * 1.7) + Math.cos(i * 0.6)) * 0.5;
    out.push({
      id: `weight-${i}`,
      user_id: DEMO_USER_ID,
      weight_lbs: Math.round((trend + noise) * 10) / 10,
      date: d.toISOString().slice(0, 10),
    });
  }
  return out;
})();

// ─── /meal-plans ─────────────────────────────────────────────────────────────

export const DEMO_MEAL_PLANS = [
  {
    id: 'plan-this-week',
    title: 'This week — steady',
    notes: 'Hitting protein first; carbs around training.',
    created_at: '2026-04-29T15:00:00Z',
    items: [
      { name: 'Oats, berries, whey', calories: 410, protein: 32, time_of_day: 'breakfast', notes: 'Pre-set. Owned.' },
      { name: 'Chicken, jasmine rice, greens', calories: 620, protein: 48, time_of_day: 'lunch', notes: 'Pre-set. Owned.' },
      { name: 'Greek yogurt, almonds', calories: 240, protein: 22, time_of_day: 'snack', notes: 'Pre-set. Owned.' },
      { name: 'Salmon, sweet potato, asparagus', calories: 640, protein: 42, time_of_day: 'dinner', notes: 'Pre-set. Owned.' },
    ],
  },
];

// ─── /recipes ────────────────────────────────────────────────────────────────

export const DEMO_RECIPES = [
  {
    id: 'recipe-bowl',
    title: 'High-protein chicken bowl',
    description: 'Lunch staple — 48 g protein in under 15 minutes.',
    image_url: '',
    prep_time_min: 5,
    cook_time_min: 10,
    servings: 1,
    calories: 620,
    protein: 48,
    carbs: 70,
    fat: 14,
    ingredients: ['Chicken breast', 'Jasmine rice', 'Mixed greens', 'Olive oil'],
    instructions: ['Cook rice.', 'Sear chicken.', 'Plate with greens.'],
    tags: ['high-protein', 'lunch'],
    is_public: true,
    created_by_id: DEMO_COACH_ID,
    _count: { saved_by: 412 },
  },
  {
    id: 'recipe-oats',
    title: 'Berry-oat breakfast',
    description: 'Slow-burn carbs, real fruit, no added sugar.',
    image_url: '',
    prep_time_min: 3,
    cook_time_min: 5,
    servings: 1,
    calories: 410,
    protein: 18,
    carbs: 62,
    fat: 9,
    ingredients: ['Rolled oats', 'Mixed berries', 'Whey protein', 'Almond milk'],
    instructions: ['Cook oats.', 'Stir in protein.', 'Top with berries.'],
    tags: ['breakfast', 'high-fiber'],
    is_public: true,
    created_by_id: DEMO_COACH_ID,
    _count: { saved_by: 318 },
  },
  {
    id: 'recipe-salmon',
    title: 'Salmon, sweet potato, asparagus',
    description: 'Twenty minute dinner. Fits most macros.',
    image_url: '',
    prep_time_min: 5,
    cook_time_min: 18,
    servings: 1,
    calories: 640,
    protein: 42,
    carbs: 38,
    fat: 28,
    ingredients: ['Salmon fillet', 'Sweet potato', 'Asparagus', 'Lemon'],
    instructions: ['Roast sweet potato.', 'Sear salmon.', 'Steam asparagus.'],
    tags: ['dinner', 'omega-3'],
    is_public: true,
    created_by_id: DEMO_COACH_ID,
    _count: { saved_by: 287 },
  },
  {
    id: 'recipe-yogurt',
    title: 'Greek yogurt + almonds',
    description: 'Late-afternoon protein hit with crunch.',
    image_url: '',
    prep_time_min: 2,
    cook_time_min: 0,
    servings: 1,
    calories: 240,
    protein: 22,
    carbs: 14,
    fat: 11,
    ingredients: ['Greek yogurt', 'Almonds', 'Honey'],
    instructions: ['Combine.', 'Eat.'],
    tags: ['snack', 'high-protein'],
    is_public: true,
    created_by_id: DEMO_COACH_ID,
    _count: { saved_by: 196 },
  },
];

// ─── /fasting/history ────────────────────────────────────────────────────────

export const DEMO_FASTING_HISTORY = (() => {
  // One in-progress fast (started ~10h ago) plus a handful of completed 16:8
  // fasts over the past two weeks. FastingScreen reads `start_time` /
  // `end_time` / `target_hours` (snake_case from API), and treats a row with
  // no `end_time` as the active session — that's what drives the live timer.
  const now = new Date('2026-05-02T07:00:00Z');
  const out: Array<{
    id: string;
    user_id: string;
    start_time: string;
    end_time: string | null;
    target_hours: number;
    completed: boolean;
    protocol: string;
  }> = [];

  const activeStart = new Date(now);
  activeStart.setUTCHours(activeStart.getUTCHours() - 10); // 10h elapsed of a 16h target
  out.push({
    id: 'fast-active',
    user_id: DEMO_USER_ID,
    start_time: activeStart.toISOString(),
    end_time: null,
    target_hours: 16,
    completed: false,
    protocol: '16:8',
  });

  for (let i = 1; i <= 8; i++) {
    const start = new Date(now);
    start.setDate(start.getDate() - i);
    start.setUTCHours(20, 0, 0, 0);
    const end = new Date(start);
    end.setUTCHours(end.getUTCHours() + 16);
    out.push({
      id: `fast-${i}`,
      user_id: DEMO_USER_ID,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      target_hours: 16,
      completed: true,
      protocol: '16:8',
    });
  }
  return out;
})();

// ─── /habits ─────────────────────────────────────────────────────────────────

export const DEMO_HABITS = [
  { id: 'habit-water', title: 'Hydrate', target_per_day: 8, kind: 'count' as const },
  { id: 'habit-walk', title: 'Walk after lunch', target_per_day: 1, kind: 'check' as const },
  { id: 'habit-sleep', title: 'Lights out by 10:30', target_per_day: 1, kind: 'check' as const },
];

// ─── /community/feed ─────────────────────────────────────────────────────────

export const DEMO_COMMUNITY_FEED = [
  {
    id: 'win-1',
    user_name: 'Jess R.',
    body: 'Twelve weeks in — first time I have ever stayed consistent through a busy month. The plan made it portable.',
    created_at: '2026-05-01T19:12:00Z',
    reactions: { heart: 24, fire: 11 },
  },
  {
    id: 'win-2',
    user_name: 'Marc D.',
    body: 'Hit my protein number every day this week without thinking about it. The recipe rotation is doing the heavy lifting.',
    created_at: '2026-05-01T08:45:00Z',
    reactions: { heart: 18, fire: 7 },
  },
];

// ─── /messages ───────────────────────────────────────────────────────────────

export const DEMO_MESSAGES = [
  {
    id: 'msg-1',
    body: 'Strong week — your protein is dialled. Let us hold the deficit one more week, then reassess.',
    direction: 'inbound' as const,
    created_at: '2026-05-01T14:30:00Z',
  },
  {
    id: 'msg-2',
    body: 'Sounds good. Travelling Thursday — I will pre-log lunch.',
    direction: 'outbound' as const,
    created_at: '2026-05-01T14:32:00Z',
  },
];

// ─── /auth/me ────────────────────────────────────────────────────────────────

export const DEMO_AUTH_ME = {
  user: DEMO_USER,
  profile: DEMO_USER.profile,
};
