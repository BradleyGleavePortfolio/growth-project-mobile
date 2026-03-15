import { create } from 'zustand';
import { FoodLog, ClientProfile } from '../types';
import { getFoodLogsByDate, getDailyTotals, addFoodLog } from '../db/foodLogDb';
import { getWaterLogByDate, addWaterLog } from '../db/waterLogDb';
import { getProfileByUserId } from '../db/profileDb';
import { getTodayString } from '../utils/date';
import { MealType } from '../types';

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
  profile: ClientProfile | null;
  isLoading: boolean;

  setSelectedDate: (date: string) => void;
  loadDayData: (userId: string, date?: string) => Promise<void>;
  loadProfile: (userId: string) => Promise<void>;
  logFood: (data: {
    userId: string;
    coachId: string;
    date: string;
    mealType: MealType;
    foodName: string;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    quantity: number;
    unit: string;
  }) => Promise<void>;
  logWater: (userId: string, coachId: string, amount: number) => Promise<void>;
}

export const useClientStore = create<ClientStore>((set, get) => ({
  selectedDate: getTodayString(),
  foodLogs: [],
  dailyTotals: { calories: 0, protein: 0, carbs: 0, fat: 0 },
  waterOz: 0,
  profile: null,
  isLoading: false,

  setSelectedDate: (date: string) => set({ selectedDate: date }),

  loadDayData: async (userId: string, date?: string) => {
    try {
      set({ isLoading: true });
      const d = date || get().selectedDate;
      const [logs, totals, water] = await Promise.all([
        getFoodLogsByDate(userId, d),
        getDailyTotals(userId, d),
        getWaterLogByDate(userId, d),
      ]);
      set({
        foodLogs: logs,
        dailyTotals: totals,
        waterOz: water,
        selectedDate: d,
        isLoading: false,
      });
    } catch (err) {
      console.error('loadDayData error:', err);
      set({ isLoading: false });
    }
  },

  loadProfile: async (userId: string) => {
    try {
      const profile = await getProfileByUserId(userId);
      set({ profile });
    } catch (err) {
      console.error('loadProfile error:', err);
    }
  },

  logFood: async (data) => {
    try {
      await addFoodLog(data);
      await get().loadDayData(data.userId, data.date);
    } catch (err) {
      console.error('logFood error:', err);
    }
  },

  logWater: async (userId: string, coachId: string, amount: number) => {
    try {
      const date = get().selectedDate;
      await addWaterLog({ userId, coachId, date, amount });
      const water = await getWaterLogByDate(userId, date);
      set({ waterOz: water });
    } catch (err) {
      console.error('logWater error:', err);
    }
  },
}));
