import { ClientProfile } from '../types';

interface GuideContext {
  firstName: string;
  profile: ClientProfile | null;
  daysSinceStart: number;
  loggingStreak: number;
}

type Intent = {
  name: string;
  keywords: string[];
  respond: (ctx: GuideContext) => string;
};

function goalLabel(goal?: string): string {
  switch (goal) {
    case 'lose_fast': return 'rapid fat loss';
    case 'lose_moderate': return 'steady weight loss';
    case 'maintain': return 'maintenance';
    case 'gain': return 'lean muscle gain';
    case 'gain_fast': return 'aggressive bulking';
    case 'mobility': return 'mobility & wellness';
    default: return 'your fitness';
  }
}

function isLossGoal(goal?: string): boolean {
  return goal === 'lose_fast' || goal === 'lose_moderate';
}

function isGainGoal(goal?: string): boolean {
  return goal === 'gain' || goal === 'gain_fast';
}

const intents: Intent[] = [
  {
    name: 'GREETING',
    keywords: ['hi', 'hello', 'hey', 'good morning', 'sup', 'what\'s up', 'howdy'],
    respond: (ctx) =>
      `Hey ${ctx.firstName}! Great to see you. You're on day ${ctx.daysSinceStart} of your journey. What can I help you with today?`,
  },
  {
    name: 'CALORIES',
    keywords: ['calorie', 'calories', 'how much should i eat', 'daily intake', 'tdee'],
    respond: (ctx) => {
      const target = ctx.profile?.calorieTarget || 2000;
      const tdee = ctx.profile?.tdee || 2400;
      const diff = Math.round(tdee - target);
      if (diff > 0) {
        return `Your daily target is ${Math.round(target)} calories based on your ${goalLabel(ctx.profile?.primaryGoal)} goal. That's ${diff} calories below your TDEE of ${Math.round(tdee)} to keep you on track for fat loss.`;
      }
      if (diff < 0) {
        return `Your daily target is ${Math.round(target)} calories — that's ${Math.abs(diff)} above your TDEE of ${Math.round(tdee)} to support muscle growth. Make sure you're hitting your protein target too.`;
      }
      return `Your daily target is ${Math.round(target)} calories, right at your TDEE of ${Math.round(tdee)}. Perfect for maintenance — keep it consistent.`;
    },
  },
  {
    name: 'PROTEIN',
    keywords: ['protein', 'how much protein', 'muscle', 'gains'],
    respond: (ctx) => {
      const pTarget = ctx.profile?.proteinTarget || 150;
      const meals = ctx.profile?.mealsPerDay || 3;
      const perMeal = Math.round(pTarget / meals);
      return `Aim for ${Math.round(pTarget)}g of protein per day — that's about ${perMeal}g per meal if you eat ${meals} times a day. Great sources: chicken breast (31g/4oz), Greek yogurt (15g/cup), eggs (6g each), salmon (25g/4oz).`;
    },
  },
  {
    name: 'MACROS',
    keywords: ['macros', 'macro', 'carbs', 'fat', 'breakdown', 'macro split'],
    respond: (ctx) => {
      const p = ctx.profile?.proteinTarget || 150;
      const c = ctx.profile?.carbTarget || 200;
      const f = ctx.profile?.fatTarget || 55;
      return `Your macro targets: ${Math.round(p)}g protein / ${Math.round(c)}g carbs / ${Math.round(f)}g fat. Protein is your priority for ${goalLabel(ctx.profile?.primaryGoal)}. Hit protein first, then fill the rest with carbs and fats.`;
    },
  },
  {
    name: 'WEIGHT_LOSS',
    keywords: ['lose weight', 'weight loss', 'cut', 'deficit', 'slim', 'lean out', 'shred'],
    respond: (ctx) => {
      if (ctx.profile?.primaryGoal === 'lose_fast') {
        return `For rapid fat loss, stick to your ${Math.round(ctx.profile?.calorieTarget || 1600)} calorie target, prioritize protein (${Math.round(ctx.profile?.proteinTarget || 150)}g/day), and add 3-4 cardio sessions per week. A 750-1000 calorie deficit is aggressive but effective short-term. Consider 16:8 fasting to make it easier.`;
      }
      return `For steady, sustainable weight loss: hit your ${Math.round(ctx.profile?.calorieTarget || 1800)} calorie target daily, get ${Math.round(ctx.profile?.proteinTarget || 150)}g protein to preserve muscle, and stay active. A 500 calorie deficit loses about 1 lb/week. Patience wins the race.`;
    },
  },
  {
    name: 'MUSCLE_GAIN',
    keywords: ['gain muscle', 'bulk', 'build muscle', 'mass', 'grow', 'bigger', 'size'],
    respond: (ctx) => {
      if (ctx.profile?.primaryGoal === 'gain_fast') {
        return `For aggressive gains, eat at ${Math.round(ctx.profile?.calorieTarget || 3000)} calories with ${Math.round(ctx.profile?.proteinTarget || 180)}g protein. Train heavy compound lifts 4-5x/week: squats, deadlifts, bench, overhead press, rows. Progressive overload is key — add weight or reps every week.`;
      }
      return `For lean muscle gain, maintain your ${Math.round(ctx.profile?.calorieTarget || 2600)} calorie surplus with ${Math.round(ctx.profile?.proteinTarget || 170)}g protein. Focus on compound movements 3-4x/week with progressive overload. Eat 1g of protein per pound of body weight for optimal growth.`;
    },
  },
  {
    name: 'FASTING',
    keywords: ['fast', 'fasting', 'intermittent', '16:8', 'skip breakfast', 'eating window'],
    respond: (ctx) => {
      const goal = ctx.profile?.primaryGoal;
      if (isLossGoal(goal)) {
        return `Fasting can be a powerful tool for ${goalLabel(goal)}. I'd recommend 16:8 — eat in an 8-hour window (like 12pm-8pm). It naturally reduces calories and improves insulin sensitivity. Check the Fasting tab to start a session.`;
      }
      if (isGainGoal(goal)) {
        return `For muscle gain, long fasts aren't ideal since you need consistent protein intake. If you want to try it, stick to 12:12 max so you can still hit your ${Math.round(ctx.profile?.calorieTarget || 2800)} calorie and ${Math.round(ctx.profile?.proteinTarget || 170)}g protein targets.`;
      }
      return `Fasting can help with maintenance and metabolic health. A 14:10 or 16:8 protocol works well. Just make sure you're still hitting your daily nutrition targets within your eating window. Check the Fasting tab to try it.`;
    },
  },
  {
    name: 'MEAL_IDEAS',
    keywords: ['meal', 'food', 'recipe', 'what should i eat', 'meal idea', 'suggestions', 'meal prep', 'what to eat'],
    respond: (ctx) => {
      if (isLossGoal(ctx.profile?.primaryGoal)) {
        return `For ${goalLabel(ctx.profile?.primaryGoal)}, here are some great options:\n\n• Breakfast: Greek yogurt bowl with berries (350 cal, 30g protein)\n• Lunch: Grilled chicken salad with avocado (450 cal, 42g protein)\n• Dinner: Salmon with roasted vegetables (480 cal, 38g protein)\n\nCheck the Recipes tab for 80+ ideas you can filter by goal!`;
      }
      if (isGainGoal(ctx.profile?.primaryGoal)) {
        return `For ${goalLabel(ctx.profile?.primaryGoal)}, you need calorie-dense meals:\n\n• Breakfast: Oatmeal with PB, banana, and protein powder (650 cal, 40g protein)\n• Lunch: Turkey burger with sweet potato fries (700 cal, 45g protein)\n• Dinner: Steak with rice and broccoli (750 cal, 50g protein)\n\nCheck the Recipes tab for more high-calorie meal ideas!`;
      }
      return `Here are some balanced meal ideas:\n\n• Breakfast: Overnight oats with protein powder (400 cal, 28g protein)\n• Lunch: Chicken stir-fry with brown rice (500 cal, 35g protein)\n• Dinner: Baked cod with quinoa and veggies (450 cal, 32g protein)\n\nBrowse the Recipes tab for 80+ recipes you can filter by preference!`;
    },
  },
  {
    name: 'MOTIVATION',
    keywords: ['motivated', 'motivation', 'struggling', 'hard', 'giving up', 'unmotivated', 'help', 'frustrated', 'discouraged', 'quit'],
    respond: (ctx) => {
      const msgs = [
        `I hear you, ${ctx.firstName}. But here's the truth: you're on day ${ctx.daysSinceStart} and still showing up. That counts for more than you think. Progress isn't always linear — consistency is what separates people who transform from people who quit.`,
        `${ctx.firstName}, remember why you started. You chose ${goalLabel(ctx.profile?.primaryGoal)} because it matters to you. You've been at this for ${ctx.daysSinceStart} days. Don't let one hard day erase all that progress. Just do one thing today — log one meal, take a walk, drink some water.`,
        `Tough days are part of the process, ${ctx.firstName}. Every person who's ever transformed their body had days where they wanted to quit. The difference? They didn't. You're ${ctx.daysSinceStart} days in — that's ${ctx.daysSinceStart} days of proof that you can do this.`,
      ];
      return msgs[ctx.daysSinceStart % msgs.length];
    },
  },
  {
    name: 'TRAINING',
    keywords: ['workout', 'exercise', 'gym', 'training', 'lift', 'cardio', 'run', 'routine', 'program'],
    respond: (ctx) => {
      if (isLossGoal(ctx.profile?.primaryGoal)) {
        return `For ${goalLabel(ctx.profile?.primaryGoal)}, combine strength and cardio:\n\n• 3x/week: Full body strength (squats, deadlifts, bench press, rows)\n• 2-3x/week: Cardio (HIIT or 30-min brisk walks)\n• Keep lifting heavy to preserve muscle while losing fat\n• Don't over-cardio — it increases hunger and cortisol`;
      }
      if (isGainGoal(ctx.profile?.primaryGoal)) {
        return `For ${goalLabel(ctx.profile?.primaryGoal)}, prioritize progressive overload:\n\n• 4-5x/week: Push/Pull/Legs split or Upper/Lower\n• Focus on compound lifts: squat, bench, deadlift, OHP, rows\n• Increase weight by 2.5-5 lbs when you hit your rep target\n• Minimize cardio to 1-2 light sessions per week\n• Rest 2-3 minutes between heavy sets`;
      }
      return `For ${goalLabel(ctx.profile?.primaryGoal)}, a balanced approach works best:\n\n• 3-4x/week: Strength training (full body or upper/lower split)\n• 2x/week: Moderate cardio (running, cycling, swimming)\n• 1x/week: Flexibility/mobility work (yoga, stretching)\n• Listen to your body and prioritize recovery`;
    },
  },
  {
    name: 'WATER',
    keywords: ['water', 'hydration', 'drink', 'fluid', 'thirsty'],
    respond: (ctx) => {
      const weight = ctx.profile?.currentWeight || 160;
      const oz = Math.round(weight * 0.5);
      const glasses = Math.round(oz / 8);
      return `Aim for at least ${oz} fl oz of water per day — that's about ${glasses} glasses. Proper hydration boosts metabolism, reduces hunger, and improves performance. Track it in the Log tab with the water tracker. Tip: drink a glass before each meal.`;
    },
  },
  {
    name: 'SHOPPING',
    keywords: ['grocery', 'shopping', 'grocery list', 'buy', 'store', 'bulk buy'],
    respond: (ctx) =>
      `Here are my top shopping tips:\n\n• Shop the perimeter of the store — produce, proteins, dairy\n• Buy protein in bulk: chicken breast, ground turkey, eggs, Greek yogurt\n• Stock up on frozen vegetables — they're just as nutritious and last longer\n• Prep-friendly staples: rice, oats, sweet potatoes, canned beans\n\nCheck your Plan tab and tap the cart icon to auto-generate a shopping list from your meal plan!`,
  },
  {
    name: 'FAMILY',
    keywords: ['family', 'kids', 'spouse', 'partner', 'husband', 'wife', 'picky'],
    respond: (ctx) =>
      `Family buy-in is real, ${ctx.firstName}. Here's what works:\n\n• Swap one meal a week with a healthier version they already like\n• Cook base ingredients separately — same chicken, different sauces for you vs. family\n• Involve kids in meal prep — they eat what they help make\n• Don't label food as "diet food" — it's just good food\n• Small wins compound into big lifestyle changes`,
  },
  {
    name: 'CHEAT_MEAL',
    keywords: ['cheat', 'cheat meal', 'pizza', 'dessert', 'treat', 'splurge', 'ice cream', 'burger'],
    respond: (ctx) =>
      `One planned treat meal per week won't derail you — it can actually help sustainability and boost leptin levels. The key rules:\n\n• Plan it, don't binge spontaneously\n• Log it honestly in the app — awareness matters\n• Pick one meal, not a whole cheat day\n• Get right back on track the next meal\n• Don't "earn" it with extreme restriction — that leads to cycles`,
  },
  {
    name: 'PLATEAU',
    keywords: ['plateau', 'stuck', 'not losing', 'same weight', 'stopped', 'stalled', 'stall'],
    respond: (ctx) =>
      `Plateaus are normal after 4–6 weeks. Here's how to break through:\n\n• Zigzag calories: eat at maintenance 2 days/week, deficit the other 5\n• Increase protein by 20g per day to boost metabolism\n• Add a daily 30-minute walk (NEAT is underrated)\n• Try a 1-week diet break at maintenance — it resets hormones\n• Re-measure: take photos and measurements, not just scale weight\n\nIf you've truly stalled for 3+ weeks, your body may have adapted. Time to recalculate your targets.`,
  },
  {
    name: 'SLEEP',
    keywords: ['sleep', 'tired', 'fatigue', 'rest', 'recovery', 'insomnia', 'exhausted'],
    respond: (ctx) =>
      `Sleep is when your body actually changes — muscle repair, hormone regulation, fat metabolism all happen during deep sleep.\n\n• Aim for 7–9 hours per night\n• Poor sleep spikes cortisol by up to 45%, stalling fat loss and muscle gain\n• Tips: no screens 1hr before bed, cool dark room (65-68°F), consistent bedtime\n• Avoid caffeine after 2pm\n• Magnesium before bed can improve sleep quality`,
  },
  {
    name: 'SUPPLEMENT',
    keywords: ['supplement', 'protein powder', 'creatine', 'pre-workout', 'vitamins', 'whey'],
    respond: (ctx) =>
      `The three supplements worth your money:\n\n1. **Creatine monohydrate** (5g/day, always) — the most researched supplement, improves strength and recovery\n2. **Protein powder** — only if you can't hit ${Math.round(ctx.profile?.proteinTarget || 150)}g from food. Whey isolate post-workout is ideal\n3. **Vitamin D** (2000-5000 IU/day) — if you're indoors a lot or live in a northern climate\n\nEverything else (BCAAs, fat burners, test boosters) is mostly marketing. Save your money.`,
  },
  {
    name: 'COACH',
    keywords: ['coach', 'my coach', 'contact coach', 'talk to coach', 'message coach'],
    respond: (ctx) =>
      `Your coach is available through the app. Head to the Messages tab to send them a note — they typically respond within 24 hours. Your coach can help with:\n\n• Adjusting your calorie and macro targets\n• Custom meal plans tailored to your preferences\n• Workout programming\n• Navigating plateaus and challenges`,
  },
  {
    name: 'PROGRESS',
    keywords: ['progress', 'how am i doing', 'results', 'results so far', 'check in', 'stats'],
    respond: (ctx) =>
      `Check the Progress tab for your weight chart, streak, and body stats. You've been on your journey for ${ctx.daysSinceStart} days${ctx.loggingStreak > 0 ? ` with a ${ctx.loggingStreak}-day logging streak` : ''}. Consistency is everything — the people who track daily lose 2x more weight than those who don't. Keep it up, ${ctx.firstName}!`,
  },
];

const fallbackResponses = [
  'The top recommendation: stay consistent with logging your food. People who track daily are 2x more likely to reach their goals.',
  'Keep showing up every day. Small, consistent actions beat big sporadic efforts every time. Have you logged your meals today?',
  'Check your macros in the Log tab — hitting your protein target is the single most impactful thing you can do for body composition.',
  'Remember: nutrition is about 80% of your results. The gym builds the muscle, but the kitchen reveals it. What are you eating today?',
  'Consistency over perfection. You don\'t need to be perfect — you just need to be good enough, often enough. How can I help you stay on track?',
];

let fallbackIndex = 0;

export function getAIResponse(message: string, context: GuideContext): string {
  const lower = message.toLowerCase();

  for (const intent of intents) {
    for (const keyword of intent.keywords) {
      if (lower.includes(keyword)) {
        return intent.respond(context);
      }
    }
  }

  const response = fallbackResponses[fallbackIndex % fallbackResponses.length];
  fallbackIndex++;
  return response;
}
