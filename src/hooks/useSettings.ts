import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setHapticsEnabled } from '../ui/haptics/haptics.service';
import { profileApi } from '../services/api';
import { readUserCache } from '../lib/userCache';

const SETTINGS_KEY = 'gp_client_settings';

export interface ClientSettings {
  unit: 'lbs' | 'kg';
  mealsPerDay: number;
  waterGoalOz: number;
  calorieDisplay: 'net' | 'gross';
  dailyCheckin: boolean;
  mealReminders: boolean;
  fastingAlerts: boolean;
  weeklySummary: boolean;
  hapticsEnabled: boolean;
}

export const DEFAULT_SETTINGS: ClientSettings = {
  unit: 'lbs',
  mealsPerDay: 4,
  waterGoalOz: 100,
  calorieDisplay: 'net',
  dailyCheckin: true,
  mealReminders: true,
  // On by default, like the backend's fasting_enabled: the Fasting screen and
  // Shortcuts schedule the end-of-fast alert only while this is on.
  fastingAlerts: true,
  weeklySummary: true,
  hapticsEnabled: true,
};

// Every mounted useSettings() sees a save at once (e.g. Water Goal on the Food Log).
const listeners = new Set<(s: ClientSettings) => void>();

// Settings > Water Goal also saves the goal to the profile (water_goal_oz).
// A phone with no goal saved on it (new install, second phone) takes the
// profile's goal instead of showing the 100 oz default. At most one profile
// read per app session; a failed read (offline, signed out) is tried again
// the next time settings load.
let profileSeed: Promise<ClientSettings | null> | null = null;

async function seedWaterGoalFromProfile(): Promise<ClientSettings | null> {
  if (!(await readUserCache())) throw new Error('not signed in');
  const res = await profileApi.get();
  const goal = (res.data as { water_goal_oz?: unknown } | undefined)?.water_goal_oz;
  if (typeof goal !== 'number' || !Number.isFinite(goal) || goal <= 0) return null;
  const stored = await AsyncStorage.getItem(SETTINGS_KEY);
  const saved: Partial<ClientSettings> = stored ? JSON.parse(stored) : {};
  // A goal saved on this phone in the meantime wins.
  if (typeof saved.waterGoalOz === 'number') return null;
  const next: ClientSettings = { ...DEFAULT_SETTINGS, ...saved, waterGoalOz: Math.round(goal) };
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  return next;
}

export function useSettings() {
  const [settings, setSettings] = useState<ClientSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    loadSettings();
    listeners.add(setSettings);
    return () => {
      listeners.delete(setSettings);
    };
  }, []);

  const loadSettings = async () => {
    try {
      const stored = await AsyncStorage.getItem(SETTINGS_KEY);
      const saved: Partial<ClientSettings> | null = stored ? JSON.parse(stored) : null;
      if (saved) {
        const parsed: ClientSettings = { ...DEFAULT_SETTINGS, ...saved };
        setSettings(parsed);
        // Sync haptics service with persisted preference on load
        setHapticsEnabled(parsed.hapticsEnabled);
      }
      if (typeof saved?.waterGoalOz !== 'number' && !profileSeed) {
        profileSeed = seedWaterGoalFromProfile();
        void profileSeed.then(
          (seeded) => { if (seeded) listeners.forEach((notify) => notify(seeded)); },
          () => { profileSeed = null; },
        );
      }
    } catch {
      await AsyncStorage.removeItem(SETTINGS_KEY);
      setSettings(DEFAULT_SETTINGS);
    } finally {
      setLoaded(true);
    }
  };

  const saveSettings = useCallback(async (updated: ClientSettings) => {
    setSettings(updated);
    listeners.forEach((notify) => notify(updated));
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
  }, []);

  const updateSetting = useCallback(
    <K extends keyof ClientSettings>(key: K, value: ClientSettings[K]) => {
      const updated = { ...settings, [key]: value };
      saveSettings(updated);
      // Keep HapticService in sync whenever hapticsEnabled is toggled
      if (key === 'hapticsEnabled') {
        setHapticsEnabled(value as boolean);
      }
    },
    [settings, saveSettings],
  );

  return { settings, loaded, saveSettings, updateSetting };
}
