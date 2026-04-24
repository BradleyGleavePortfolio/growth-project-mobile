import { SearchResult } from './types';

export const calcMacros = (food: SearchResult, qty: number, unit: string) => {
  let multiplier = qty;
  if (unit === 'g') {
    multiplier = qty / 100;
  } else if (unit === 'oz') {
    multiplier = (qty * 28.35) / 100;
  }
  return {
    calories: Math.round(food.calories * multiplier),
    protein: Math.round(food.protein * multiplier * 10) / 10,
    carbs: Math.round(food.carbs * multiplier * 10) / 10,
    fat: Math.round(food.fat * multiplier * 10) / 10,
  };
};

export const quantityMultiplier = (qty: number, unit: string): number => {
  if (unit === 'g') return qty / 100;
  if (unit === 'oz') return (qty * 28.35) / 100;
  return qty;
};
