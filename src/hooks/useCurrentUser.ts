import { useState, useEffect } from 'react';
import { authEvents } from '../utils/authEvents';
import { setSentryUser } from '../services/sentry';
import { readUserCache } from '../lib/userCache';

export interface CurrentUser {
  id: string;
  email: string;
  name?: string;
  role?: string;
  coach_id?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  createdAt?: string;
  profile?: {
    calorie_target?: number;
    protein_target?: number;
    carbs_target?: number;
    fat_target?: number;
    current_weight?: number;
    target_weight?: number;
    height?: number;
    height_cm?: number;
    sex?: string;
    dob?: string;
    activity_level?: string;
    primary_goal?: string;
    diet_type?: string;
    diet_restrictions?: string[] | string;
    workout_days_per_week?: number;
    gym_membership?: string;
    onboarding_completed?: boolean;
    /** Day-1 onboarding terminal flag. Set by the final Ready screen. */
    day_one_completed?: boolean;
    /** ISO timestamp the Day-1 flow finished. Source of truth on the server. */
    day_one_completed_at?: string;
    tdee?: number;
  };
}

/**
 * Hook that reads the authenticated user from the persistent user cache
 * (`lib/userCache`). The first render is always `null`; the value resolves
 * after an asynchronous storage read. This replaces useAuthStore().currentUser
 * which was from the OLD SQLite system and always returns null for
 * Supabase-authenticated users.
 *
 * S6 R3: every load carries an epoch. A read that started before a logout (or
 * before a newer login-triggered load) is discarded when it settles, so a
 * stale hydration can neither resurrect a signed-out user nor overwrite a
 * newer identity; nothing is applied after unmount.
 */
export function useCurrentUser(): CurrentUser | null {
  const [user, setUser] = useState<CurrentUser | null>(null);

  useEffect(() => {
    let mounted = true;
    let epoch = 0;

    const apply = (next: CurrentUser | null) => {
      setUser(next);
      // Tag Sentry events with the current user so crash reports are
      // attributable. No-op when Sentry is not configured.
      setSentryUser(next ? { id: next.id, email: next.email } : null);
    };

    const loadUser = async () => {
      const mine = ++epoch;
      let next: CurrentUser | null = null;
      try {
        // readUserCache reads the namespaced key asynchronously and runs the
        // verified legacy `user_data` migration when needed.
        next = await readUserCache();
      } catch {
        next = null;
      }
      // Superseded by a logout or a newer load, or unmounted → discard.
      if (!mounted || mine !== epoch) return;
      apply(next);
    };

    void loadUser();
    const onLogout = () => {
      epoch += 1; // any read still in flight belongs to the previous account
      apply(null);
    };
    const onLogin = () => {
      void loadUser();
    };
    authEvents.on('logout', onLogout);
    authEvents.on('login', onLogin);
    return () => {
      mounted = false;
      authEvents.off('logout', onLogout);
      authEvents.off('login', onLogin);
    };
  }, []);

  return user;
}
