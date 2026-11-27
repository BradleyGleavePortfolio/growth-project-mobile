/**
 * PLAN-SWAPS-COACH-M R7: the coach's own recipes for a meal's Recipe card and the recipe picker. GET /recipes under the
 * client Recipes page's own key ['recipes'] with the same stored value (the server's array as sent, RecipesScreen),
 * filtered in select to the recipes he created. Read only once his id is known: useCurrentUser() is null on its first
 * render, and an unknown id must never read as "No recipes yet".
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { recipesApi } from '../../../services/api';
import { useCurrentUser } from '../../../hooks/useCurrentUser';
import { ownRecipes } from './mealLinks';

type ReadLike = { isSuccess: boolean; isStale: boolean; isFetchedAfterMount: boolean };

/**
 * R5: true once the read succeeded on this visit, or holds data still inside its staleTime; then latched for the life
 * of the screen, so a later stale flag, background re-read or failure never takes a built form or a claim away. A
 * failed re-read is "fetched after mount" too (query-core), so isSuccess is required. As useServerAnswered
 * (ConversationClosed.tsx), written here so the coach screens do not pull in the messaging stack.
 */
export function useAnsweredOnce(read: ReadLike): boolean {
  const now = read.isFetchedAfterMount || !read.isStale;
  const [latched, setLatched] = useState(now);
  useEffect(() => { if (now) setLatched(true); }, [now]);
  return latched || now;
}

export function useCoachRecipes() {
  const userId = useCurrentUser()?.id;
  const read = useQuery({
    queryKey: ['recipes'],
    queryFn: () => recipesApi.list().then((r) => r.data as unknown[]),
    staleTime: 5 * 60 * 1000,
    enabled: !!userId,
    select: (rows: unknown[]) => ownRecipes(rows, userId),
  });
  const answered = useAnsweredOnce(read) && !!userId;
  return { read, mine: answered ? read.data ?? [] : undefined, failed: !answered && !!userId && read.isError };
}
