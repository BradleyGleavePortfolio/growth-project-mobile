/**
 * Shows the AI credit moments on the coach home (CREDIT-W, CREDIT-S hybrid):
 * "Your AI credits are low." once the pool is 80 % used and "Your AI
 * credits are used up." at 100 %, each at most once per pool period for each
 * coach on this phone (the key carries the coach id and period_start, so a
 * new month or another coach starts fresh). Head coaches only and only while
 * the home is focused (useCoachCredits). Buy opens the existing pack
 * checkout with that pack chosen; "Other amounts" opens it with the amount
 * field already open (#161-15 op 1).
 * Mounted only with featureFlags.coachAiCredits.
 */
import React, { useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { CoachTabParamList } from '../../../navigation/CoachNavigator';
import { useCurrentUser } from '../../../hooks/useCurrentUser';
import { useCoachCredits } from './useCoachCredits';
import CreditMomentSheet from './CreditMomentSheet';
import type { Moment } from './creditPace';

export function momentFor(pctUsed: number): Moment | null {
  if (pctUsed >= 100) return 'usedUp';
  if (pctUsed >= 80) return 'low';
  return null;
}

export function momentSeenKey(coachId: string, periodStart: string, moment: Moment): string {
  return `tgp.coachCredits.moment.v1:${coachId}:${periodStart}:${moment}`;
}

export default function CreditMomentsHost() {
  const focused = useIsFocused();
  const credits = useCoachCredits({ enabled: focused });
  const coachId = useCurrentUser()?.id ?? null;
  const navigation = useNavigation<BottomTabNavigationProp<CoachTabParamList>>();
  const moment = credits ? momentFor(credits.budget.pct_used) : null;
  const key = credits && moment && coachId ? momentSeenKey(coachId, credits.budget.period_start, moment) : null;
  const [open, setOpen] = useState<Moment | null>(null);
  const asked = useRef(new Set<string>());

  useEffect(() => {
    if (!focused || !key || !moment || asked.current.has(key)) return undefined;
    asked.current.add(key);
    let alive = true;
    AsyncStorage.getItem(key).then(
      (seen) => {
        if (!alive || seen) return;
        // Recorded when it opens, so it never shows twice in a period.
        AsyncStorage.setItem(key, '1').catch(() => undefined);
        setOpen(moment);
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [focused, key, moment]);

  if (!open || !credits || !focused) return null;
  const close = () => setOpen(null);
  const checkout = (preselect?: number | 'custom') =>
    navigation.navigate('SettingsStack', { screen: 'CreditPackCheckout', params: preselect ? { preselect } : undefined, initial: false });
  return (
    <CreditMomentSheet
      moment={open}
      credits={credits}
      onClose={close}
      onBuy={(cents) => {
        close();
        checkout(cents);
      }}
      onOtherAmounts={() => {
        close();
        checkout('custom');
      }}
    />
  );
}
