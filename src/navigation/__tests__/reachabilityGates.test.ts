/**
 * S-REACH: static reachability and flag-gate guarantees (docs/reachability.md).
 *
 * 1. Launch surfaces keep at least one on-screen entry: a navigate()/screen:
 *    reference from a screen or component, not only from push-tap routing,
 *    the tutorial or the screenshot script (none of those is a way in that a
 *    person can find by looking).
 * 2. Hidden surfaces stay hidden: lab screens register only behind
 *    featureFlags.bloodwork (OFF everywhere).
 * 3. The coach consultation view is registered once, unflagged, in the
 *    Clients stack (it reads a production route, backend #607).
 * 4. Screens opened from More that draw no back control of their own get a
 *    native back header, so no wired surface is a dead end.
 * Read as source, like romanFlagOff.test.ts, so React Navigation is not mounted.
 */
import * as fs from 'fs';
import * as path from 'path';

const SRC = path.resolve(__dirname, '..', '..');
const ROOT = path.resolve(SRC, '..');
const read = (...p: string[]) => fs.readFileSync(path.join(SRC, ...p), 'utf8');

const CLIENT_NAV = read('navigation', 'ClientNavigator.tsx');
const COACH_NAV = read('navigation', 'CoachNavigator.tsx');
const EAS = JSON.parse(fs.readFileSync(path.join(ROOT, 'eas.json'), 'utf8')) as {
  build: Record<string, { env?: Record<string, string> }>;
};

/** Directories whose references are not an on-screen entry. */
const NOT_AN_ENTRY = ['navigation', 'tutorial', 'screenshots', '__tests__'];
const NOT_AN_ENTRY_FILES = ['pushTapRouter.ts'];

function onScreenSources(): Array<{ file: string; text: string }> {
  const out: Array<{ file: string; text: string }> = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (NOT_AN_ENTRY.includes(e.name)) continue;
        walk(p);
      } else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name) && !NOT_AN_ENTRY_FILES.includes(e.name)) {
        out.push({ file: p, text: fs.readFileSync(p, 'utf8') });
      }
    }
  };
  walk(SRC);
  return out;
}

/** True when `{featureFlags.<flag> &&` opens a block that still encloses the route. */
function guardedBy(src: string, flag: string, route: string): boolean {
  const routeIdx = src.search(new RegExp(`name=["']${route}["']`));
  if (routeIdx < 0) return false;
  const before = src.slice(Math.max(0, routeIdx - 400), routeIdx);
  const guard = before.lastIndexOf(`{featureFlags.${flag} &&`);
  return guard >= 0 && !before.slice(guard).includes(')}');
}

/** Name of the closest `{featureFlags.<x> &&` block enclosing the route, if any. */
function anyGuard(src: string, route: string): string | null {
  const routeIdx = src.search(new RegExp(`name=["']${route}["']`));
  const before = src.slice(Math.max(0, routeIdx - 400), routeIdx);
  const m = [...before.matchAll(/\{featureFlags\.(\w+) &&/g)].pop();
  if (!m || m.index === undefined) return null;
  return before.slice(m.index).includes(')}') ? null : m[1];
}

describe('launch surfaces have an on-screen entry (S-REACH)', () => {
  const files = onScreenSources();
  const ENTRY = (route: string) => new RegExp(`(navigate\\(\\s*['"]${route}['"]|screen:\\s*['"]${route}['"])`);
  it.each([
    ['ClientDailyMealPlan', 'client meal plan'],
    ['ClientMacros', 'client macro targets'],
    ['Progress', 'client progress'],
    ['Habits', 'client habits and check-in'],
    ['Timeline', 'client timeline'],
    ['ExerciseLibrary', 'exercise library'],
    ['ClientConsultation', 'coach consultation answers'],
  ])('%s (%s) is opened from at least one screen', (route) => {
    const hits = files.filter((f) => ENTRY(route).test(f.text)).map((f) => path.relative(SRC, f.file));
    expect(hits.length).toBeGreaterThan(0);
  });

  it('the scan ignores push-tap routing, the tutorial and the screenshot script', () => {
    const names = files.map((f) => path.relative(SRC, f.file));
    expect(names.some((n) => n.endsWith('pushTapRouter.ts'))).toBe(false);
    expect(names.some((n) => n.startsWith('screenshots'))).toBe(false);
  });
});

describe('hidden surfaces stay behind OFF flags (S-REACH)', () => {
  it('client Bloodwork and coach BloodworkReviewQueue register only behind featureFlags.bloodwork', () => {
    expect(guardedBy(CLIENT_NAV, 'bloodwork', 'Bloodwork')).toBe(true);
    expect(guardedBy(COACH_NAV, 'bloodwork', 'BloodworkReviewQueue')).toBe(true);
  });

  it('no EAS profile turns the lab flag on', () => {
    for (const profile of Object.values(EAS.build)) {
      expect(profile.env?.EXPO_PUBLIC_FEATURE_BLOODWORK).toBeUndefined();
    }
  });

  it('the guard helper rejects an unguarded route', () => {
    expect(guardedBy(CLIENT_NAV, 'bloodwork', 'Progress')).toBe(false);
  });
});

describe('wired screens always show a way back (S-REACH)', () => {
  it.each([
    ['MoreStackNav', 'ClientDailyMealPlan'],
    ['MoreStackNav', 'Progress'],
    ['MoreStackNav', 'Timeline'],
    ['MoreStackNav', 'ClientMacros'],
    ['MoreStackNav', 'Fast'],
    ['HomeStackNav', 'Habits'],
  ])('%s %s registers with the back-only header', (stack, route) => {
    const re = new RegExp(`<${stack}\\.Screen\\s+name="${route}"\\s+(?:component=\\{\\w+\\}\\s+)?options=\\{backOnlyHeader\\(`);
    expect(CLIENT_NAV).toMatch(re);
  });

  it('the back-only header shows the native header with a Back label', () => {
    const fn = CLIENT_NAV.slice(CLIENT_NAV.indexOf('function backOnlyHeader'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    expect(body).toMatch(/headerShown: true/);
    expect(body).toMatch(/headerBackTitle: 'Back'/);
  });

  it('the Workout header opens the exercise library', () => {
    const workout = read('screens', 'client', 'WorkoutScreen.tsx');
    expect(workout).toMatch(/navigate\('ExerciseLibrary'\)[\s\S]{0,300}testID="workout-exercise-library"/);
  });
});

describe('coach consultation view (S-REACH)', () => {
  it('is registered once, in the Clients stack, with no flag', () => {
    expect(COACH_NAV.match(/name=["']ClientConsultation["']/g)).toHaveLength(1);
    expect(anyGuard(COACH_NAV, 'ClientConsultation')).toBeNull();
    const stack = COACH_NAV.slice(COACH_NAV.indexOf('function ClientsStackNavigator'));
    expect(stack.slice(0, stack.indexOf('</ClientsStack.Navigator>'))).toMatch(/name="ClientConsultation"/);
  });
});

describe('the retired Shopping list screen stays cut (SHOPPING-CUT-M, owner 203-D44)', () => {
  // Its own walk, beside onScreenSources: every non-test code file under src, the navigators, tutorial, screenshots
  // and pushTapRouter.ts included, because a route, a push tap or a linking entry is a way in too.
  const CUT_ROOT = SRC;
  const codeSources = (root: string): Array<{ file: string; text: string }> => {
    const out: Array<{ file: string; text: string }> = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name !== '__tests__') walk(p);
        } else if (/\.(ts|tsx|js|jsx|json)$/.test(e.name) && !/\.test\./.test(e.name)) {
          out.push({ file: path.relative(root, p), text: fs.readFileSync(p, 'utf8') });
        }
      }
    };
    walk(root);
    return out;
  };
  const code = codeSources(CUT_ROOT);
  const REGISTERS = (route: string) => new RegExp(`name=["']${route}["']`, 'g');
  const OPENS = (route: string) => new RegExp(`(navigate\\(\\s*['"]${route}['"]|screen:\\s*['"]${route}['"])`);
  const under = (...dirs: string[]) => code.filter((f) => dirs.some((d) => f.file.startsWith(d + path.sep)));

  it('G1: nothing under src/navigation or src/screenshots registers a screen named ShoppingList', () => {
    const hits = under('navigation', 'screenshots').filter((f) => REGISTERS('ShoppingList').test(f.text)).map((f) => f.file);
    expect(hits).toEqual([]);
  });

  it('G2: no non-test code file under src holds the text ShoppingList (no key, target, import or comment)', () => {
    expect(code.filter((f) => f.text.includes('ShoppingList')).map((f) => f.file)).toEqual([]);
  });

  it('G3: src/screens/client/ShoppingListScreen.tsx does not exist', () => {
    expect(fs.existsSync(path.join(SRC, 'screens', 'client', 'ShoppingListScreen.tsx'))).toBe(false);
  });

  it('G4 (control): the same walk finds GroceryList registered once and opened from More and the Prep guide', () => {
    const nav = code.find((f) => f.file === path.join('navigation', 'ClientNavigator.tsx'));
    expect(nav?.text.match(REGISTERS('GroceryList')) ?? []).toHaveLength(1);
    const openers = code.filter((f) => OPENS('GroceryList').test(f.text)).map((f) => f.file);
    expect(openers).toEqual(expect.arrayContaining([
      path.join('screens', 'client', 'MoreScreen.tsx'),
      path.join('screens', 'client', 'PrepGuideScreen.tsx'),
    ]));
  });
});
