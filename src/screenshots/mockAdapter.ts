/**
 * Axios adapter that returns canned responses for the endpoints the
 * marketing-target screens hit. Anything not matched returns 404 so a
 * dropped fixture is loud, not silent.
 *
 * Installation order matters: this must run AFTER `services/api.ts` has
 * created its axios instance, so call `installAxiosMockAdapter()` from
 * `App.tsx` immediately after the Sentry init and before render.
 *
 * The adapter never touches the network. It does not validate auth headers
 * because the seeded `supabase_token` is a placeholder.
 */
import type {
  AxiosAdapter,
  AxiosRequestConfig,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from 'axios';
import api from '../services/api';
import { isScreenshotMode } from './mode';
import {
  DEMO_AUTH_ME,
  DEMO_COMMUNITY_FEED,
  DEMO_DAILY_TOTAL_ML,
  DEMO_FASTING_HISTORY,
  DEMO_FOOD_LOGS,
  DEMO_HABITS,
  DEMO_MEAL_PLANS,
  DEMO_MESSAGES,
  DEMO_RECIPES,
  DEMO_USER,
  DEMO_WEIGHT_HISTORY,
} from './fixtures';

type Handler = (
  config: InternalAxiosRequestConfig,
  match: RegExpMatchArray,
) => unknown;

interface Route {
  method: string;
  pattern: RegExp;
  handler: Handler;
}

const ROUTES: Route[] = [
  // Auth ─────────────────────────────────────────────────────────────────────
  { method: 'GET',  pattern: /^\/auth\/me$/,                handler: () => DEMO_AUTH_ME },
  { method: 'GET',  pattern: /^\/auth\/signup-policy$/,
    handler: () => ({ require_invite_code: false, google_signin_enabled: true }) },

  // Profile / preferences ────────────────────────────────────────────────────
  { method: 'GET',  pattern: /^\/profile$/,                 handler: () => DEMO_USER.profile },
  { method: 'GET',  pattern: /^\/users\/me\/preferences$/,
    handler: () => ({ units: 'imperial', tone: 'direct' }) },
  { method: 'GET',  pattern: /^\/notifications\/preferences$/,
    handler: () => ({ daily_log_reminder: true, fasting_alerts: true }) },

  // Daily nutrition log ──────────────────────────────────────────────────────
  { method: 'GET',  pattern: /^\/log\/daily/,
    handler: () => ({ logs: DEMO_FOOD_LOGS, totals: totalsFromLogs(DEMO_FOOD_LOGS) }) },
  { method: 'GET',  pattern: /^\/log\/weekly/,
    handler: () => ({ days: weeklyFromLogs() }) },

  // Water ────────────────────────────────────────────────────────────────────
  { method: 'GET',  pattern: /^\/nutrition\/water\?/,
    handler: () => ({ total_ml: DEMO_DAILY_TOTAL_ML }) },
  { method: 'GET',  pattern: /^\/nutrition\/water\/weekly/,
    handler: () => ({ days: [] }) },

  // Foods (search) ───────────────────────────────────────────────────────────
  { method: 'GET',  pattern: /^\/foods\/search/,
    handler: () => ({
      results: DEMO_RECIPES.map((r) => ({
        id: r.id,
        name: r.title,
        calories: r.calories,
        protein_g: r.protein,
        carbs_g: r.carbs,
        fat_g: r.fat,
      })),
    }) },

  // Meal plans ───────────────────────────────────────────────────────────────
  { method: 'GET',  pattern: /^\/meal-plans$/,              handler: () => DEMO_MEAL_PLANS },
  { method: 'GET',  pattern: /^\/meal-plans\/[^/]+$/,       handler: () => DEMO_MEAL_PLANS[0] },

  // Recipes ──────────────────────────────────────────────────────────────────
  { method: 'GET',  pattern: /^\/recipes$/,                 handler: () => DEMO_RECIPES },
  { method: 'GET',  pattern: /^\/recipes\/saved$/,          handler: () => DEMO_RECIPES.slice(0, 2) },
  { method: 'GET',  pattern: /^\/recipes\/[^/]+$/,
    handler: (_c, m) => DEMO_RECIPES.find((r) => r.id === m[0].split('/').pop()) ?? DEMO_RECIPES[0] },

  // Weight ───────────────────────────────────────────────────────────────────
  { method: 'GET',  pattern: /^\/weight\/history/,          handler: () => DEMO_WEIGHT_HISTORY },

  // Fasting ──────────────────────────────────────────────────────────────────
  { method: 'GET',  pattern: /^\/fasting\/history/,         handler: () => DEMO_FASTING_HISTORY },

  // Habits ───────────────────────────────────────────────────────────────────
  { method: 'GET',  pattern: /^\/habits$/,                  handler: () => DEMO_HABITS },
  { method: 'GET',  pattern: /^\/habits\/logs/,             handler: () => [] },

  // Workouts ─────────────────────────────────────────────────────────────────
  { method: 'GET',  pattern: /^\/workouts/,                 handler: () => [] },
  { method: 'GET',  pattern: /^\/routines$/,                handler: () => [] },

  // Messages / nudges / community ────────────────────────────────────────────
  { method: 'GET',  pattern: /^\/messages(\?|$)/,           handler: () => DEMO_MESSAGES },
  { method: 'GET',  pattern: /^\/messages\/unread-count$/,  handler: () => ({ count: 0 }) },
  { method: 'GET',  pattern: /^\/nudges(\?|$)/,             handler: () => [] },
  { method: 'GET',  pattern: /^\/nudges\/unread-count$/,    handler: () => ({ count: 0 }) },
  { method: 'GET',  pattern: /^\/community\/feed$/,         handler: () => DEMO_COMMUNITY_FEED },

  // Lessons ──────────────────────────────────────────────────────────────────
  { method: 'GET',  pattern: /^\/lessons$/,                 handler: () => [] },
  { method: 'GET',  pattern: /^\/lessons\/recommended$/,    handler: () => [] },

  // Lists / prep guide ───────────────────────────────────────────────────────
  { method: 'GET',  pattern: /^\/lists\/(grocery|shopping)$/, handler: () => ({ items: [] }) },
  { method: 'GET',  pattern: /^\/prep-guide/,               handler: () => ({ items: [] }) },

  // Check-ins ────────────────────────────────────────────────────────────────
  { method: 'GET',  pattern: /^\/check-ins(\?|$)/,          handler: () => [] },

  // Founding number / membership ─────────────────────────────────────────────
  { method: 'GET',  pattern: /^\/users\/me\/founding-number$/,
    handler: () => ({ rank: 47, total: 500, isFoundingMember: true }) },
  { method: 'GET',  pattern: /^\/users\/me\/training-today$/,
    handler: () => ({ trainedTodayCount: 184, totalMembers: 412 }) },
  { method: 'GET',  pattern: /^\/users\/me\/account\/status$/,
    handler: () => ({ status: 'active' }) },

  // Catch-all writes — accept and echo so Log/Plan flows do not blow up if
  // the user taps something during capture. We still prefer to capture before
  // any interaction, but this keeps the harness robust.
  { method: 'POST',   pattern: /.*/, handler: (config) => echo(config) },
  { method: 'PUT',    pattern: /.*/, handler: (config) => echo(config) },
  { method: 'DELETE', pattern: /.*/, handler: () => ({ ok: true }) },
];

function totalsFromLogs(
  logs: typeof DEMO_FOOD_LOGS,
): { calories: number; protein: number; carbs: number; fat: number } {
  return logs.reduce(
    (acc, l) => ({
      calories: acc.calories + (l.food_item.calories ?? 0),
      protein: acc.protein + (l.food_item.protein_g ?? 0),
      carbs: acc.carbs + (l.food_item.carbs_g ?? 0),
      fat: acc.fat + (l.food_item.fat_g ?? 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );
}

function weeklyFromLogs(): unknown[] {
  // Lightweight stub — the screen tolerates an empty week. Backfill if/when a
  // weekly screen joins the screenshot set.
  return [];
}

function echo(config: InternalAxiosRequestConfig): unknown {
  return { ok: true, echoed: config.data ?? null };
}

function makeResponse(
  config: InternalAxiosRequestConfig,
  body: unknown,
  status = 200,
): AxiosResponse {
  return {
    data: body,
    status,
    statusText: 'OK',
    headers: {},
    config,
    request: {},
  } as AxiosResponse;
}

function urlForMatch(config: AxiosRequestConfig): string {
  // axios stores the path in `url` and the base in `baseURL`. Match against
  // path-only so fixture patterns are stable across env URLs.
  const raw = String(config.url ?? '');
  // Strip any baseURL prefix that may have been concatenated.
  const stripped = raw.replace(/^https?:\/\/[^/]+/, '');
  return stripped.startsWith('/') ? stripped : `/${stripped}`;
}

const mockAdapter: AxiosAdapter = (config) => {
  const method = String(config.method ?? 'GET').toUpperCase();
  const path = urlForMatch(config);
  for (const route of ROUTES) {
    if (route.method !== method) continue;
    const m = path.match(route.pattern);
    if (!m) continue;
    const body = route.handler(config as InternalAxiosRequestConfig, m);
    return Promise.resolve(makeResponse(config as InternalAxiosRequestConfig, body));
  }
  // Loud miss — surface the path so a missing fixture is easy to spot.
  // eslint-disable-next-line no-console
  console.warn(`[screenshot mock] no route for ${method} ${path}`);
  return Promise.resolve(
    makeResponse(config as InternalAxiosRequestConfig, { error: 'no fixture' }, 404),
  );
};

let installed = false;

export function installAxiosMockAdapter(): void {
  if (!isScreenshotMode()) return;
  if (installed) return;
  installed = true;
  // The exported `api` instance is the same instance every endpoint helper
  // wraps, so swapping the adapter once flips the entire surface to fixtures.
  (api.defaults as { adapter?: AxiosAdapter }).adapter = mockAdapter;
}
