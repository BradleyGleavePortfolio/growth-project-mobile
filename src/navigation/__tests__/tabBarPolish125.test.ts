import * as fs from 'fs';
import * as path from 'path';

const src = (name: string) => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');

describe('primary tab-bar appearance and safe-area contracts', () => {
  const client = src('ClientNavigator.tsx');
  const coach = src('CoachNavigator.tsx');

  it('uses semantic tokens for client tab foreground, surface and border', () => {
    expect(client).toMatch(/semanticColors:\s*sc/);
    expect(client).toMatch(/tabBarActiveTintColor:\s*sc\.textPrimary/);
    expect(client).toMatch(/tabBarInactiveTintColor:\s*sc\.textMuted/);
    expect(client).toMatch(/backgroundColor:\s*sc\.bgPrimary/);
    expect(client).toMatch(/borderTopColor:\s*sc\.border/);
  });

  it('uses readable semantic foregrounds for coach tabs in both appearances', () => {
    expect(coach).toMatch(/semanticColors:\s*sc/);
    expect(coach).toMatch(/tabBarActiveTintColor:\s*sc\.accentText/);
    expect(coach).toMatch(/tabBarInactiveTintColor:\s*sc\.textMuted/);
    expect(coach).toMatch(/backgroundColor:\s*sc\.bgSurface/);
    expect(coach).toMatch(/borderTopColor:\s*sc\.border/);
  });

  it('preserves client icon space above the bottom inset', () => {
    expect(client).toMatch(/const insets = useSafeAreaInsets\(\)/);
    expect(client).toMatch(/height:\s*64\s*\+\s*insets\.bottom/);
  });

  it('preserves coach label/icon space and padding above the home indicator', () => {
    expect(coach).toMatch(/const insets = useSafeAreaInsets\(\)/);
    expect(coach).toMatch(/height:\s*60\s*\+\s*insets\.bottom/);
    expect(coach).toMatch(/paddingBottom:\s*4\s*\+\s*insets\.bottom/);
  });
});
