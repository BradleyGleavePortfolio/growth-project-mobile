/**
 * focusedRoutePath — route names from the given navigator state down to the
 * focused leaf, e.g. ['MoreTab', 'Connections'] or ['Log']. Works on the
 * (possibly partial) state objects React Navigation hands to `state` events.
 */
export interface NavStateLike {
  index?: number;
  routes?: Array<{ name: string; state?: NavStateLike }>;
}

export function focusedRoutePath(state: NavStateLike | undefined | null): string[] {
  const out: string[] = [];
  let s: NavStateLike | undefined | null = state;
  for (let depth = 0; s && Array.isArray(s.routes) && s.routes.length > 0 && depth < 12; depth++) {
    const idx = typeof s.index === 'number' ? s.index : s.routes.length - 1;
    const route = s.routes[Math.min(Math.max(idx, 0), s.routes.length - 1)];
    out.push(route.name);
    s = route.state;
  }
  return out;
}

/**
 * Leaf names of navigators that have not been visited yet are absent from
 * the state tree. These are each tab's initial screen so a freshly focused
 * tab still reports its real leaf.
 */
const INITIAL_LEAF: Record<string, string> = {
  Home: 'HomeMain',
  WorkoutTab: 'WorkoutMain',
  MoreTab: 'MoreIndex',
  // S-SCHED Calendar tab (featureFlags.clientCalendar).
  CalendarTab: 'CalendarHome',
};

export function withInitialLeaf(path: string[]): string[] {
  if (path.length === 1 && INITIAL_LEAF[path[0]]) return [path[0], INITIAL_LEAF[path[0]]];
  return path;
}
