import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setHapticsEnabled } from '../ui/haptics/haptics.service';

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
  fastingAlerts: false,
  weeklySummary: true,
  hapticsEnabled: true,
};

// Every mounted useSettings() sees a save at once (e.g. Water Goal on the Food Log).
const listeners = new Set<(s: ClientSettings) => void>();

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
      if (stored) {
        const parsed: ClientSettings = { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
        setSettings(parsed);
        // Sync haptics service with persisted preference on load
        setHapticsEnabled(parsed.hapticsEnabled);
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
