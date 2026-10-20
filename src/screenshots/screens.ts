import type { ClientTabParamList } from '../navigation/ClientNavigator';

export interface ScreenshotTarget {
  slug: string;
  audience: 'client' | 'coach';
  route: string;
  tab?: keyof ClientTabParamList;
  /** Existing screen content which must be visible before capture. */
  readyText: string;
}

// One manifest for the app and both capture drivers. No caption is rendered.
export const SCREENSHOT_TARGETS: ScreenshotTarget[] = [
  { slug: '01-home', audience: 'client', route: 'HomeMain', tab: 'Home', readyText: 'Message Sam' },
  { slug: '02-roman', audience: 'client', route: 'RomanChat', tab: 'MoreTab', readyText: 'top of your food log' },
  { slug: '03-workout', audience: 'client', route: 'ActiveWorkout', tab: 'WorkoutTab', readyText: 'Bench press' },
  { slug: '04-food', audience: 'client', route: 'Log', tab: 'Log', readyText: 'Oats with berries' },
  { slug: '05-messages', audience: 'client', route: 'Messages', tab: 'Home', readyText: 'Travelling Thursday' },
  { slug: '06-coach-overview', audience: 'coach', route: 'CommandCenter', readyText: 'All fourteen' },
];

// Apple's two iPhone slots: large display (6.9") and the required medium display (6.3").
export const SCREENSHOT_SIZES = [
  { width: 1320, height: 2868 },
  { width: 1206, height: 2622 },
];

// Owner approved (#162-3, 10-20): option A (MOCK-STORESHOTS-<id>) per frame; B options dropped.
// Data only, never baked into PNGs.
export const SCREENSHOT_CAPTIONS = [
  { slug: '01-home', id: 1, text: 'Start every day knowing what to do.' },
  { slug: '02-roman', id: 3, text: 'Clear answers, built on your own numbers.' },
  { slug: '03-workout', id: 5, text: 'Every set builds on the last.' },
  { slug: '04-food', id: 7, text: "Always know what's left for today." },
  { slug: '05-messages', id: 9, text: 'Your coach is one message away.' },
  { slug: '06-coach-overview', id: 11, text: 'Coaches see who needs them today.' },
];

export function screenshotTarget(url: string | null): ScreenshotTarget {
  const slug = url?.match(/screenshot\/([^/?#]+)/)?.[1] ?? '01-home';
  const target = SCREENSHOT_TARGETS.find((entry) => entry.slug === slug);
  if (!target) throw new Error(`Unknown screenshot: ${slug}`);
  return target;
}

export function screenshotState(target: ScreenshotTarget, params?: object) {
  const leaf = { name: target.route, ...(params ? { params } : {}) };
  return { routes: target.tab && target.tab !== target.route
    ? [{ name: target.tab, state: { routes: [leaf] } }]
    : [leaf] };
}
