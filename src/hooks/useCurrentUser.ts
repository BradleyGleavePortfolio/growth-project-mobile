import { useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { authEvents } from '../utils/authEvents';
import { setSentryUser } from '../services/sentry';

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
    sex?: string;
    dob?: string;
    activity_level?: string;
    primary_goal?: string;
    diet_type?: string;
    tdee?: number;
  };
}

/**
 * Hook that reads the authenticated user from AsyncStorage (user_data key).
 * This replaces useAuthStore().currentUser which was from the OLD SQLite system
 * and always returns null for Supabase-authenticated users.
 */
export function useCurrentUser(): CurrentUser | null {
  const [user, setUser] = useState<CurrentUser | null>(null);

  const loadUser = async () => {
    try {
      const raw = await AsyncStorage.getItem('user_data');
      if (raw) {
        const parsed = JSON.parse(raw);
        setUser(parsed);
        // Tag Sentry events with the current user so crash reports are
        // attributable. No-op when Sentry is not configured.
        setSentryUser({ id: parsed.id, email: parsed.email });
      } else {
        setUser(null);
        setSentryUser(null);
      }
    } catch {
      setUser(null);
      setSentryUser(null);
    }
  };

  useEffect(() => {
    loadUser();
    const onLogout = () => setUser(null);
    const onLogin = () => loadUser();
    authEvents.on('logout', onLogout);
    authEvents.on('login', onLogin);
    return () => {
      authEvents.off('logout', onLogout);
      authEvents.off('login', onLogin);
    };
  }, []);

  return user;
}
