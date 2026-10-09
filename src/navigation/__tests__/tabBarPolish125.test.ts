import * as fs from 'fs';
import * as path from 'path';

const src = (name: string) => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');

describe('primary tab-bar appearance and safe-area contracts', () => {
  it.each([
    ['ClientNavigator.tsx', 'forest', 'bgPrimary', 64],
    ['CoachNavigator.tsx', 'accentText', 'bgPrimary', 60],
  ] as const)('%s uses readable tokens and preserves content above the safe inset', (name, active, bg, height) => {
    const nav = src(name);
    expect(nav).toMatch(/semanticColors:\s*sc/);
    expect(nav).toMatch(new RegExp(`tabBarActiveTintColor:\\s*${name === 'ClientNavigator.tsx' ? 'colors' : 'sc'}\\.${active}`));
    expect(nav).toMatch(/tabBarInactiveTintColor:\s*sc\.textMuted/);
    expect(nav).toMatch(new RegExp(`backgroundColor:\\s*sc\\.${bg}`));
    expect(nav).toMatch(/borderTopColor:\s*sc\.border/);
    expect(nav).toMatch(/const insets = useSafeAreaInsets\(\)/);
    expect(nav).toMatch(new RegExp(`height:\\s*${height}\\s*\\+\\s*insets\\.bottom`));
    if (name === 'CoachNavigator.tsx') expect(nav).toMatch(/paddingBottom:\s*4\s*\+\s*insets\.bottom/);
  });
});
