import { useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface MacroTargets {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export function useMacroTargets(): MacroTargets | null {
  const [macroTargets, setMacroTargets] = useState<MacroTargets | null>(null);

  useEffect(() => {
    AsyncStorage.getItem('macro_targets')
      .then((raw) => {
        if (raw) setMacroTargets(JSON.parse(raw));
      })
      .catch((err) => {
        console.error('useMacroTargets: failed to read macro_targets', err);
      });
  }, []);

  return macroTargets;
}
