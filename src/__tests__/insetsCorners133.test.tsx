// REDO-INSETS-133 (agent 133): the redo screens take their top from the
// Screen wrapper (react-native-safe-area-context insets + 12 pt), never a
// fixed 56/60, and their corners from the rounded radius tokens (owner
// 17:07 "nice rounded corners, luxurious, not rectangles"), never a literal.
import React from 'react';
import * as fs from 'fs';
import * as path from 'path';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { listsApi, prepGuideApi } from '../services/api';
import { layout } from '../theme/tokens';
import GroceryListScreen from '../screens/client/GroceryListScreen';
import PrepGuideScreen from '../screens/client/PrepGuideScreen';

jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ goBack: jest.fn(), navigate: jest.fn() }) }));
jest.mock('../components/FadeInView', () => ({
  __esModule: true, default: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(), notificationAsync: jest.fn(), selectionAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
  NotificationFeedbackType: { Success: 'success' },
}));
jest.mock('../services/api', () => ({
  listsApi: { getList: jest.fn(), addItem: jest.fn(), bulkAdd: jest.fn(), updateItem: jest.fn(), deleteItem: jest.fn(), clearChecked: jest.fn() },
  prepGuideApi: { getWeeklyGuide: jest.fn() },
}));

// The two phones the Q5 bar names: a 360x800 Android (edge-to-edge, 24 pt
// status bar) and a 390x844 iPhone (47 pt notch inset).
const DEVICES = [
  { name: 'Android 360x800', frame: { x: 0, y: 0, width: 360, height: 800 }, insets: { top: 24, bottom: 16, left: 0, right: 0 } },
  { name: 'iPhone 390x844', frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, bottom: 34, left: 0, right: 0 } },
];

function mount(Comp: React.ComponentType, metrics: (typeof DEVICES)[number]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <SafeAreaProvider initialMetrics={{ frame: metrics.frame, insets: metrics.insets }}>
      <QueryClientProvider client={client}><Comp /></QueryClientProvider>
    </SafeAreaProvider>,
  );
}

describe.each(DEVICES)('inset top on $name', (device) => {
  beforeEach(() => {
    jest.mocked(listsApi.getList).mockResolvedValue({ data: { items: [] } } as Awaited<ReturnType<typeof listsApi.getList>>);
    jest.mocked(prepGuideApi.getWeeklyGuide).mockResolvedValue(
      { data: { recipes: [], aggregated_ingredients: [], prep_day_suggestions: [] } } as Awaited<ReturnType<typeof prepGuideApi.getWeeklyGuide>>,
    );
  });

  it.each([['Grocery list', GroceryListScreen], ['Prep guide', PrepGuideScreen]] as const)(
    '%s sits insets.top + 12 under the status bar, with Back still there',
    async (_label, Comp) => {
      const view = await mount(Comp, device);
      const root = StyleSheet.flatten(view.getByTestId('grocery-prep-screen').props.style);
      expect(root.paddingTop).toBe(device.insets.top + layout.statusBarGap);
      expect(view.getByLabelText('Back')).toBeTruthy();
    },
  );
});

// ── Source guard over every file in the APPLY-INSETS-133 list ──────────────
const ROOT = path.resolve(__dirname, '..');
const SCREENS = [
  'WorkoutScreen', 'EditProfileScreen', 'EducationScreen', 'GroceryListScreen', 'PrepGuideScreen', 'RecipesScreen',
  'RecipeDetailScreen', 'RoutineBuilderScreen', 'WidgetsScreen', 'ClientPackagesScreen', 'PackageCheckoutScreen',
  'PurchaseUnpackScreen', 'CoachGuidelinesScreen', 'MessagesScreen', 'LeaderboardScreen', 'TimelineScreen',
  'LeaderboardSettingsScreen', // CLIENT-POLISH-134
].map((n) => path.join(ROOT, 'screens', 'client', `${n}.tsx`));
const SHARED = ['MessageBubble', 'ThreadV2Parts'].map((n) => path.join(ROOT, 'components', 'messaging', `${n}.tsx`));
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const read = (f: string) => strip(fs.readFileSync(f, 'utf8'));

describe('insets and corners on the redo screens (source)', () => {
  it.each([...SCREENS, ...SHARED].map((f) => [path.basename(f), f]))('%s has no literal radius', (_n, f) => {
    expect(read(f).match(/border(?:Top|Bottom)?(?:Left|Right)?Radius:\s*\d+/g)).toBeNull();
  });

  it.each(SCREENS.map((f) => [path.basename(f), f]))('%s never imports SafeAreaView from react-native', (_n, f) => {
    expect(read(f)).not.toMatch(/import\s*\{[^}]*\bSafeAreaView\b[^}]*\}\s*from\s*'react-native'/);
  });

  it.each(SCREENS.map((f) => [path.basename(f), f]))('%s has no fixed status-bar top on a header or page', (_n, f) => {
    // Header, top bar and page containers only; empty-state spacing may stay.
    const blocks = read(f).match(/\b(?:header|topBar|chatHeader|noCoachHeader|detailHeader|content|container|wrapper)\s*:\s*\{[^}]*\}/g) ?? [];
    for (const b of blocks) expect({ b, fixed: /paddingTop:\s*(?:[4-9]\d)\b|\btop:\s*56\b/.test(b) }).toEqual({ b, fixed: false });
  });

  it('takes the top from the Screen wrapper (or its inset hook) everywhere a header does not own it', () => {
    // CLIENT-POLISH-134: Leaderboard is on Screen now; only Timeline (native header) is exempt.
    const own = SCREENS.filter((f) => !/TimelineScreen/.test(f));
    for (const f of own) {
      expect({ f, wrapper: /import \{[^}]*\b(?:Screen|useScreenInsets)\b[^}]*\} from '\.\.\/\.\.\/ui'/.test(read(f)) }).toEqual({ f, wrapper: true });
    }
    // Timeline sits under the native back-only header: it must not add insets.top again.
    expect(read(SCREENS.find((f) => f.endsWith('TimelineScreen.tsx'))!)).not.toMatch(/insets\.top/);
  });
});
