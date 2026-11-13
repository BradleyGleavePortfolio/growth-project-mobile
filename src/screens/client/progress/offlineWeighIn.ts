/**
 * OFFLINE-WATER-WEIGHT-M (191-S5): a weigh-in saved with no signal waits in the phone's one queue (foodLogQueue, kind
 * 'weight') and sends itself when the signal returns (foodLogSync). Both Log weight saves use it: Progress V2's sheet
 * and the legacy Progress page. `userId` is the signed-in member the page shows; the queue writes for that member only.
 * A key an online try of this same weigh-in kept after a lost answer becomes the queue id (G7), so the server keeps one
 * row. The store hears of it at once, so every weight reader counts it (featureFlags.offlineFoodInDay on).
 */
import { useMemo } from 'react';
import { weightApi } from '../../../services/api';
import { enqueueWaterWeight, settleSentWeighIns } from '../../../services/foodLogQueue';
import { notifyPendingFoodLogs } from '../../../services/foodLogSync';
import { useClientStore } from '../../../store/clientStore';
import type { WeightLog } from '../../../types';
import { withQueuedWeighIns } from './weightHistory';

export async function saveWeighInOffline(userId: string, data: { weight_lbs: number; date: string; notes?: string }): Promise<void> {
  const kept = weightApi.takeKeptKey(data);
  const log = { date: data.date, weight_lbs: data.weight_lbs, ...(data.notes ? { notes: data.notes } : {}) };
  await enqueueWaterWeight(userId, { kind: 'weight', log }, kept);
  await notifyPendingFoodLogs();
}

/** The alert after a weigh-in saved with no signal (the Food log's "Saved offline" alert, LogScreen). */
export const WEIGH_IN_SAVED_OFFLINE = ['Saved offline', 'Your weigh-in will sync when you reconnect.'] as const;

/**
 * OFFLINE-WATER-WEIGHT-M: a weight history read (`read`, sorted by day) with this phone's weigh-ins joined by key
 * (weightHistory.withQueuedWeighIns). No read yet, or a failed one, stays as it was: a number from the phone alone
 * would not be the client's trend.
 */
export function useWeighInsOnPhone(read: WeightLog[] | null, userId?: string): WeightLog[] | null {
  const queue = useClientStore((st) => st.queuedWaterWeight);
  const sent = useClientStore((st) => st.sentWaterWeight);
  return useMemo(() => {
    if (!read || !userId) return read;
    const joined = withQueuedWeighIns(read, [...(queue ?? []), ...(sent ?? [])], userId);
    return joined === read ? read : [...joined].sort((a, b) => a.date.localeCompare(b.date));
  }, [read, queue, sent, userId]);
}

/** The keys of the weigh-ins this phone sent and no read holds yet: a change means a reader should read again (G2). */
export function useSentWeighInKeys(): string {
  const sent = useClientStore((st) => st.sentWaterWeight);
  return (sent ?? []).filter((x) => x.kind === 'weight').map((x) => x.id).join(',');
}

/** OFFLINE-WATER-WEIGHT-M: a good history read settles the sent weigh-ins whose key it holds. */
export async function settleWeighInsHeld(rows: WeightLog[]): Promise<void> {
  const held = new Set(rows.map((r) => r.clientUuid).filter((k): k is string => !!k));
  const store = useClientStore.getState();
  if (!held.size || !(store.sentWaterWeight ?? []).some((x) => x.kind === 'weight' && held.has(x.id))) return;
  const sent = await settleSentWeighIns(held).catch(() => null);
  const now = useClientStore.getState();
  if (sent) now.showQueuedWaterWeight?.({ queue: now.queuedWaterWeight, sent });
}
