import { create } from 'zustand';
import { logApi, waterApi, type WaterEntry } from '../services/api';
import { getTodayString } from '../utils/date';
import { MealType, FoodLog } from '../types';
import { logger } from '../utils/logger';
import { mapFoodItem, type RawFoodItem } from '../utils/log/mapFoodItem';
import { forgetSaveKeys, waterDayShown, withSaveKey } from '../utils/log/saveKey';
import { dayForNewLog } from '../utils/logDay';
import { featureFlags } from '../config/featureFlags';
import {
  dropQueued, enqueueWaterWeight, flush, readQueue, readSent, readWaterWeight, settleSent, settleSentWater,
  type PendingFoodLog, type PendingWaterWeightLog, type SentFoodLog, type SentWaterWeightLog,
} from '../services/foodLogQueue';
import { withQueuedFoods, withQueuedWater, type ShownWaterEntry } from '../utils/log/queuedDay';

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
  // OFFLINE-WATER-WEIGHT-M: with featureFlags.offlineFoodInDay on, the server's water read joined with this phone's
  // glasses of the day (utils/log/queuedDay.withQueuedWater); a glass on the phone carries `offline`.
  waterEntries: ShownWaterEntry[];
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
  // OFFLINE-WATER-WEIGHT-M: the server's own water read of the day on screen (null until one lands), and this
  // phone's glasses and weigh-ins: waiting and refused (queue), and sent but not read back yet (sent).
  serverWater: { date: string; userId: string; totalMl: number; entries: WaterEntry[] } | null;
  queuedWaterWeight: PendingWaterWeightLog[];
  sentWaterWeight: SentWaterWeightLog[];

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
  // OFFLINE-WATER-WEIGHT-M: `online` is the call site's network state (food's send decision); false queues the glass.
  logWater: (userId: string, coachId: string, amount: number, online?: boolean) => Promise<void>;
  removeWaterEntry: (entryId: string) => Promise<void>;
  // Drops an entry from the day on screen and takes its nutrition off the
  // day's totals straight away, before the server confirms the delete.
  removeFoodLogLocally: (entryId: string) => void;
  // OFFLINE-FOOD-M: the phone's queue changed (a food saved offline, sent, refused or removed).
  showQueuedFoods: (queue: PendingFoodLog[]) => void;
  holdSentFoods: (sent: SentFoodLog[]) => void;
  // OFFLINE-WATER-WEIGHT-M: the phone's glasses and weigh-ins changed (saved offline, sent, refused, removed).
  showQueuedWaterWeight: (lists: { queue: PendingWaterWeightLog[]; sent: SentWaterWeightLog[] }) => void;
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
  waterEntries: [] as ShownWaterEntry[],
  hasLoadedDay: false,
  isLoading: false,
  loadError: null as string | null,
  serverDay: null as ClientStore['serverDay'],
  queuedFoods: [] as PendingFoodLog[],
  sentFoods: [] as SentFoodLog[],
  serverWater: null as ClientStore['serverWater'],
  queuedWaterWeight: [] as PendingWaterWeightLog[],
  sentWaterWeight: [] as SentWaterWeightLog[],
};

/**
 * OFFLINE-WATER-WEIGHT-M: the water on screen for the server's water read `sw`: with featureFlags.offlineFoodInDay on,
 * the read plus this phone's glasses of its day (withQueuedWater); off, the read alone (the glasses still send).
 */
function shownWater(sw: NonNullable<ClientStore['serverWater']>, queue: PendingWaterWeightLog[], sent: SentWaterWeightLog[]) {
  if (!featureFlags.offlineFoodInDay) return { waterOz: Math.round(sw.totalMl / 29.5735), waterEntries: sw.entries as ShownWaterEntry[] };
  return withQueuedWater({ totalMl: sw.totalMl, entries: sw.entries }, [...queue, ...sent], sw.date);
}

/**
 * REFINE-972 (LS C1): tell the pending-count listeners (foodLogSync.notifyPendingFoodLogs). foodLogSync imports this
 * store, so it is required here, inside the call, never at the top (an import cycle).
 */
const tellPendingCount = () => Promise.resolve()
  .then(() => (require('../services/foodLogSync') as typeof import('../services/foodLogSync')).notifyPendingFoodLogs())
  .catch((err: unknown) => logger.warn('ClientStore', 'telling the pending count failed', err));

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
// OFFLINE-WATER-WEIGHT-M: the same for the phone's glasses and weigh-ins (showQueuedWaterWeight).
let phoneRev = 0;
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
    serverWater: null,
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
    let rev = queueRev;
    const startedAt = Date.now();
    let queueRead: Promise<PendingFoodLog[]> | null = null;
    let sentRead: Promise<SentFoodLog[]> | null = null;
    const waterRev = phoneRev;
    const phoneNow = () => ({ queue: get().queuedWaterWeight, sent: get().sentWaterWeight });
    let waterRead: Promise<{ queue: PendingWaterWeightLog[]; sent: SentWaterWeightLog[] }> | null = null;
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
      // OFFLINE-WATER-WEIGHT-M: this phone's glasses (and weigh-ins), read with the day as the foods are.
      waterRead = featureFlags.offlineFoodInDay
        ? Promise.resolve().then(() => readWaterWeight()).catch(() => phoneNow())
        : Promise.resolve(phoneNow());
      // Fetch food logs and water in parallel
      const [foodResponse, waterResponse, queueAtStart, sentAtStart, phoneAtStart] = await Promise.all([
        logApi.getDaily(d),
        waterApi.getDaily(d).catch((err: unknown) => {
          logger.error('ClientStore', 'water data load failed', err);
          return null;
        }),
        queueRead,
        sentRead,
        waterRead,
      ]);
      if (mine !== session || get().selectedDate !== d) return;
      // OFFLINE-WATER-WEIGHT-M (step 5): a glass of this day still waiting may already be stored (its answer lost). The
      // one flush sends it again first, with the same key; the server answers the first row, and its id says whether
      // this read holds it. So the read is applied once.
      let phone = waterRev === phoneRev ? phoneAtStart : phoneNow();
      let foodsAt: [PendingFoodLog[], SentFoodLog[]] = [queueAtStart, sentAtStart];
      let sentHere = false;
      if (false as boolean) {
        await Promise.resolve().then(() => flush()).catch((err: unknown) => logger.warn('ClientStore', 'sending waiting water failed', err));
        sentHere = true;
        // REFINE-972 (B2): what that send delivered leaves the store as the sync leaves it: the phone's foods are read
        // again with its glasses, so a food it sent stays in its day (the sent list) until a read holds its key.
        const revAgain = queueRev;
        const [phoneAgain, foodsAgain] = await Promise.all([
          Promise.resolve().then(() => readWaterWeight()).catch(() => phoneNow()),
          featureFlags.offlineFoodInDay ? Promise.all([readQueue(), readSent()]).catch(() => null) : null,
        ]);
        phone = phoneAgain;
        if (foodsAgain) {
          rev = revAgain;
          foodsAt = foodsAgain;
        }
        if (mine !== session || get().selectedDate !== d) return;
      }
      const data = foodResponse.data;

      // Wire shape returned by /v1/log/daily.
      interface DailyLogEntry {
        id: string;
        food_item_id: string;
        user_id: string;
        meal_type: FoodLog['mealType'];
        quantity_multiplier: number;
        original_quantity?: number | null;
        original_unit?: string | null;
        logged_at?: string;
        created_at?: string;
        food_item?: RawFoodItem;
        plan_slot_id?: string | null;
        fills_usual_meal?: boolean;
        client_uuid?: string | null;
      }
      const entries = (data.entries || []) as DailyLogEntry[];
      // The existing mapping intentionally writes both `foodName` (the
      // canonical FoodLog field) and a duplicate `name` consumed by older
      // screens; FoodLog itself doesn't declare `name`, so we have to
      // double-cast through unknown to keep both shapes in flight without
      // re-introducing `any`.
      // TODO(types): drop the duplicate `name` field once all consumers
      // read `foodName` directly.
      const logs: FoodLog[] = entries.map<FoodLog>((e) => {
        // F-3 fix: surface original_quantity/original_unit so meal cards
        // can render "6 oz chicken" instead of the hardcoded
        // "1 serving" placeholder. Falls back to the multiplier when the
        // backend row is legacy and has no original_* fields.
        const hasOriginal =
          typeof e.original_quantity === 'number' &&
          !!e.original_unit &&
          (e.original_unit || '').trim().length > 0;
        return ({
          id: e.id,
          foodItemId: e.food_item_id,
          quantityMultiplier: e.quantity_multiplier,
          foodItem: e.food_item ? mapFoodItem(e.food_item) : undefined,
          foodName: e.food_item?.name || '',
          name: e.food_item?.name || '',
          calories: Math.round((e.food_item?.calories || 0) * e.quantity_multiplier),
          protein: Math.round((e.food_item?.protein_g || 0) * e.quantity_multiplier),
          carbs: Math.round((e.food_item?.carbs_g || 0) * e.quantity_multiplier),
          fat: Math.round((e.food_item?.fat_g || 0) * e.quantity_multiplier),
          mealType: e.meal_type,
          date: d,
          quantity: hasOriginal
            ? (e.original_quantity as number)
            : e.quantity_multiplier,
          unit: hasOriginal ? (e.original_unit as string) : 'serving',
          originalQuantity:
            typeof e.original_quantity === 'number'
              ? e.original_quantity
              : undefined,
          originalUnit: e.original_unit ? e.original_unit : undefined,
          userId: e.user_id,
          planSlotId: e.plan_slot_id || undefined,
          fillsUsualMeal: e.fills_usual_meal === true || undefined,
          clientUuid: e.client_uuid || undefined,
          coachId: '',
          createdAt: e.logged_at || e.created_at || new Date().toISOString(),
        } as FoodLog & { name: string });
      });

      // Convert ml to oz for display (1 oz = 29.5735 ml)
      const totalMl = waterResponse?.data?.total_ml || 0;
      const waterOz = waterResponse ? Math.round(totalMl / 29.5735) : get().waterOz;
      // OFFLINE-WATER-WEIGHT-M: the server's water read of this day (or, when it failed, the one already held for it)
      // joined with this phone's glasses. A good read settles the sent glasses it holds (by their answer ids).
      const heldWater = get().serverWater;
      const serverWater = waterResponse
        ? { date: d, userId: _userId, totalMl, entries: waterResponse.data.logs || [] }
        : heldWater && heldWater.date === d ? heldWater : null;
      const waterIds = new Set((serverWater?.entries ?? []).map((e) => e.id));
      const waterSettled = (s: SentWaterWeightLog) => !!waterResponse && s.kind === 'water' && s.log.date === d
        && (s.answerId ? waterIds.has(s.answerId) : s.sentAt < startedAt);
      const sentWaterWeight = phone.sent.filter((s) => !waterSettled(s));
      const water = serverWater
        ? shownWater(serverWater, phone.queue, sentWaterWeight)
        : { waterOz, waterEntries: waterResponse ? waterResponse.data.logs || [] : get().waterEntries };

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
      const { queue } = latest(...foodsAt);
      const sentFoods = latest(...foodsAt).sent.filter((s) => !s.log || s.log.date !== d || keep(s));
      set({
        ...shownDay(serverDay, queue, sentFoods),
        serverDay,
        queuedFoods: queue,
        sentFoods,
        ...water,
        serverWater,
        queuedWaterWeight: phone.queue,
        sentWaterWeight,
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
      if (waterResponse && featureFlags.offlineFoodInDay && phone.sent.length !== sentWaterWeight.length) {
        await Promise.resolve().then(() => settleSentWater(d, waterIds, startedAt)).catch((err: unknown) => {
          logger.warn('ClientStore', 'settling sent water failed', err);
        });
      }
      if (featureFlags.offlineFoodInDay) {
        await Promise.resolve().then(() => settleSent(d, keep)).catch((err: unknown) => {
          logger.warn('ClientStore', 'settling sent foods failed', err);
        });
      }
      // REFINE-972 (LS C1): the Food log's pending count hears of what this send delivered, as after the sync.
      if (sentHere) await tellPendingCount();
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
      const phone = await (waterRead ?? Promise.resolve(phoneNow())).catch(() => phoneNow());
      if (mine !== session || get().selectedDate !== d) return;
      const { queue: wQueue, sent: wSent } = waterRev === phoneRev ? phone : phoneNow();
      set((state) => {
        const held = state.serverDay && state.serverDay.date === d ? state.serverDay : null;
        const serverDay = held ?? { ...unreadDay(d, _userId), unread: true as const };
        // OFFLINE-WATER-WEIGHT-M (W6): water joins only a water read this day already had; none, no number.
        const sw = state.serverWater && state.serverWater.date === d ? state.serverWater : null;
        return {
          serverDay, queuedFoods: queue, sentFoods: sent, ...shownDay(serverDay, queue, sent),
          queuedWaterWeight: wQueue, sentWaterWeight: wSent, ...(sw ? shownWater(sw, wQueue, wSent) : {}),
        };
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

  showQueuedWaterWeight: ({ queue, sent }) =>
    set((state) => {
      phoneRev += 1;
      const sw = state.serverWater && state.serverWater.date === state.selectedDate ? state.serverWater : null;
      return { queuedWaterWeight: queue, sentWaterWeight: sent, ...(sw ? shownWater(sw, queue, sent) : {}) };
    }),

  logWater: async (userId: string, _coachId: string, amountOz: number, online = true) => {
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
    if (!online) {
      // OFFLINE-WATER-WEIGHT-M (191-S5): no signal, so the glass waits in the phone's queue (food's send decision) and
      // counts at once with featureFlags.offlineFoodInDay on. A key an online try of this glass kept (its answer lost)
      // becomes the queue id, so the server keeps one row (W8).
      const amountMl = Math.round(amountOz * 29.5735);
      try {
        await withSaveKey(['water', date, amountMl], (key) =>
          enqueueWaterWeight(userId, { kind: 'water', log: { date, amount_ml: amountMl } }, key));
      } catch (err) {
        logger.error('ClientStore', 'logWater queue failed', err);
        if (ours()) set({ loadError: `${Math.round(amountOz)} oz of water was not saved. Check the connection, then add it again.` });
        return;
      }
      const lists = await readWaterWeight().catch(() => null);
      if (lists && mine === session) get().showQueuedWaterWeight(lists);
      if (ours()) {
        set((state) => state.loadError?.endsWith(' oz of water was not saved. Check the connection, then add it again.')
          ? { loadError: null }
          : {});
      }
      return;
    }
    set((state) => ({ waterOz: state.waterOz + amountOz }));
    try {
      const amountMl = Math.round(amountOz * 29.5735);
      // FOOD-1-M R3: the glass's key, kept if the answer is lost and the same glass is added again.
      const response = await withSaveKey(['water', date, amountMl], (key) => waterApi.log({ amount_ml: amountMl, date }, key));
      if (!ours()) return settleElsewhere();
      const saved = response.data;
      if (saved.id) {
        set((state) => {
          if (state.waterEntries.some((e) => e.id === saved.id)) return {};
          // OFFLINE-WATER-WEIGHT-M: the saved glass joins the held water read too, so a later join of the phone's
          // glasses (showQueuedWaterWeight) keeps it.
          const sw = state.serverWater;
          const serverWater = sw && sw.date === date && !sw.entries.some((e) => e.id === saved.id)
            ? { ...sw, totalMl: sw.totalMl + (saved.amount_ml || 0), entries: [...sw.entries, saved] }
            : sw;
          return { waterEntries: [...state.waterEntries, saved], serverWater };
        });
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
    // OFFLINE-WATER-WEIGHT-M (W10): a glass on this phone (waiting, refused, or sent and not read back) is not a server
    // entry: Remove takes it off the phone, with no server call, as a food saved offline (LogScreen handleDeleteFood).
    const onPhone = (q: { id: string; kind: string }) => q.id === entryId && q.kind === 'water';
    if (get().queuedWaterWeight.some(onPhone) || get().sentWaterWeight.some(onPhone)) {
      const { queuedWaterWeight, sentWaterWeight } = get();
      get().showQueuedWaterWeight({
        queue: queuedWaterWeight.filter((q) => q.id !== entryId),
        sent: sentWaterWeight.filter((q) => q.id !== entryId),
      });
      await dropQueued(entryId);
      return;
    }
    await waterApi.deleteEntry(entryId);
    if (mine !== session) return;
    set((state) => {
      if (!state.waterEntries.some((entry) => entry.id === entryId)) return {};
      const waterEntries = state.waterEntries.filter((entry) => entry.id !== entryId);
      // OFFLINE-WATER-WEIGHT-M: the server's read loses the entry too, so a later join keeps it out.
      const sw = state.serverWater;
      const serverWater = sw && sw.entries.some((e) => e.id === entryId)
        ? { ...sw, entries: sw.entries.filter((e) => e.id !== entryId), totalMl: sw.entries.filter((e) => e.id !== entryId).reduce((t, e) => t + e.amount_ml, 0) }
        : sw;
      return {
        waterEntries,
        serverWater,
        waterOz: Math.round(waterEntries.filter((entry) => entry.offline !== 'refused').reduce((total, entry) => total + entry.amount_ml, 0) / 29.5735),
      };
    });
  },
}));
