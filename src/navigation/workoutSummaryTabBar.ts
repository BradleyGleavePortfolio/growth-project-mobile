/**
 * FIX-974R1 (LS-974R1 B1): C1 Style C v2 draws the workout summary (C2_summary_*, C2_error_*) as the whole screen,
 * with no tab bar under Send. The live workout says so on its own route (`summary: true` while the summary is open,
 * ActiveWorkoutScreen); the client tab navigator hides the bar while that route is the tab's focused screen.
 */
type StackStateLike = { index?: number; routes?: ReadonlyArray<{ name: string; params?: object }> };
type TabRouteLike = { key?: string; name: string; state?: StackStateLike };
type TabNavigationLike = { getState: () => { routes: ReadonlyArray<TabRouteLike> } };

export function summaryHidesTabBar(route: TabRouteLike, navigation?: TabNavigationLike): boolean {
  // react-navigation hands screenOptions the tab route without its child state (it keeps the stack's state off that
  // object), so the stack is read from the tab navigator's own state; a route that carries its state is read as is.
  const stack = route.state ?? navigation?.getState().routes.find((r) => r.key === route.key)?.state;
  const routes = stack?.routes;
  if (!routes?.length) return false;
  // A partial state (no index yet) has its last route focused.
  const focused = routes[stack?.index ?? routes.length - 1];
  return focused?.name === 'ActiveWorkout' && (focused.params as { summary?: unknown } | undefined)?.summary === true;
}
