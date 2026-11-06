/**
 * B-TEST LO-927 B1 (m#927 @ edc0bf0d): the C2 Style C masthead runs to the top edge.
 *
 * Every C2 Style C frame (planning/MOCKUP3/C2/style-c/C_day, C_week, ...) and the
 * owner's Style C reference start the forest masthead under the status bar, with the
 * back control on the forest. The meal plan, macros and fasting routes still take the
 * bone native header (backOnlyHeader() with one argument paints colors.bone), so a
 * bone strip with a dark chevron sits above the forest masthead on every phone.
 *
 * Passes when each of the three routes either hides the native header (the screen
 * draws its own back on the masthead) or asks backOnlyHeader for the masthead ground.
 */
import * as fs from 'fs';
import * as path from 'path';

const NAV = fs.readFileSync(path.join(__dirname, '..', 'ClientNavigator.tsx'), 'utf8');

function optionsFor(route: string): string {
  const m = NAV.match(new RegExp(`<MoreStackNav\\.Screen\\s+name="${route}"[^>]*?options=\\{([^}]*\\}?)\\}`));
  if (!m) throw new Error(`route ${route} not found in ClientNavigator.tsx`);
  return m[1].trim();
}

const paintsBone = (opts: string): boolean => {
  if (/headerShown:\s*false/.test(opts)) return false;
  const call = opts.match(/^backOnlyHeader\(([^)]*)\)$/);
  if (!call) return false; // some other options object: judged by its own test
  const args = call[1].split(',').map((a) => a.trim()).filter(Boolean);
  return args.length < 2 || args[1] === 'false';
};

describe('LO-927 B1: C2 Style C screens start on the forest masthead, not a bone header', () => {
  it.each([
    ['Fast', 'FastingScreen'],
    ['ClientMacros', 'ClientMacrosScreen'],
    ['ClientDailyMealPlan', 'ClientDailyMealPlanScreen'],
  ])('route %s (%s) does not paint the bone native header above the forest masthead', (route) => {
    expect(paintsBone(optionsFor(route))).toBe(false);
  });
});
