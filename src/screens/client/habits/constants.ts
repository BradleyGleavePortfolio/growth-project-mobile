import type { ThemeColors } from '../../../theme/ThemeProvider';
import { Colors } from '../../../constants/colors';

export const MOOD_LABELS = ['', 'Awful', 'Bad', 'Okay', 'Good', 'Great'];
export const MOOD_EMOJIS = ['', 'low', 'off', 'flat', 'good', 'strong'];
export const ENERGY_LABELS = ['', 'Exhausted', 'Low', 'Normal', 'High', 'Energized'];
export const STRESS_LABELS = ['', 'Minimal', 'Low', 'Moderate', 'High', 'Extreme'];
export const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export const HABIT_ICONS: { icon: string; label: string }[] = [
  { icon: 'water', label: 'Water' },
  { icon: 'medical', label: 'Vitamins' },
  { icon: 'leaf', label: 'Veggies' },
  { icon: 'walk', label: 'Steps' },
  { icon: 'body', label: 'Stretch' },
  { icon: 'book', label: 'Read' },
  { icon: 'happy', label: 'Meditate' },
  { icon: 'close-circle', label: 'Avoid' },
  { icon: 'barbell', label: 'Exercise' },
  { icon: 'bed', label: 'Sleep' },
  { icon: 'nutrition', label: 'Eat' },
  { icon: 'checkmark-circle', label: 'Custom' },
];

// Habit colour palette — picker swatches the user assigns per habit.
// Pulled from the new bone/forest palette plus muted secondaries so the
// chosen colour reads as a quiet luxury accent rather than a neon tag.
export function makeHABIT_COLORS(colors: ThemeColors) {
  return [
  colors.primary,        // forest (default)
  colors.primaryDark,    // deep forest
  colors.primaryLight,   // pale forest
  colors.info,           // muted blue
  colors.warning,        // mutedGold
  Colors.border,             // camel
  Colors.templateMobility,             // muted lavender
  Colors.noticeCriticalAccent,             // muted oxblood
  Colors.muscleCore,             // deep teal
  Colors.textSecondary, // charcoal grey
  Colors.textMuted,             // stone
  Colors.primaryLight,             // mid forest
];
}

export interface HabitView {
  id: string;
  name: string;
  icon: string;
  color: string;
  frequency: string;
  targetCount: number;
  unit: string;
  log: { completed: boolean; count: number } | null;
  runDays: number;
  weekDots: boolean[];
}

export type TabMode = 'habits' | 'checkin';
