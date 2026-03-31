import { useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { authEvents } from '../utils/authEvents';

export interface CurrentUser {
  id: string;
  email: string;
  name?: string;
  role?: string;
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
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
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
