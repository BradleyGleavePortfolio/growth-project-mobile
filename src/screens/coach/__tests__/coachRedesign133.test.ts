/**
 * REDO-COACH-133 (QA-COACH-128): the coach chrome and the three coach screens
 * of PR (a) follow the quiet luxury rules with the owner's rounded corners
 * (Q10b, 17:07): outline tab glyphs, 11 pt tab labels on the bone bar with one
 * hairline and a selection haptic, radius from the tokens only, one filled
 * forest action in the builder, and no category-coded tag fills.
 */
import * as fs from 'fs';
import * as path from 'path';

const read = (rel: string) => fs.readFileSync(path.join(__dirname, '..', '..', '..', rel), 'utf8');

const NAV = read('navigation/CoachNavigator.tsx');
const FILES = [
  'screens/coach/ClientsListScreen.tsx',
  'screens/coach/CoachWorkoutBuilderScreen.tsx',
  'screens/coach/programs/ProgramsLibraryScreen.tsx',
];

describe('coach tab bar', () => {
  const tabSection = NAV.slice(NAV.indexOf('<Tab.Navigator'), NAV.indexOf('</Tab.Navigator>'));

  it('uses outline glyphs only (no tab, order or route change)', () => {
    const names = [...tabSection.matchAll(/'([a-z-]+)'|name="([a-z-]+)"/g)]
      .map((m) => m[1] ?? m[2])
      .filter((n) => /outline$|^(people|barbell|document-text|chatbubble|settings|people-circle|grid)$/.test(n));
    expect(names.length).toBeGreaterThanOrEqual(7);
    for (const n of names) expect(n).toMatch(/-outline$/);
    const routes = [...tabSection.matchAll(/name="([A-Za-z]+)"\s*\n\s*component=/g)].map((m) => m[1]);
    expect(routes).toEqual(['CommandCenter', 'ClientsStack', 'Templates', 'Messages', 'TeamStack', 'CommunityStack', 'SettingsStack']);
  });

  it('labels are 11 pt Inter, the bar is bone with one hairline, and a tab press gives a selection haptic', () => {
    expect(tabSection).toMatch(/fontSize:\s*11/);
    expect(tabSection).not.toMatch(/fontSize:\s*10\b/);
    expect(tabSection).not.toMatch(/fontWeight:\s*'600'/);
    expect(tabSection).toMatch(/backgroundColor:\s*sc\.bgPrimary/);
    expect(tabSection).toMatch(/borderTopWidth:\s*StyleSheet\.hairlineWidth/);
    expect(tabSection).toMatch(/tabPress:\s*\(\)\s*=>\s*\{\s*HapticService\.selection\(\);/);
    expect(tabSection).toMatch(/tabBarBadgeStyle:\s*\{\s*backgroundColor:\s*sc\.accent/);
  });
});

describe.each(FILES)('%s', (file) => {
  const code = read(file);
  it('takes every corner radius from the tokens (owner 17:07: rounded, never a literal)', () => {
    // COACH-INSETS-B-134 (U-589-SOL-A-133-1): the avatar circle and the status
    // dot read radius.chip too, so no literal radius is allowed at all.
    expect(code).not.toMatch(/borderRadius:\s*\d/);
  });
  it('has no 13 pt uppercase labels (overlines come from the 11 pt token)', () => {
    expect(code).not.toMatch(/fontSize:\s*13,\s*textTransform:\s*'uppercase'/);
  });
});

describe('workout builder', () => {
  const code = read('screens/coach/CoachWorkoutBuilderScreen.tsx');
  const render = code.slice(code.indexOf('<KeyboardAvoidingView'), code.indexOf('function NumberField('));
  it('has one filled forest action (PrimaryButton) and a back chevron under the status bar', () => {
    expect(render.match(/<PrimaryButton/g)).toHaveLength(1);
    expect(render).toMatch(/<ScreenTopBar onBack=\{\(\) => navigation\.goBack\(\)\}/);
    expect(render).toMatch(/paddingTop: insets\.top \+ layout\.statusBarGap/);
  });
  it('every control shows a pressed state (HapticPressable, or a pressed style where the handler already gives a haptic)', () => {
    expect(render.match(/<Pressable\b/g)).toHaveLength(2);
    expect(render.match(/style=\{\(\{ pressed \}\) => \[/g)).toHaveLength(2);
    expect((render.match(/<HapticPressable/g) ?? []).length).toBeGreaterThanOrEqual(11);
  });
});

describe('programs library', () => {
  const code = read('screens/coach/programs/ProgramsLibraryScreen.tsx');
  it('cards are rounded hairlines with no fill and tags are text, not tinted chips', () => {
    expect(code).not.toMatch(/backgroundColor:\s*colors\.(surface|primaryPale)/);
    expect(code).toMatch(/borderRadius:\s*radius\.card/);
    expect(code).toMatch(/title:\s*\{\s*\.\.\.typography\.h1\s*\}/);
  });
});
