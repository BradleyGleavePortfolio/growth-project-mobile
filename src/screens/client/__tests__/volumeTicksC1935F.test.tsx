/**
 * C1-935-FOLLOWUPS-M (agent 203), class-first [R24]: the Train tab's Training volume chart never prints "0k" on its
 * side. A side label under 1,000 (after rounding) prints its whole number, as the bar labels do under 1,000; a label
 * of 1,000 or more keeps main's "<n>k"; the bottom label stays "0" (operator ruling R2). Each row mounts the real
 * WorkoutScreen with one session this week whose volume is N lb (one set of N lb x 1) and reads the three side labels
 * top to bottom. Member rows (e to h) are red on main; control rows (i) hold.
 */
import React from 'react';
import { AppState } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';

jest.mock('../../../config/featureFlags', () => ({ featureFlags: { romanChat: false, clientTutorial: false } }));

const mockUser: { id: string; email: string; role: string } = { id: 'c1', email: 'c1@example.test', role: 'client' };
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));

const mockNavigate = jest.fn();
const mockNavigation = { navigate: mockNavigate, setParams: jest.fn(), getParent: () => ({ navigate: mockNavigate }) };
jest.mock('@react-navigation/native', () => {
  const ReactLib = jest.requireActual('react');
  return {
    NavigationContext: require('react').createContext(undefined),
    useNavigation: () => mockNavigation,
    useRoute: () => ({ params: {} }),
    useFocusEffect: (cb: () => undefined | (() => void)) => {
      ReactLib.useEffect(() => {
        const cleanup = cb();
        return typeof cleanup === 'function' ? cleanup : undefined;
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
    },
  };
});

const mockGetAll = jest.fn();
jest.mock('../../../services/api', () => ({
  workoutApi: {
    getRoutines: async () => ({ data: [] }),
    getAll: (...a: unknown[]) => mockGetAll(...a),
    getVolume: async () => ({ data: [] }),
    deleteWorkout: jest.fn(async () => ({})),
  },
}));
jest.mock('../../../hooks/useWorkoutBuilder', () => ({
  useMyWorkoutAssignments: () => ({ data: [], refetch: async () => ({}) }),
}));
jest.mock('../../../storage/activeWorkoutSession', () => ({ loadActiveWorkoutSession: async () => null }));
jest.mock('../../../offline', () => ({
  countQueuedWorkouts: async () => 0,
  pushQueuedWorkouts: async () => undefined,
  workoutSyncEvents: { on: () => undefined, off: () => undefined },
}));
jest.mock('../../../components/workout/WorkoutSyncCards', () => () => null);
jest.mock('../../../components/tutorial/PlanExplanationCard', () => () => null);
jest.mock('../../../components/FadeInView', () => ({ children }: { children: React.ReactNode }) => children);

import WorkoutScreen from '../WorkoutScreen';

/** One session a minute ago (this week's bar), one set of `lb` lb x 1: the week's volume is `lb`. */
const session = (lb: number) => ({
  id: 's1', date: new Date(Date.now() - 60_000).toISOString(), workout_name: 'Session s1', duration_minutes: 30, notes: '',
  exercises: [{ muscle_group: 'chest', exercise_name: 'Bench Press', sets_completed: 1, weight_per_set: [lb], reps_per_set: [1] }],
});

type Node = { type?: string; props?: Record<string, unknown>; children?: Array<Node | string> | null };
const all = (node: Node | string | null | undefined, out: Node[] = []): Node[] => {
  if (!node || typeof node === 'string') return out;
  out.push(node);
  (node.children ?? []).forEach((c) => all(c, out));
  return out;
};
const texts = (n: Node): string[] => all(n).flatMap((x) => (x.children ?? []).filter((c): c is string => typeof c === 'string'));
/** The volume chart: a row of the side axis (text only) and the horizontal bar scroller. */
function charts(view: { toJSON: () => unknown }): Array<{ side: string[]; bars: string[] }> {
  return all(view.toJSON() as Node)
    .filter((n) => {
      const [axis, bars] = (n.children ?? []) as Node[];
      return (n.children ?? []).length === 2 && typeof bars === 'object' && bars?.props?.horizontal === true
        && typeof axis === 'object' && (axis.children ?? []).length === 3
        && (axis.children ?? []).every((c) => typeof c === 'object' && (c.children ?? []).every((t) => typeof t === 'string'));
    })
    .map((n) => {
      const [axis, bars] = n.children as Node[];
      return { side: (axis.children as Node[]).map((t) => texts(t).join('')), bars: texts(bars).filter((t) => t !== '' && !/^W\d$/.test(t)) };
    });
}

async function show(lb: number | null) {
  mockGetAll.mockResolvedValue({ data: lb === null ? [] : [session(lb)] });
  const view = await render(<WorkoutScreen />);
  if (lb === null) await waitFor(() => expect(view.getByText('Complete workouts to see volume data')).toBeTruthy());
  else await waitFor(() => expect(view.getByText('Training volume')).toBeTruthy());
  return view;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));
});

describe('C1-935-FOLLOWUPS-M: the Train volume chart\'s side labels never read "0k"', () => {
  it.each([
    // case | heaviest week (lb) | side labels, top to bottom
    ['member (e): a 400 lb week', 400, ['400', '200', '0']],
    ['member (f): a 900 lb week', 900, ['900', '450', '0']],
    ['member (g): a 999 lb week', 999, ['999', '500', '0']],
    ['member (h): a 1,000 lb week (the 500 lb mid label)', 1000, ['1k', '500', '0']],
    ['control (i): a 12,345 lb week keeps main\'s "k"', 12345, ['12k', '6k', '0']],
    ['control (i): a 1,999 lb week, the 999.5 mid label rounds to "1k"', 1999, ['2k', '1k', '0']],
  ] as const)('%s', async (_name, lb, side) => {
    const view = await show(lb);
    const found = charts(view);
    expect(found).toHaveLength(1);
    expect(found[0].side).toEqual([...side]);
    expect(view.queryAllByText('0k')).toEqual([]);
  });

  it.each([
    ['control (i): the bar label for 400 lb reads "400"', 400, '400'],
    ['control (i): the bar label for 12,345 lb reads "12.3k"', 12345, '12.3k'],
  ] as const)('%s', async (_name, lb, bar) => {
    const view = await show(lb);
    expect(charts(view)[0].bars).toEqual([bar]);
  });

  it('control (i): no session gives the empty line and no chart labels', async () => {
    const view = await show(null);
    expect(charts(view)).toEqual([]);
    expect(view.queryByText('Training volume')).toBeNull();
  });
});
