/**
 * C8 v2 PR 2b: the Progress page's numbers and sentences. Pounds in (the
 * server stores weight_lbs); every word is in the client's own unit
 * (profile.weight_unit, lb unless it says kg). Up and down read alike.
 */
import { weightPeriod, weightTrend, type WeightPeriod, type WeightSample } from '../../../components/progress/weightTrend';
import type { WeightLog } from '../../../types';

export type WeightUnit = 'lb' | 'kg';
const KG = 0.45359237;
const DAY = 86_400_000;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const unitOf = (weightUnit?: string | null): WeightUnit => (weightUnit === 'kg' ? 'kg' : 'lb');
export const toUnit = (lbs: number, unit: WeightUnit) => (unit === 'kg' ? lbs * KG : lbs);
export const toLbs = (value: number, unit: WeightUnit) => (unit === 'kg' ? value / KG : value);
/** One decimal, always: 168.9, 0.3. */
export const one = (n: number) => (Math.round(n * 10) / 10).toFixed(1);
/** A calendar day as UTC midnight, the x the 2a chart buckets on. */
export const dayX = (day: string) => Date.parse(`${day.slice(0, 10)}T00:00:00Z`);
const utc = (x: number) => new Date(x);
export const monthDay = (day: string) => `${MONTHS[utc(dayX(day)).getUTCMonth()]} ${utc(dayX(day)).getUTCDate()}`;

export const samplesOf = (logs: WeightLog[]): WeightSample[] => logs.map((l) => ({ x: dayX(l.date), y: l.weight }));

/** The trend now (pounds), or null with no weigh-ins. */
export function trendNow(logs: WeightLog[], today: string): number | null {
  return weightTrend(samplesOf(logs), dayX(today)).pop()?.y ?? null;
}

/** C8-S-219 (All), "in 30 days" (Month), C8V2-S-12 (Week). Null until the line has two weigh-ins. */
export function trendSentence(logs: WeightLog[], period: WeightPeriod, unit: WeightUnit, today: string): string | null {
  const days = weightPeriod(weightTrend(samplesOf(logs), dayX(today)), period);
  const first = days[0];
  const last = days[days.length - 1];
  if (!last || last.count < 2) return null;
  const delta = toUnit(last.y - first.y, unit);
  const span = period === '7D' ? 'this week' : period === '30D' ? 'in 30 days' : `since ${MONTHS[utc(first.x).getUTCMonth()]}`;
  if (one(Math.abs(delta)) === '0.0') return `Steady ${span}.`;
  const weeks = (last.x - first.x) / (7 * DAY);
  const pace = period === 'All' && weeks >= 2 ? `, about ${one(Math.abs(delta) / weeks)} ${unit} a week` : '';
  return `${delta < 0 ? 'Down' : 'Up'} ${one(Math.abs(delta))} ${unit} ${span}${pace}.`;
}

/** C8-S-172 and C8V2-S-09: the same words and colour whichever way it moved. */
export function trendMove(lbs: number, unit: WeightUnit): string {
  const n = one(Math.abs(toUnit(lbs, unit)));
  return n === '0.0' ? 'Trend steady' : `Trend ${lbs < 0 ? 'down' : 'up'} ${n} ${unit}`;
}

/** C8-S-227: "Monday was 169.1 lb" within the week, else "October 6 was ...". Null for today. */
export function lastWas(log: WeightLog | null, unit: WeightUnit, today: string): string | null {
  if (!log || log.date === today) return null;
  const ago = (dayX(today) - dayX(log.date)) / DAY;
  const when = ago < 7 ? WEEKDAYS[utc(dayX(log.date)).getUTCDay()] : monthDay(log.date);
  return `${when} was ${one(toUnit(log.weight, unit))} ${unit}`;
}
