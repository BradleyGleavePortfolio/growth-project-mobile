/**
 * FIX-974R1 (LS-974R1 B1): C1 Style C v2 draws the workout summary (C2_summary_*, C2_error_*) as the whole screen,
 * with no tab bar under Send. The live workout says so on its own route (`summary: true` while the summary is open,
 * ActiveWorkoutScreen); the client tab navigator hides the bar while that route is the tab's focused screen.
 */
type TabRouteLike = {
  name: string;
  state?: { index?: number; routes?: ReadonlyArray<{ name: string; params?: object }> };
};

export function summaryHidesTabBar(route: TabRouteLike): boolean {
  const routes = route.state?.routes;
  if (!routes?.length) return false;
  // A partial state (no index yet) has its last route focused.
  const focused = routes[route.state?.index ?? routes.length - 1];
  return focused?.name === 'ActiveWorkout' && (focused.params as { summary?: unknown } | undefined)?.summary === true;
}
