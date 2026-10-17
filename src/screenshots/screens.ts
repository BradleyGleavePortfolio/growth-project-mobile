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
  { slug: '02-roman', audience: 'client', route: 'RomanChat', tab: 'MoreTab', readyText: 'Protein first' },
  { slug: '03-workout', audience: 'client', route: 'ActiveWorkout', tab: 'WorkoutTab', readyText: 'Bench press' },
  { slug: '04-food', audience: 'client', route: 'Log', tab: 'Log', readyText: 'Oats with berries' },
  { slug: '05-messages', audience: 'client', route: 'Messages', tab: 'Home', readyText: 'Travelling Thursday' },
  { slug: '06-coach-overview', audience: 'coach', route: 'CommandCenter', readyText: '14' },
];

export const SCREENSHOT_SIZES = [
  { width: 1320, height: 2868 },
  { width: 1290, height: 2796 },
];

// Owner decision pending. These options remain data, never baked into PNGs.
export const SCREENSHOT_CAPTIONS = [
  { ids: [1, 2], a: 'Start every day knowing what to do.', b: "Today's workout and macros, on one screen." },
  { ids: [3, 4], a: 'Clear answers, built on your own numbers.', b: 'Roman, an AI guide for training and food.' },
  { ids: [5, 6], a: 'Every set builds on the last.', b: 'Log every set, with last time in view.' },
  { ids: [7, 8], a: "Always know what's left for today.", b: 'Log meals with search and recent foods.' },
  { ids: [9, 10], a: 'Your coach is one message away.', b: 'Message your coach right in the app.' },
  { ids: [11, 12], a: 'Coaches see who needs them today.', b: 'For coaches: clients, money and alerts.' },
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
