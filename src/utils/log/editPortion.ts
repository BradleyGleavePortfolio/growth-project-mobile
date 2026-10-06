import type { FoodLog } from '../../types';
import { quantityMultiplier } from './macros';
import { unitOptionsFor } from './types';

export function initialEditPortion(log: FoodLog) {
  if (log.originalQuantity != null && log.originalUnit) {
    return { quantity: log.originalQuantity, unit: log.originalUnit };
  }
  const multiplier = log.quantityMultiplier ?? log.quantity;
  return log.foodItem?.nutrient_basis === 'PER_100G'
    ? { quantity: Math.round(multiplier * 100 * 10000) / 10000, unit: 'g' }
    : { quantity: multiplier, unit: 'serving' };
}

export function editUnitsFor(log: FoodLog): readonly string[] {
  const original = initialEditPortion(log).unit;
  return [...new Set([original, ...(log.foodItem ? unitOptionsFor(log.foodItem) : [])])];
}

export function editPortionMultiplier(log: FoodLog, quantity: number, unit: string): number {
  const original = initialEditPortion(log);
  // Same-unit edits preserve the exact recorded conversion, including custom
  // portions described as "2 servings" whose nutrition belongs to the whole portion.
  if (unit === original.unit && original.quantity > 0) {
    return (log.quantityMultiplier ?? log.quantity) * quantity / original.quantity;
  }
  if (!log.foodItem || !editUnitsFor(log).includes(unit)) {
    throw new Error('Choose the original portion unit for this entry.');
  }
  return quantityMultiplier(log.foodItem, quantity, unit);
}
