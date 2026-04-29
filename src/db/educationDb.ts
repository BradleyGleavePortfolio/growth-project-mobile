import { getDatabase } from './database';
import { generateId } from '../utils/date';

export interface Lesson {
  id: string;
  title: string;
  subtitle: string;
  category: string;
  content: string;
  durationMin: number;
  sortOrder: number;
  createdAt: string;
}

export interface LessonProgress {
  id: string;
  userId: string;
  lessonId: string;
  completed: boolean;
  completedAt: string | null;
}

export async function initEducationTables(): Promise<void> {
  const db = await getDatabase();
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS lessons (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      subtitle TEXT NOT NULL,
      category TEXT NOT NULL,
      content TEXT NOT NULL,
      durationMin INTEGER NOT NULL DEFAULT 5,
      sortOrder INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_lessons_category ON lessons(category);

    CREATE TABLE IF NOT EXISTS lesson_progress (
      id TEXT PRIMARY KEY NOT NULL,
      userId TEXT NOT NULL,
      lessonId TEXT NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0,
      completedAt TEXT,
      UNIQUE(userId, lessonId)
    );
    CREATE INDEX IF NOT EXISTS idx_lesson_progress_user ON lesson_progress(userId);
  `);
}

export async function getLessons(): Promise<Lesson[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<Lesson>(
    'SELECT * FROM lessons ORDER BY sortOrder ASC'
  );
  return rows;
}

export async function getLessonById(lessonId: string): Promise<Lesson | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<Lesson>(
    'SELECT * FROM lessons WHERE id = ?',
    [lessonId]
  );
  return row || null;
}

export async function getUserProgress(userId: string): Promise<LessonProgress[]> {
  const db = await getDatabase();
  type LessonProgressRow = Omit<LessonProgress, 'completed'> & { completed: number };
  const rows = await db.getAllAsync<LessonProgressRow>(
    'SELECT * FROM lesson_progress WHERE userId = ?',
    [userId]
  );
  return rows.map((r) => ({ ...r, completed: !!r.completed }));
}

export async function markLessonComplete(userId: string, lessonId: string): Promise<void> {
  const db = await getDatabase();
  const existing = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM lesson_progress WHERE userId = ? AND lessonId = ?',
    [userId, lessonId]
  );
  const now = new Date().toISOString();
  if (existing) {
    await db.runAsync(
      'UPDATE lesson_progress SET completed = 1, completedAt = ? WHERE id = ?',
      [now, existing.id]
    );
  } else {
    const id = 'lp_' + generateId();
    await db.runAsync(
      'INSERT INTO lesson_progress (id, userId, lessonId, completed, completedAt) VALUES (?, ?, ?, 1, ?)',
      [id, userId, lessonId, now]
    );
  }
}

export async function seedLessonsIfNeeded(): Promise<void> {
  const db = await getDatabase();
  const existing = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM lessons'
  );
  if ((existing?.count || 0) > 0) return;

  const now = new Date().toISOString();
  const lessons = [
    {
      title: 'Understanding Calories',
      subtitle: 'The foundation of nutrition',
      category: 'Nutrition Basics',
      durationMin: 5,
      content: `Calories are units of energy your body uses for everything from breathing to exercising. Your body needs a certain number of calories each day just to maintain its current weight — this is called your Total Daily Energy Expenditure (TDEE).\n\nTo lose weight, you need to consume fewer calories than your TDEE (a caloric deficit). To gain weight, consume more (a caloric surplus). A deficit of about 500 calories per day leads to roughly 1 pound of fat loss per week.\n\nKey points:\n• Not all calories are equal — 200 calories of chicken affects your body differently than 200 calories of candy\n• Your TDEE depends on age, sex, weight, height, and activity level\n• Tracking calories helps build awareness, even if you don't track forever\n• Consistency matters more than perfection`,
    },
    {
      title: 'Macronutrients Explained',
      subtitle: 'Protein, carbs, and fat',
      category: 'Nutrition Basics',
      durationMin: 7,
      content: `The three macronutrients provide your body with energy and building blocks:\n\n**Protein (4 cal/g):** Builds and repairs muscle tissue. Essential for recovery. Aim for 0.7–1g per pound of body weight if you're active. Sources: chicken, fish, eggs, Greek yogurt, tofu, legumes.\n\n**Carbohydrates (4 cal/g):** Your body's preferred energy source. Fuels workouts and brain function. Choose complex carbs (oats, rice, sweet potatoes, fruits) over simple sugars. Fiber is a carb that aids digestion.\n\n**Fat (9 cal/g):** Supports hormone production, vitamin absorption, and brain health. Include healthy fats: avocado, olive oil, nuts, fatty fish. Limit trans fats and excessive saturated fat.\n\nA balanced approach typically looks like:\n• Protein: 25–35% of calories\n• Carbs: 35–50% of calories\n• Fat: 20–35% of calories`,
    },
    {
      title: 'Reading Food Labels',
      subtitle: 'Decode what you eat',
      category: 'Nutrition Basics',
      durationMin: 5,
      content: `Food labels can be confusing, but a few key sections matter:\n\n**Serving Size:** Everything else on the label is based on this amount. If you eat double the serving, double all the numbers.\n\n**Calories:** Total energy per serving.\n\n**Protein / Carbs / Fat:** Your three macros. Check these against your daily targets.\n\n**Fiber:** Aim for 25-35g daily. Helps digestion and keeps you full.\n\n**Sodium:** Keep under 2,300mg daily. Processed foods are often high.\n\n**Ingredients list:** Items are listed by weight (most to least). Fewer ingredients usually means less processed.\n\nTips:\n• Compare "per serving" sizes across brands\n• "Low fat" often means "high sugar" — always check\n• Don't stress over every micronutrient — focus on calories and macros first`,
    },
    {
      title: 'Hydration Essentials',
      subtitle: 'Why water matters',
      category: 'Nutrition Basics',
      durationMin: 4,
      content: `Water is involved in virtually every bodily function — digestion, temperature regulation, nutrient transport, and joint lubrication.\n\n**How much?** A good baseline is half your body weight in ounces (e.g., 180 lbs → 90 oz). Increase during exercise, hot weather, or if you drink caffeine.\n\n**Signs of dehydration:**\n• Dark yellow urine\n• Headaches and fatigue\n• Decreased performance\n• Hunger (often confused with thirst)\n\n**Tips for drinking more water:**\n• Keep a water bottle visible at all times\n• Drink a glass before each meal\n• Set hourly reminders\n• Add lemon, cucumber, or berries for flavor\n• Track intake in this app!\n\nHerbal teas and sparkling water count toward your goal. Coffee counts partially but is also a diuretic.`,
    },
    {
      title: 'Meal Timing & Frequency',
      subtitle: 'When should you eat?',
      category: 'Nutrition Basics',
      durationMin: 5,
      content: `There's no single best meal timing. What matters is total daily intake and consistency.\n\n**Common approaches:**\n• 3 meals + 1-2 snacks: Traditional, works well for most people\n• 5-6 small meals: Can help manage hunger, popular with bodybuilders\n• Intermittent fasting (16:8): Eating within an 8-hour window. Can simplify meal prep.\n\n**Pre-workout:** Eat 1-2 hours before training. Focus on carbs + moderate protein. Examples: banana + protein shake, oatmeal + eggs.\n\n**Post-workout:** Within 1-2 hours after training. Prioritize protein + carbs for recovery. Examples: chicken + rice, protein shake + fruit.\n\n**Before bed:** A casein-rich snack (cottage cheese, Greek yogurt) provides slow-releasing protein during sleep.\n\nThe right meal timing is the one you can maintain consistently.`,
    },
    {
      title: 'Protein Power',
      subtitle: 'Your muscle-building macro',
      category: 'Muscle Building',
      durationMin: 6,
      content: `Protein is the key macronutrient for body composition. Here's why:\n\n**Benefits:**\n• Builds and repairs muscle tissue after workouts\n• Has the highest thermic effect (your body burns ~25% of protein calories during digestion)\n• Keeps you feeling full longer than carbs or fat\n• Preserves muscle during a caloric deficit\n\n**How much?** Aim for 0.7-1g per pound of body weight daily. Spread across 3-5 meals for optimal absorption.\n\n**Top protein sources:**\n• Chicken breast: 31g per 4oz\n• Greek yogurt: 15-20g per cup\n• Eggs: 6g each\n• Fish (salmon, tuna): 25-30g per 4oz\n• Lean beef: 28g per 4oz\n• Tofu: 10g per 4oz\n• Whey protein: 25g per scoop\n\n**Tips:**\n• Prep protein in bulk on weekends\n• Keep protein snacks handy (jerky, cheese sticks, hard-boiled eggs)\n• A protein shake is a convenient supplement, not a replacement for whole foods`,
    },
    {
      title: 'Smart Carb Choices',
      subtitle: 'Fuel without the crash',
      category: 'Muscle Building',
      durationMin: 5,
      content: `Carbs aren't the enemy — they're your body's primary fuel source. The key is choosing the right ones.\n\n**Complex carbs (choose these):**\n• Oats, brown rice, quinoa\n• Sweet potatoes, whole wheat bread\n• Fruits, beans, lentils\n• These digest slowly, providing steady energy\n\n**Simple carbs (limit these):**\n• Sugar, candy, soda\n• White bread, pastries\n• These spike blood sugar and crash energy\n\n**When to eat carbs:**\n• Before workouts: Complex carbs for sustained energy\n• After workouts: Faster carbs + protein for recovery\n• Throughout the day: Pair with protein and fat to slow digestion\n\n**Fiber is your friend:**\n• Aim for 25-35g daily\n• Keeps you full, aids digestion\n• Found in vegetables, fruits, whole grains, legumes\n\nDon't fear carbs — just choose wisely and time them around activity.`,
    },
    {
      title: 'Healthy Fats Guide',
      subtitle: 'Essential but calorie-dense',
      category: 'Muscle Building',
      durationMin: 5,
      content: `Fats are essential for hormone production, brain function, and vitamin absorption. At 9 calories per gram, they're calorie-dense, so portions matter.\n\n**Healthy fats to include:**\n• Avocado and avocado oil\n• Olive oil and olives\n• Nuts and nut butters (almonds, walnuts, cashews)\n• Seeds (chia, flax, hemp)\n• Fatty fish (salmon, mackerel, sardines)\n• Eggs (the yolk has the good stuff)\n\n**Fats to limit:**\n• Trans fats (partially hydrogenated oils — avoid completely)\n• Excessive saturated fat (limit to <10% of calories)\n• Fried foods and processed snacks\n\n**Practical tips:**\n• Measure oils and nut butters — they add up fast\n• Cook with olive oil or avocado oil\n• Snack on a small handful of nuts (about 1oz)\n• Include fatty fish 2-3 times per week for omega-3s\n\nFat doesn't make you fat. Excess calories do.`,
    },
    {
      title: 'Workout Nutrition',
      subtitle: 'Pre and post workout fueling',
      category: 'Muscle Building',
      durationMin: 6,
      content: `What you eat around your workouts can significantly impact performance and recovery.\n\n**Pre-Workout (1-2 hours before):**\nGoal: Energy without heaviness\n• 30-50g complex carbs + 15-25g protein\n• Examples: Oatmeal + protein powder, banana + PB toast, chicken + rice (small portion)\n• Avoid high fat/fiber right before — they slow digestion\n\n**During Workout:**\n• Water is usually enough for sessions under 60 minutes\n• For longer sessions: sports drink or fast carbs (gummy bears, etc.)\n\n**Post-Workout (within 1-2 hours):**\nGoal: Recovery and muscle repair\n• 25-40g protein + 40-80g carbs\n• Examples: Protein shake + banana, chicken + sweet potato, eggs + toast\n• This is when your muscles are most receptive to nutrients\n\n**Hydration:**\n• Drink 16-20oz water 2 hours before training\n• Sip during workout\n• Replenish with 16-24oz per pound of sweat lost`,
    },
    {
      title: 'Supplements 101',
      subtitle: 'What works and what doesn\'t',
      category: 'Muscle Building',
      durationMin: 6,
      content: `Supplements aren't necessary if your diet is solid. A few are well-researched:\n\n**Worth considering:**\n• Creatine monohydrate: 5g daily. Improves strength, power, and muscle recovery. Among the most studied.\n• Whey protein: Convenient way to hit protein goals. Not magic — just food in powder form.\n• Vitamin D: Many people are deficient. Get levels checked; supplement if needed (1000-5000 IU daily).\n• Fish oil/Omega-3: If you don't eat fish regularly, 1-2g EPA+DHA daily.\n• Magnesium: Supports sleep and recovery. Many people are low.\n\n**Save your money:**\n• BCAAs: Unnecessary if you eat enough protein\n• Fat burners: Mostly caffeine with marketing\n• Testosterone boosters: Don't work\n• Most pre-workouts: Just caffeine + beta-alanine. Coffee works.\n\n**Rules of thumb:**\n• Food first, supplements second\n• Look for third-party testing (NSF, Informed Sport)\n• More expensive doesn't mean more effective`,
    },
    {
      title: 'Building a Home Workout',
      subtitle: 'No gym required',
      category: 'Fitness',
      durationMin: 5,
      content: `You don't need a gym to build strength and fitness. Here's how to structure effective home workouts:\n\n**Equipment worth having:**\n• Resistance bands (set of 3-5)\n• Pull-up bar (doorway mount)\n• Pair of adjustable dumbbells\n• Exercise mat\n\n**Bodyweight exercises by muscle group:**\n• Chest: Push-ups (incline, decline, diamond, wide)\n• Back: Pull-ups, inverted rows, band pull-aparts\n• Legs: Squats, lunges, step-ups, wall sits, glute bridges\n• Core: Planks, dead bugs, mountain climbers, leg raises\n• Shoulders: Pike push-ups, band lateral raises\n\n**Sample workout structure:**\n1. Warm-up: 5 min (jumping jacks, arm circles, hip openers)\n2. Strength circuit: 3-4 rounds of 4-5 exercises, 10-15 reps each\n3. Finisher: 5 min AMRAP (as many rounds as possible)\n4. Cool-down: 5 min stretching\n\nProgression: Add reps, slow the tempo, add pauses, or use bands/weights.`,
    },
    {
      title: 'Progressive Overload',
      subtitle: 'The key to getting stronger',
      category: 'Fitness',
      durationMin: 5,
      content: `Progressive overload means gradually increasing the demands on your muscles over time. Without it, your body has no reason to adapt and grow.\n\n**Ways to progressively overload:**\n• Add weight (even 2.5-5 lbs)\n• Add reps (8→10→12 before increasing weight)\n• Add sets (3→4 sets)\n• Slow the tempo (3 seconds down, 1 second up)\n• Decrease rest time\n• Increase range of motion\n\n**How to implement:**\nWeek 1: Bench press 135 lbs × 3 sets × 8 reps\nWeek 2: 135 lbs × 3 sets × 10 reps\nWeek 3: 135 lbs × 3 sets × 12 reps\nWeek 4: 140 lbs × 3 sets × 8 reps (increase weight, reset reps)\n\n**Important notes:**\n• Progress isn't always linear — some weeks you maintain\n• Track your workouts to ensure you're progressing\n• Form always comes before weight\n• Recovery is when growth happens — don't skip rest days`,
    },
    {
      title: 'Rest & Recovery',
      subtitle: 'Growth happens when you rest',
      category: 'Fitness',
      durationMin: 5,
      content: `Training breaks your muscles down. Rest and recovery build them back stronger.\n\n**Sleep (the #1 recovery tool):**\n• Aim for 7-9 hours per night\n• Growth hormone peaks during deep sleep\n• Poor sleep increases cortisol, hunger hormones, and injury risk\n• Tips: Dark room, cool temp (65-68°F), no screens 30 min before bed\n\n**Rest days:**\n• Take at least 1-2 full rest days per week\n• Active recovery (walking, yoga, light stretching) is fine\n• Same muscle group needs 48-72 hours between intense sessions\n\n**Other recovery strategies:**\n• Proper nutrition (especially protein and carbs post-workout)\n• Hydration\n• Foam rolling and stretching\n• Stress management (meditation, deep breathing)\n\n**Signs you need more rest:**\n• Persistent fatigue or soreness\n• Decreased performance\n• Mood changes or irritability\n• Getting sick frequently\n• Trouble sleeping despite being tired`,
    },
    {
      title: 'Cardio & Fat Loss',
      subtitle: 'Finding the right balance',
      category: 'Fitness',
      durationMin: 5,
      content: `Cardio is great for heart health and can support fat loss, but it's not the only way to burn calories.\n\n**Types of cardio:**\n• LISS (Low-Intensity Steady State): Walking, easy cycling, swimming. 30-60 min. Burns fat, easy to recover from.\n• HIIT (High-Intensity Interval Training): Sprints, burpees, battle ropes. 15-25 min. Burns more calories per minute, increases EPOC (afterburn).\n• NEAT (Non-Exercise Activity Thermogenesis): Walking to work, taking stairs, fidgeting. Often accounts for more daily calories than formal exercise.\n\n**Fat loss priorities (in order):**\n1. Caloric deficit (nutrition is #1)\n2. Strength training (preserves muscle)\n3. NEAT (walk more throughout the day)\n4. Formal cardio (supplementary tool)\n\n**Recommended approach:**\n• 3-4 strength sessions per week\n• 2-3 cardio sessions (mix of LISS and HIIT)\n• 8,000-10,000 steps daily\n• Don't out-cardio a bad diet — nutrition comes first`,
    },
    {
      title: 'Stretching & Mobility',
      subtitle: 'Move better, feel better',
      category: 'Fitness',
      durationMin: 4,
      content: `Mobility work prevents injury, improves exercise form, and reduces everyday aches.\n\n**Before workouts (dynamic stretching):**\n• Arm circles, leg swings, hip circles\n• Walking lunges, high knees\n• Cat-cow, thoracic rotations\n• 5-10 minutes to increase blood flow and range of motion\n\n**After workouts (static stretching):**\nHold each stretch 20-30 seconds:\n• Hamstring stretch, quad stretch\n• Chest/doorway stretch\n• Child's pose, pigeon pose\n• Neck and shoulder rolls\n\n**Key areas to focus on:**\n• Hip flexors (tight from sitting)\n• Thoracic spine (improves posture)\n• Ankles (important for squats)\n• Shoulders (needed for overhead movements)\n\n**Daily mobility routine (5 min):**\n1. Cat-cow: 10 reps\n2. World's greatest stretch: 5 per side\n3. Deep squat hold: 30 seconds\n4. Wall angels: 10 reps\n5. Hip 90/90: 30 sec per side`,
    },
    {
      title: 'Meal Prep Basics',
      subtitle: 'Save time and stay on track',
      category: 'Lifestyle',
      durationMin: 6,
      content: `Meal prepping is the most reliable strategy for consistent nutrition. It removes daily decision fatigue.\n\n**Getting started:**\n1. Pick 2-3 proteins, 2-3 carb sources, and 2-3 veggie options\n2. Cook in bulk on Sunday (and optionally Wednesday)\n3. Portion into containers\n4. Store in fridge (3-4 days) or freezer (2-3 months)\n\n**Easy meal prep proteins:**\n• Baked chicken thighs or breasts\n• Ground turkey/beef\n• Hard-boiled eggs\n• Canned tuna/salmon\n\n**Easy carb sources:**\n• Rice (batch cook in rice cooker)\n• Sweet potatoes (bake a sheet pan full)\n• Pasta (cook once, portion out)\n• Quinoa\n\n**Vegetables:**\n• Roasted broccoli, green beans, Brussels sprouts\n• Pre-washed salad mix\n• Frozen stir-fry vegetables\n\n**Pro tips:**\n• Invest in good containers (glass lasts longer)\n• Use different sauces/seasonings for variety\n• Prep snacks too: cut veggies, portioned nuts, yogurt cups`,
    },
    {
      title: 'Eating Out Strategies',
      subtitle: 'Stay on track at restaurants',
      category: 'Lifestyle',
      durationMin: 5,
      content: `Eating out doesn't have to derail your progress. Use these strategies:\n\n**Before you go:**\n• Check the menu online and pre-decide your order\n• Eat a small protein-rich snack so you're not starving\n• Plan this meal into your daily calories\n\n**At the restaurant:**\n• Start with water, not bread\n• Order protein + vegetables as your base\n• Ask for dressings and sauces on the side\n• Choose grilled, baked, or steamed over fried\n• Share an appetizer or dessert instead of solo\n\n**Smart swaps:**\n• Fries → side salad or steamed veggies\n• Creamy soup → broth-based soup\n• Soda → sparkling water with lemon\n• Pasta → extra vegetables or half portion\n\n**Fast food survival guide:**\n• Grilled chicken sandwich (skip the mayo)\n• Burrito bowl (no tortilla, extra protein)\n• Salads with grilled protein (dressing on side)\n\nRemember: One restaurant meal won't ruin your progress. It's what you do consistently that matters.`,
    },
    {
      title: 'Managing Cravings',
      subtitle: 'Work with your body, not against it',
      category: 'Lifestyle',
      durationMin: 5,
      content: `Cravings are normal and not a sign of weakness. Understanding them helps you manage them.\n\n**Why cravings happen:**\n• Restricting too aggressively (deficit too large)\n• Not eating enough protein or fiber\n• Stress, boredom, or emotional triggers\n• Dehydration (thirst mimics hunger)\n• Poor sleep (increases ghrelin, the hunger hormone)\n\n**Strategies that work:**\n• The 80/20 rule: Eat nutritious food 80% of the time, enjoy treats 20%\n• Don't ban foods — this increases cravings\n• Find healthier versions: protein ice cream, dark chocolate, fruit + PB\n• Wait 15 minutes — cravings often pass\n• Drink water first\n• Ask: "Am I hungry or just bored/stressed?"\n\n**Build treats into your plan:**\n• A daily small treat (150-200 cal) prevents binge episodes\n• Weekly free meal where you don't track (not a "cheat" — that implies wrongdoing)\n• Focus on portion, not restriction\n\nSustainable nutrition includes foods you enjoy.`,
    },
    {
      title: 'Stress & Weight',
      subtitle: 'The cortisol connection',
      category: 'Lifestyle',
      durationMin: 5,
      content: `Chronic stress directly impacts your weight and body composition through the hormone cortisol.\n\n**How stress affects your body:**\n• Elevated cortisol promotes fat storage (especially around the midsection)\n• Increases appetite and cravings for high-calorie foods\n• Disrupts sleep quality\n• Impairs recovery from workouts\n• Can cause water retention (masking fat loss on the scale)\n\n**Stress management strategies:**\n• Exercise (natural cortisol regulator)\n• Sleep 7-9 hours consistently\n• Meditation or deep breathing (even 5 minutes helps)\n• Time in nature\n• Social connection\n• Journaling\n• Setting boundaries (saying no)\n\n**Practical daily routine:**\nMorning: 5 min deep breathing or meditation\nMidDay: 10 min walk outside\nEvening: No screens 30 min before bed, gratitude journal\n\n**Remember:**\nYou can't out-exercise or out-diet chronic stress. Managing stress is not optional — it's a core part of any health journey.`,
    },
    {
      title: 'Building Lasting Habits',
      subtitle: 'Small changes, big results',
      category: 'Lifestyle',
      durationMin: 6,
      content: `Motivation fades. Habits last. Here's the science of building habits that stick.\n\n**The habit loop:**\n1. Cue (trigger that starts the behavior)\n2. Routine (the behavior itself)\n3. Reward (the benefit you get)\n\n**Start tiny:**\n• Don't say "I'll work out 5x/week" — say "I'll do 5 push-ups after my morning coffee"\n• Don't say "I'll meal prep all week" — say "I'll prep tomorrow's lunch tonight"\n• Success builds momentum\n\n**Stack habits:**\nAttach new habits to existing ones:\n• "After I pour my coffee, I'll drink a glass of water"\n• "After I park at work, I'll walk an extra 5 minutes"\n• "After dinner, I'll prep tomorrow's lunch"\n\n**Track and celebrate:**\n• Use this app's habit tracker.\n• Don't break the chain — visual streaks are powerful\n• Celebrate small wins (not with food — with acknowledgment)\n\n**When you slip:**\n• Never miss twice in a row\n• A bad day doesn't erase a good week\n• Progress is not perfection\n• The best plan is the one you actually follow`,
    },
  ];

  for (let i = 0; i < lessons.length; i++) {
    const l = lessons[i];
    const id = 'lesson_' + generateId();
    await db.runAsync(
      `INSERT INTO lessons (id, title, subtitle, category, content, durationMin, sortOrder, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, l.title, l.subtitle, l.category, l.content, l.durationMin, i + 1, now]
    );
  }
}
