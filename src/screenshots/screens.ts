/**
 * The screens we capture for the App Store / Play Store listing. Each entry
 * names a navigation route reachable from `ClientNavigator`. The capture
 * scripts walk this list, deep-link to the route via `tgp://` (or set the
 * initial route on web), then snapshot the simulator/page.
 *
 * Order matters — App Store Connect uses the first three slots most heavily.
 */
export interface ScreenshotTarget {
  /** Stable identifier used as the output filename slug. */
  slug: string;
  /** Human-friendly caption for the marketing layout, optional. */
  caption: string;
  /** Navigation route name in `ClientNavigator`. */
  route: string;
  /**
   * Tab to select first (one of the four bottom tabs) before pushing to the
   * route, when the route lives inside a stack. Omit when `route` is itself
   * a tab.
   */
  tab?: 'Home' | 'WorkoutTab' | 'Log' | 'MoreTab';
}

export const SCREENSHOT_TARGETS: ScreenshotTarget[] = [
  { slug: '01-home',     caption: 'One thought, today.',       route: 'Home',     tab: 'Home' },
  { slug: '02-log',      caption: 'Log a meal in seconds.',    route: 'Log',      tab: 'Log' },
  { slug: '03-plan',     caption: 'This week, dialled in.',    route: 'Plan',     tab: 'MoreTab' },
  { slug: '04-recipes',  caption: 'Coach-made recipes.',       route: 'Recipes',  tab: 'MoreTab' },
  { slug: '05-progress', caption: 'A trend, not a number.',    route: 'Progress', tab: 'MoreTab' },
  { slug: '06-fasting',  caption: 'Fast on protocol.',         route: 'Fast',     tab: 'MoreTab' },
];
