/**
 * REDO-COACH-133 (c), QA-COACH-SET-129 visual pass. U5 ("—" while the client
 * count loads or fails) and U9 (Notification preferences opens through
 * ClientsStack) were already fixed on main by COACH-SETTINGS-131 and stay
 * covered by SettingsScreen.coachSettings131.test.tsx. This file holds the
 * look: serif title under the real status bar, 11 pt overlines, rounded
 * hairline groups with no cream fills (owner 17:07), token radii, text of
 * 13 pt or more, sentence case, and a sign out that is not an alarm.
 */
import * as fs from 'fs';
import * as path from 'path';

const dir = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(dir, rel), 'utf8');
const SCREEN = read('SettingsScreen.tsx');
const STYLES = read('settings/styles.ts');
const PARTS = ['ProfileSection.tsx', 'DangerZone.tsx', 'SettingsToggles.tsx', 'BillingSection.tsx'].map((f) => read(`settings/${f}`));
const ALL = [SCREEN, ...PARTS];

const block = (name: string) => STYLES.match(new RegExp(`\\n  ${name}: \\{([\\s\\S]*?)\\n  \\},`))?.[1] ?? '';

describe('coach Settings look', () => {
  it('serif Headline title with the top inset, no fixed 60 pt top', () => {
    expect(SCREEN).toMatch(/<Headline level="h1">Settings<\/Headline>/);
    expect(SCREEN).toMatch(/paddingTop: insets\.top \+ layout\.statusBarGap \+ 12/);
    expect(STYLES).not.toMatch(/paddingTop:\s*60/);
  });

  it('every section opens with the shared 11 pt Overline', () => {
    for (const code of ALL) expect(code).not.toMatch(/<Text style=\{styles\.sectionHeader\}>/);
    expect((SCREEN.match(/<Overline style=\{styles\.sectionHeader\}>/g) ?? []).length).toBeGreaterThanOrEqual(8);
  });

  it('groups are rounded hairlines with no fill; radii come from the tokens', () => {
    const section = block('section');
    expect(section).toMatch(/borderRadius: radius\.card/);
    expect(section).toMatch(/borderWidth: StyleSheet\.hairlineWidth/);
    expect(section).not.toMatch(/backgroundColor/);
    expect(block('profileCard')).not.toMatch(/backgroundColor/);
    const literals = [...STYLES.matchAll(/borderRadius:\s*(\d+)/g)].map((m) => Number(m[1]));
    expect(literals).toEqual([28]); // the avatar circle only
  });

  it('text is 13 pt or more (11 pt only through the eyebrow token)', () => {
    for (const m of STYLES.matchAll(/fontSize:\s*(\d+)/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(13);
  });

  it('sign out is a quiet outlined action, not red', () => {
    expect(block('signOutButton')).not.toMatch(/colors\.error/);
    expect(block('signOutText')).not.toMatch(/colors\.error/);
    expect(read('settings/DangerZone.tsx')).toMatch(/>Sign out</);
    expect(SCREEN).toContain("Alert.alert('Sign out'");
    expect(SCREEN).not.toContain("'Sign Out'");
  });

  it('visible labels are sentence case', () => {
    for (const code of ALL) {
      for (const title of ['Client Management', 'Active Clients', 'Coach Tools', 'Workout Builder', 'Booking Inbox', 'App Preferences',
        'Privacy & Data', 'Sign Out', 'Change Password', 'Edit Bio', 'Blocked Users', 'Invite Codes', 'Time Off', 'Appointment Types']) {
        expect(code).not.toContain(`>${title}<`);
      }
    }
  });
});
