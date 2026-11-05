import { getTodayString } from './date';

/** The day on screen and the calendar day it was when that day was put on screen. */
export interface ShownDay {
  selectedDate: string;
  selectedOn?: string;
}

/**
 * FOOD-1-M R2 (operator ruling, the owner's S1): the one day rule every food and water save calls.
 * A new log goes to the day on screen at the tap. The one exception: the screen was on today and the
 * calendar has moved on since (left open past midnight), so it moves to the new today before it takes
 * the log. A screen that always logs today passes nothing. A day the member chose stays chosen, and a
 * clock that goes back (a flight west) never moves a day backwards.
 */
export function dayForNewLog(shown?: ShownDay, today: string = getTodayString()): string {
  if (!shown) return today;
  const { selectedDate, selectedOn } = shown;
  return selectedOn && selectedDate === selectedOn && today > selectedOn ? today : selectedDate;
}
