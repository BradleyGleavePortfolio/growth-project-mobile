export interface User {
  id: string;
  role: 'coach' | 'client';
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  coachId?: string;
  status: 'active' | 'archived' | 'pending_verification' | 'verified';
  createdAt: string;
  updatedAt: string;
}

export interface ClientProfile {
  id: string;
  userId: string;
  coachId: string;
  sex?: 'male' | 'female';
  dob?: string;
  currentWeight?: number;
  targetWeight?: number;
  height?: number;
  activityLevel?: 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
  primaryGoal?: 'lose_fast' | 'lose_moderate' | 'maintain' | 'gain' | 'gain_fast' | 'mobility';
  dietType?: string;
  eatHabits?: string;
  foodPrefs?: string;
  restrictions?: string;
  mealsPerDay?: number;
  timeline?: number;
  tdee?: number;
  calorieTarget?: number;
  proteinTarget?: number;
  carbTarget?: number;
  fatTarget?: number;
  gymMembership?: 'yes_regular' | 'yes_occasional' | 'home_gym' | 'no_gym';
  workoutDaysPerWeek?: number;
  fitnessLevel?: 'beginner' | 'intermediate' | 'advanced' | 'athlete';
  preferredSnacks?: string;
  onboardingCompleted: boolean;
  createdAt: string;
  updatedAt: string;
}

export type DietType =
  | 'omnivore'
  | 'vegetarian'
  | 'vegan'
  | 'pescatarian'
  | 'keto'
  | 'paleo'
  | 'mediterranean'
  | 'other';

export type DietRestriction =
  | 'gluten_free'
  | 'dairy_free'
  | 'nut_free'
  | 'shellfish_free'
  | 'soy_free'
  | 'egg_free'
  | 'halal'
  | 'kosher';

export interface FoodLog {
  id: string;
  userId: string;
  coachId: string;
  date: string;
  mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  foodName: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  quantity: number;
  unit: string;
  createdAt: string;
}

export interface WeightLog {
  id: string;
  userId: string;
  coachId: string;
  date: string;
  weight: number;
  unit: 'lbs' | 'kg';
  notes?: string;
  createdAt: string;
}

export interface MealPlan {
  id: string;
  userId: string;
  coachId: string;
  weekStart: string;
  planData: string;
  createdAt: string;
  updatedAt: string;
}

export interface Recipe {
  id: string;
  name: string;
  category: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  servings: number;
  ingredients: string;
  instructions: string;
  tags: string;
  isCustom: boolean;
  userId?: string;
  coachId?: string;
  imageUrl?: string;
  createdAt: string;
}

export interface WaterLog {
  id: string;
  userId: string;
  coachId: string;
  date: string;
  amount: number;
  unit: string;
  createdAt: string;
}

export interface FastingSession {
  id: string;
  userId: string;
  coachId: string;
  startTime: string;
  endTime?: string;
  targetHours: number;
  completed: boolean;
  notes?: string;
  createdAt: string;
}

export interface AuthToken {
  userId: string;
  role: 'coach' | 'client';
  issuedAt: number;
  expiresAt: number;
}

export interface AuthState {
  currentUser: User | null;
  authToken: AuthToken | null;
  role: 'coach' | 'client' | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
export type PrimaryGoal = 'lose_fast' | 'lose_moderate' | 'maintain' | 'gain' | 'gain_fast' | 'mobility';
export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export interface ShoppingItem {
  id: string;
  name: string;
  category: string;
  checked: boolean;
  quantity?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'ai';
  text: string;
  timestamp: string;
}
