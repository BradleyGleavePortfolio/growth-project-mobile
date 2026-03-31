import { create } from 'zustand';
import { logApi, profileApi } from '../services/api';
import { getTodayString } from '../utils/date';
import { MealType, FoodLog } from '../types';

interface DailyTotals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

interface ClientStore {
  selectedDate: string;
  foodLogs: FoodLog[];
  dailyTotals: DailyTotals;
  waterOz: number;
  isLoading: boolean;

  setSelectedDate: (date: string) => void;
  loadDayData: (userId: string, date?: string) => Promise<void>;
  loadProfile: (userId: string) => Promise<void>;
  logFood: (data: {
    userId: string;
    date: string;
    mealType: MealType;
    foodItemId: string;
    quantityMultiplier?: number;
    notes?: string;
  }) => Promise<void>;
  logWater: (userId: string, coachId: string, amount: number) => Promise<void>;
}

export const useClientStore = create<ClientStore>((set, get) => ({
  selectedDate: getTodayString(),
  foodLogs: [],
  dailyTotals: { calories: 0, protein: 0, carbs: 0, fat: 0 },
  waterOz: 0,
  isLoading: false,

  setSelectedDate: (date: string) => set({ selectedDate: date }),

  loadDayData: async (_userId: string, date?: string) => {
    try {
      set({ isLoading: true });
      const d = date || get().selectedDate;
      const response = await logApi.getDaily(d);
      const data = response.data;

      // Map entries to FoodLog shape
      const logs: FoodLog[] = (data.entries || []).map((e: any) => ({
        id: e.id,
        foodItemId: e.food_item_id,
        foodName: e.food_item?.name || '',
        name: e.food_item?.name || '',
        calories: Math.round((e.food_item?.calories || 0) * e.quantity_multiplier),
        protein: Math.round((e.food_item?.protein_g || 0) * e.quantity_multiplier),
        carbs: Math.round((e.food_item?.carbs_g || 0) * e.quantity_multiplier),
        fat: Math.round((e.food_item?.fat_g || 0) * e.quantity_multiplier),
        mealType: e.meal_type,
        date: d,
        quantity: e.quantity_multiplier,
        unit: 'serving',
        userId: e.user_id,
        coachId: '',
      }));

      set({
        foodLogs: logs,
        dailyTotals: {
          calories: data.total_calories || 0,
          protein: data.total_protein_g || 0,
          carbs: data.total_carbs_g || 0,
          fat: data.total_fat_g || 0,
        },
        selectedDate: d,
        isLoading: false,
      });
    } catch (err) {
      console.error('loadDayData error:', err);
      set({ isLoading: false });
    }
  },

  loadProfile: async (_userId: string) => {
    // Profile is loaded from AsyncStorage macro_targets — nothing to do here
  },

  logFood: async (data) => {
    try {
      await logApi.logFood({
        date: data.date,
        meal_type: data.mealType,
        food_item_id: data.foodItemId,
        quantity_multiplier: data.quantityMultiplier || 1.0,
        notes: data.notes,
      });
      await get().loadDayData(data.userId, data.date);
    } catch (err) {
      console.error('logFood error:', err);
      throw err;
    }
  },

  logWater: async (_userId: string, _coachId: string, amount: number) => {
    // Water is still local — add to existing amount
    set((state) => ({ waterOz: state.waterOz + amount }));
  },
}));
