/**
 * The Kitchen's three writes to her saved meals (SAVED-MEAL-SAVE-M): create, rename and delete. The page mounts this
 * hook, not a sheet, and every cache change runs from the mutation's own options, never from a mutate() callback, so
 * an answer that lands after the sheet closed (scrim, pull down, Android Back) still reaches the list (R7, R10).
 * No queue: each write asks the network first and with no connection sends and stores nothing (R11).
 */
import { useRef } from 'react';
import { AccessibilityInfo } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { SAVED_MEALS_KEY, savedFoodsApi, type SaveMealBody, type SavedMeal } from '../../../api/savedFoodsApi';
import { isEffectivelyOnline } from '../../../hooks/useNetworkStatus';
import { HapticService } from '../../../ui/haptics/haptics.service';
import { deletedWords, failureOf, renamedWords, savedWords } from './kitchen';

/** R11: the Food log's own test (LogPlannedMealButton.tsx:122-123). */
export async function online(): Promise<boolean> {
  const net = await NetInfo.fetch();
  return isEffectivelyOnline({ isOnline: !!net.isConnected, isInternetReachable: net.isInternetReachable });
}

/** How a write ended badly. No status or 500 and above is a lost answer (saveKey.ts:44-56): the write may have landed. */
export type WriteFailure = 'lost' | 'limit' | 'gone' | 'food' | 'refused';
export function failureKind(err: unknown): WriteFailure {
  const { status, message } = failureOf(err);
  if (!status || status >= 500) return 'lost';
  const code = (err as { response?: { data?: { code?: unknown } } } | null)?.response?.data?.code;
  if (status === 409 && code === 'SAVED_MEALS_LIMIT') return 'limit';
  if (status === 404) return /saved meal/i.test(message) ? 'gone' : 'food';
  return 'refused';
}

const listOf = (data: unknown): SavedMeal[] => (Array.isArray(data) ? (data as SavedMeal[]) : []);
const fetchList = () => savedFoodsApi.list().then((r) => r.data as unknown);

export function useSavedMealWrites(onSaved?: () => void) {
  const qc = useQueryClient();
  const after = useRef(onSaved);
  after.current = onSaved;
  const reread = () => { void qc.invalidateQueries({ queryKey: SAVED_MEALS_KEY }); };

  /** R7: the meal the server holds goes first, unchanged (its items carry food_truth); then the list is read again. */
  const saved = (meal: SavedMeal) => {
    qc.setQueryData(SAVED_MEALS_KEY, (old: unknown) => [meal, ...listOf(old).filter((m) => m.id !== meal.id)]);
    reread();
    void HapticService.success();
    AccessibilityInfo.announceForAccessibility(savedWords(meal.name));
    after.current?.();
  };

  const create = useMutation({
    mutationFn: async (body: SaveMealBody) => (await savedFoodsApi.create(body)).data,
    onSuccess: saved,
    // R6 and R8: after a lost answer (the server may hold the meal) or the limit, the list is read again in the
    // background, here so it runs even when the sheet is gone.
    onError: (err) => { const kind = failureKind(err); if (kind === 'lost' || kind === 'limit') reread(); },
  });

  const rename = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => (await savedFoodsApi.rename(id, name)).data,
    onSuccess: (meal, { id, name }) => {
      qc.setQueryData(SAVED_MEALS_KEY, (old: unknown) => listOf(old).map((m) => (m.id === id ? meal : m)));
      reread();
      void HapticService.success();
      AccessibilityInfo.announceForAccessibility(renamedWords(name));
    },
    onError: (err) => { if (failureKind(err) === 'gone') reread(); },
  });

  const remove = useMutation({
    // R10: a 404 "Saved meal not found" means it is gone, as a resend after a lost answer answers: the same as a 2xx.
    mutationFn: async ({ id }: { id: string; name: string }) => {
      try {
        await savedFoodsApi.remove(id);
      } catch (err) {
        if (failureKind(err) !== 'gone') throw err;
      }
    },
    onSuccess: (_none, { id, name }) => {
      qc.setQueryData(SAVED_MEALS_KEY, (old: unknown) => listOf(old).filter((m) => m.id !== id));
      reread();
      void HapticService.success();
      AccessibilityInfo.announceForAccessibility(deletedWords(name));
    },
  });

  /** R6: the list read again and awaited (the page's own read, key and shape), before any resend. */
  const readList = () => qc.fetchQuery({ queryKey: SAVED_MEALS_KEY, queryFn: fetchList, staleTime: 0, retry: false });

  return { create, rename, remove, saved, readList };
}

export type SavedMealWrites = ReturnType<typeof useSavedMealWrites>;
