/**
 * useFirstWinCelebration — Psych Report #1 "Activation-First Dopamine"
 *
 * Returns a `triggerFirstWin()` function.
 * - Reads `firstWinDone` from AsyncStorage — no-ops if already fired.
 * - Sets `firstWinDone = true` atomically before side effects so it never
 *   fires twice even under rapid double-tap.
 * - Resolves the user's identity title from their Q3 intent answer.
 * - Callers must pass `showCelebration` setter to display the overlay.
 */

import { useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { TodayIntent } from '../screens/onboarding/LeanQ3IntentScreen';
import { track } from '../lib/analytics';

export interface FirstWinState {
  visible: boolean;
  identityTitle: string;
}

const IDENTITY_MAP: Record<TodayIntent, string> = {
  workout: 'Athlete',
  track_meals: 'Nutrition Pro',
  explore: 'Explorer',
};

/** Resolve identity title from stored onboarding intent */
async function resolveIdentity(): Promise<string> {
  try {
    const intent = (await AsyncStorage.getItem('lean_onboarding_intent')) as TodayIntent | null;
    if (intent && IDENTITY_MAP[intent]) return IDENTITY_MAP[intent];
  } catch {
    // fall through
  }
  // Try onboarding_data primaryGoal as fallback
  try {
    const raw = await AsyncStorage.getItem('onboarding_data');
    if (raw) {
      const data = JSON.parse(raw);
      if (data.primaryGoal === 'build_muscle') return 'Athlete';
      if (data.primaryGoal === 'lose_weight') return 'Transformer';
    }
  } catch {
    // ignore
  }
  return 'Complete.';
}

export function useFirstWinCelebration(
  setFirstWin: (state: FirstWinState) => void,
) {
  const firing = useRef(false);

  const triggerFirstWin = async () => {
    // Guard: only fire once per app lifetime, and not concurrently
    if (firing.current) return;
    firing.current = true;

    try {
      const done = await AsyncStorage.getItem('firstWinDone');
      if (done === 'true') {
        firing.current = false;
        return;
      }

      // Atomically mark done before side-effects
      await AsyncStorage.setItem('firstWinDone', 'true');

      const identityTitle = await resolveIdentity();

      // Haptic first — feels immediate
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});

      // Psych Report #4: Analytics — first_win_celebrated
      track('first_win_celebrated', { identity_title: identityTitle });

      // Show overlay
      setFirstWin({ visible: true, identityTitle });
    } catch {
      firing.current = false;
    }
    firing.current = false;
  };

  return { triggerFirstWin };
}
