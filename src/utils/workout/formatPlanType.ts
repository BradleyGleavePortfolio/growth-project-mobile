/** "strength" -> "Strength", "hiit_cardio" -> "Hiit cardio". */
export function formatPlanType(type: string | null | undefined): string {
  if (!type) return 'Workout';
  const words = type.replace(/[_-]+/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : 'Workout';
}
