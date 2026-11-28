/** S-MWB — route params for the coach Programs stack. */
import type {
  NativeStackNavigationProp,
  NativeStackScreenProps,
} from "@react-navigation/native-stack";

export type ProgramsStackParamList = {
  ProgramsLibrary: undefined;
  ProgramForm: { programId?: string } | undefined;
  ProgramEditor: { programId: string };
  ProgramDayPicker: {
    programId: string;
    week: number;
    day: number;
    mode: "saved" | "copy";
  };
  ProgramAssign: { programId: string };
  ProgramPackages: { programId: string };
  ProgramHistory: { programId: string };
  CoachWorkoutBuilder: { planId?: string; openAi?: boolean } | undefined;
  SupportInbox: undefined;
  MealEditor: { mealId?: string; picked?: { options?: string[]; recipeId?: string | null; at: number } } | undefined;
  DayPlanBuilder: { planId?: string; assigned?: string } | undefined;
  MealPicker: { planId: string; index?: number };
  MealOptionsPicker: { mealId?: string; mealName: string; chosen: string[] };
  MealRecipePicker: { mealId?: string; mealName: string; recipeId: string | null };
  MealPlanAssign: { planId: string };
};

export type ProgramsNav = NativeStackNavigationProp<ProgramsStackParamList>;
export type ProgramsScreenProps<K extends keyof ProgramsStackParamList> =
  NativeStackScreenProps<ProgramsStackParamList, K>;
