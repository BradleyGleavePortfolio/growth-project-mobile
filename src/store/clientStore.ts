import { create } from 'zustand';
import { logApi, waterApi, type WaterEntry } from '../services/api';
import { getTodayString } from '../utils/date';
import { MealType, FoodLog } from '../types';
import { logger } from '../utils/logger';
import { forgetSaveKeys, waterDayShown, withSaveKey } from '../utils/log/saveKey';
import { dayForNewLog } from '../utils/logDay';
import { featureFlags } from '../config/featureFlags';
import { readQueue, readSent, settleSent, type PendingFoodLog, type SentFoodLog } from '../services/foodLogQueue';
import { withQueuedFoods } from '../utils/log/queuedDay';
import { foodLogFromDailyEntry, type DailyLogEntry } from '../utils/log/dailyEntry';

interface DailyTotals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

interface ClientStore {
  selectedDate: string;
  // FOOD-1-M R2: the calendar day it was when selectedDate was put on screen (utils/logDay).
  selectedOn: string;
  foodLogs: FoodLog[];
  dailyTotals: DailyTotals;
  waterOz: number;
  waterEntries: WaterEntry[];
  hasLoadedDay: boolean;
  isLoading: boolean;
  loadError: string | null;
  // OFFLINE-FOOD-M: the server's own read of the day on screen, and the foods on this phone. With
  // featureFlags.offlineFoodInDay on, foodLogs and dailyTotals are the two joined (utils/log/queuedDay).
  // `unread`: no read of this day reached the server yet (offline); only the phone's foods show.
  serverDay: { date: string; userId: string; logs: FoodLog[]; totals: DailyTotals; unread?: true } | null;
  queuedFoods: PendingFoodLog[];
  // Foods a sync sent, kept in their day until a good read of it (which holds them). FIX-931R2: the
  // phone's copy (foodLogQueue.readSent), every day's, so a restart or a day revisit keeps them.
  sentFoods: SentFoodLog[];

  setSelectedDate: (date: string) => void;
  loadDayData: (userId: string, date?: string) => Promise<void>;
  // LS-914R3 B1: the one day refresh for work that finishes after a wait
  // (save, edit, delete, repeat, sync). Reads `date` again only while that day
  // is the one on screen; it never selects a day.
  refreshShownDay: (userId: string, date: string) => Promise<void>;
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
  removeWaterEntry: (entryId: string) => Promise<void>;
  // Drops an entry from the day on screen and takes its nutrition off the
  // day's totals straight away, before the server confirms the delete.
  removeFoodLogLocally: (entryId: string) => void;
  // OFFLINE-FOOD-M: the phone's queue changed (a food saved offline, sent, refused or removed).
  showQueuedFoods: (queue: PendingFoodLog[]) => void;
  holdSentFoods: (sent: SentFoodLog[]) => void;
  // Security: reset all in-memory state on logout so the next user on the
  // same device doesn't briefly see the previous user's food/water data.
  reset: () => void;
}

const initialClientState = {
  selectedDate: getTodayString(),
  selectedOn: getTodayString(),
  foodLogs: [] as FoodLog[],
  dailyTotals: { calories: 0, protein: 0, carbs: 0, fat: 0 },
  waterOz: 0,
  waterEntries: [] as WaterEntry[],
  hasLoadedDay: false,
  isLoading: false,
  loadError: null as string | null,
  serverDay: null as ClientStore['serverDay'],
  queuedFoods: [] as PendingFoodLog[],
  sentFoods: [] as SentFoodLog[],
};

/** The day on screen: the server's read, plus this phone's queued foods of that day when the flag is on. */
function shownDay(serverDay: NonNullable<ClientStore['serverDay']>, queue: PendingFoodLog[], sent: PendingFoodLog[] = []) {
  if (!featureFlags.offlineFoodInDay) return { foodLogs: serverDay.logs, dailyTotals: serverDay.totals };
  return withQueuedFoods(serverDay.logs, serverDay.totals, [...queue, ...sent], serverDay.date, serverDay.userId);
}

// LS-PAYFAIL B10: one generation per signed-in account. reset() runs on every
// sign-out (resetUserScopedStores) and starts a new one, so a reply, refresh or
// rollback started by the previous account never writes into the next one.
let session = 0;
// LS-914R2 B1: one generation per selected day. A day change (or reset) starts
// a new one, so a water answer for the day it was sent on never lands on
// another day the client has opened since.
let view = 0;
// FIX-931R2 (LS-931R2B B2): one revision per change of the phone's foods told to the store (a save,
// a send, a Remove). A day read that began before a change commits the newer foods, never the copy
// it read when it began.
let queueRev = 0;
/** OFFLINE-FOOD-M (LS-931 B1): a day no read has reached yet: nothing from the server, no totals. */
const unreadDay = (date: string, userId: string) => ({
  date, userId, logs: [] as FoodLog[], totals: { calories: 0, protein: 0, carbs: 0, fat: 0 },
});

export const useClientStore = create<ClientStore>((set, get) => ({
  ...initialClientState,

  setSelectedDate: (date: string) => set((state) => {
    if (state.selectedDate === date) return {};
    view += 1;
    return {
    selectedDate: date,
    selectedOn: getTodayString(),
    foodLogs: [],
    dailyTotals: { ...initialClientState.dailyTotals },
    waterOz: 0,
    waterEntries: [],
    hasLoadedDay: false,
    loadError: null,
    serverDay: null,
    };
  }),

  reset: () => {
    session += 1;
    view += 1;
    forgetSaveKeys();
    set({ ...initialClientState, selectedDate: getTodayString(), selectedOn: getTodayString() });
  },

  loadDayData: async (_userId: string, date?: string) => {
    const mine = session;
    const d = date || get().selectedDate;
    const rev = queueRev;
    const startedAt = Date.now();
    let queueRead: Promise<PendingFoodLog[]> | null = null;
    let sentRead: Promise<SentFoodLog[]> | null = null;
    // The phone's foods to join: the ones read with this day, or the store's newer ones (B2).
    const latest = (queue: PendingFoodLog[], sent: SentFoodLog[]) =>
      rev === queueRev ? { queue, sent } : { queue: get().queuedFoods, sent: get().sentFoods };
    try {
      get().setSelectedDate(d);
      set({ isLoading: true, loadError: null });

      // OFFLINE-FOOD-M: the phone's queue, read with the day so the two join on one answer. It is read
      // on its own, so a day the server cannot answer (no signal, a cold start) still shows its queued
      // foods. A queue that cannot be read never costs the server's day: the last queue told stays.
      queueRead = featureFlags.offlineFoodInDay
        ? Promise.resolve().then(() => readQueue()).catch(() => get().queuedFoods)
        : Promise.resolve(get().queuedFoods);
      sentRead = featureFlags.offlineFoodInDay
        ? Promise.resolve().then(() => readSent()).catch(() => get().sentFoods)
        : Promise.resolve(get().sentFoods);
      // Fetch food logs and water in parallel
      const [foodResponse, waterResponse, queueAtStart, sentAtStart] = await Promise.all([
        logApi.getDaily(d),
        waterApi.getDaily(d).catch((err: unknown) => {
          logger.error('ClientStore', 'water data load failed', err);
          return null;
        }),
        queueRead,
        sentRead,
      ]);
      if (mine !== session || get().selectedDate !== d) return;
      const data = foodResponse.data;

      // The entry -> FoodLog map lives in utils/log/dailyEntry (GOAL-927-M, OPERATOR RULING 4: moved unchanged).
      const entries = (data.entries || []) as DailyLogEntry[];
      const logs: FoodLog[] = entries.map<FoodLog>((e) => foodLogFromDailyEntry(e, d));

      // Convert ml to oz for display (1 oz = 29.5735 ml)
      const totalMl = waterResponse?.data?.total_ml || 0;
      const waterOz = waterResponse ? Math.round(totalMl / 29.5735) : get().waterOz;

      const serverDay = {
        date: d,
        userId: _userId,
        logs,
        totals: {
          calories: data.total_calories || 0,
          protein: data.total_protein_g || 0,
          carbs: data.total_carbs_g || 0,
          fat: data.total_fat_g || 0,
        },
      };
      // FIX-931R2 (B1): this read settles its day's sent foods, all but one sent after it began that
      // it does not hold; other days' stay until a read of theirs.
      const onServer = new Set(logs.map((l) => l.clientUuid).filter((k): k is string => !!k));
      const keep = (s: SentFoodLog) => s.sentAt >= startedAt && !onServer.has(s.id);
      const { queue } = latest(queueAtStart, sentAtStart);
      const sentFoods = latest(queueAtStart, sentAtStart).sent.filter((s) => !s.log || s.log.date !== d || keep(s));
      set({
        ...shownDay(serverDay, queue, sentFoods),
        serverDay,
        queuedFoods: queue,
        sentFoods,
        waterOz,
        waterEntries: waterResponse ? waterResponse.data.logs || [] : get().waterEntries,
        selectedDate: d,
        hasLoadedDay: true,
        isLoading: false,
        loadError: waterResponse
          ? null
          : 'Water data could not refresh. Check your connection and try again.',
      });
      // LS-921 B1: this day's water read is on screen now, so a glass whose
      // answer was lost shows (or was never stored): the next glass is new.
      if (waterResponse) waterDayShown(d);
      if (featureFlags.offlineFoodInDay) {
        await Promise.resolve().then(() => settleSent(d, keep)).catch((err: unknown) => {
          logger.warn('ClientStore', 'settling sent foods failed', err);
        });
      }
    } catch (err) {
      if (mine !== session || get().selectedDate !== d) return;
      // Preserve data only for a refresh of the same selected day.
      logger.error('ClientStore', 'loadDayData failed', err);
      set({
        isLoading: false,
        loadError: 'Food and water data could not refresh. Check your connection and try again.',
      });
      // OFFLINE-FOOD-M (LS-931 B1): no read of this day reached the server (no signal, a cold start,
      // a day not opened before). The day's queued foods still show and count, on the server read
      // already held for this day or, with none, on an empty base marked unread (the day's own
      // numbers stay hidden until a read lands: hasLoadedDay stays false).
      if (!featureFlags.offlineFoodInDay) return;
      const queueAtStart = await (queueRead ?? Promise.resolve(get().queuedFoods)).catch(() => get().queuedFoods);
      const sentAtStart = await (sentRead ?? Promise.resolve(get().sentFoods)).catch(() => get().sentFoods);
      if (mine !== session || get().selectedDate !== d) return;
      const { queue, sent } = latest(queueAtStart, sentAtStart);
      set((state) => {
        const held = state.serverDay && state.serverDay.date === d ? state.serverDay : null;
        const serverDay = held ?? { ...unreadDay(d, _userId), unread: true as const };
        return { serverDay, queuedFoods: queue, sentFoods: sent, ...shownDay(serverDay, queue, sent) };
      });
    }
  },

  refreshShownDay: async (userId: string, date: string) => {
    if (get().selectedDate !== date) return;
    await get().loadDayData(userId, date);
  },

  loadProfile: async (_userId: string) => {
    // Profile is loaded from AsyncStorage macro_targets — nothing to do here
  },

  logFood: async (data) => {
    const mine = session;
    try {
      const save = {
        date: data.date,
        meal_type: data.mealType,
        food_item_id: data.foodItemId,
        quantity_multiplier: data.quantityMultiplier || 1.0,
        notes: data.notes,
      };
      // FOOD-1-M R3: one key per intended save, kept for a tap again after a lost answer.
      await withSaveKey(['food', save], (key) => logApi.logFood({ ...save, client_uuid: key }));
      // LS-914R3 B1: a day opened while this was saving stays open; the
      // logged day is read again only while it is the day on screen.
      if (mine === session) await get().refreshShownDay(data.userId, data.date);
    } catch (err) {
      throw err;
    }
  },

  removeFoodLogLocally: (entryId: string) =>
    set((state) => {
      const removed = state.foodLogs.find((f) => f.id === entryId);
      if (!removed) return {};
      // OFFLINE-FOOD-M: the day is the server's read joined with the queue; take the row off the
      // side it came from and join again, so the totals stay the sum of what is shown.
      if (state.serverDay && state.serverDay.date === state.selectedDate) {
        const sd = state.serverDay;
        const fromServer = !removed.offline;
        const t0 = sd.totals;
        const serverDay = fromServer
          ? {
              ...sd,
              logs: sd.logs.filter((f) => f.id !== entryId),
              totals: {
                calories: Math.max(0, t0.calories - removed.calories),
                protein: Math.max(0, t0.protein - removed.protein),
                carbs: Math.max(0, t0.carbs - removed.carbs),
                fat: Math.max(0, t0.fat - removed.fat),
              },
            }
          : sd;
        if (!fromServer) queueRev += 1;
        const queuedFoods = fromServer ? state.queuedFoods : state.queuedFoods.filter((q) => q.id !== entryId);
        const sentFoods = fromServer ? state.sentFoods : state.sentFoods.filter((q) => q.id !== entryId);
        return { serverDay, queuedFoods, sentFoods, ...shownDay(serverDay, queuedFoods, sentFoods) };
      }
      const t = state.dailyTotals;
      return {
        foodLogs: state.foodLogs.filter((f) => f.id !== entryId),
        dailyTotals: {
          calories: Math.max(0, t.calories - removed.calories),
          protein: Math.max(0, t.protein - removed.protein),
          carbs: Math.max(0, t.carbs - removed.carbs),
          fat: Math.max(0, t.fat - removed.fat),
        },
      };
    }),

  showQueuedFoods: (queue: PendingFoodLog[]) =>
    set((state) => {
      queueRev += 1;
      if (!state.serverDay || state.serverDay.date !== state.selectedDate) return { queuedFoods: queue };
      return { queuedFoods: queue, ...shownDay(state.serverDay, queue, state.sentFoods) };
    }),

  // FIX-931R2: `sent` is the phone's whole sent list (foodLogQueue.readSent); it replaces the held one.
  holdSentFoods: (sent: SentFoodLog[]) =>
    set((state) => {
      queueRev += 1;
      const sentFoods = sent;
      if (!state.serverDay || state.serverDay.date !== state.selectedDate) return { sentFoods };
      return { sentFoods, ...shownDay(state.serverDay, state.queuedFoods, sentFoods) };
    }),

  logWater: async (userId: string, _coachId: string, amountOz: number) => {
    // Optimistic update — add immediately, sync to backend. LS-914R2 B1: the
    // answer belongs to the day it was sent on; it is applied only while that
    // same day view is still open (same account, no day change in between).
    const mine = session;
    // FOOD-1-M R2: the shared day rule. A day left on today past midnight moves to the new today,
    // and that day is read, before it takes the glass.
    const date = dayForNewLog(get());
    if (date !== get().selectedDate) await get().loadDayData(userId, date);
    if (mine !== session) return;
    const shown = view;
    const ours = () => mine === session && shown === view;
    // Another day opened meanwhile: drop the answer; if the client is back on
    // the sent day (A -> B -> A), read that day again so it shows the truth.
    const settleElsewhere = () => {
      if (mine === session) void get().refreshShownDay(userId, date);
    };
    set((state) => ({ waterOz: state.waterOz + amountOz }));
    try {
      const amountMl = Math.round(amountOz * 29.5735);
      // FOOD-1-M R3: the glass's key, kept if the answer is lost and the same glass is added again.
      const response = await withSaveKey(['water', date, amountMl], (key) => waterApi.log({ amount_ml: amountMl, date }, key));
      if (!ours()) return settleElsewhere();
      const saved = response.data;
      if (saved.id) {
        set((state) => state.waterEntries.some((e) => e.id === saved.id)
          ? {}
          : { waterEntries: [...state.waterEntries, saved] });
      }
      set((state) => state.loadError?.endsWith(' oz of water was not saved. Check the connection, then add it again.')
        ? { loadError: null }
        : {});
    } catch (err) {
      // Revert the optimistic bump and say so: a number that silently goes
      // back down reads as a glitch, not as "this was not saved".
      logger.error('ClientStore', 'logWater failed', err);
      if (!ours()) return settleElsewhere();
      set((state) => ({
        waterOz: Math.max(0, state.waterOz - amountOz),
        loadError: `${Math.round(amountOz)} oz of water was not saved. Check the connection, then add it again.`,
      }));
    }
  },

  removeWaterEntry: async (entryId: string) => {
    const mine = session;
    await waterApi.deleteEntry(entryId);
    if (mine !== session) return;
    set((state) => {
      if (!state.waterEntries.some((entry) => entry.id === entryId)) return {};
      const waterEntries = state.waterEntries.filter((entry) => entry.id !== entryId);
      return {
        waterEntries,
        waterOz: Math.round(waterEntries.reduce((total, entry) => total + entry.amount_ml, 0) / 29.5735),
      };
    });
  },
}));
