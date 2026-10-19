/**
 * COACHTABS (agent 153): small gaps closed on the six coach tabs, behind
 * featureFlags.coachTabsV2 where they change a route. Read from source, as
 * coachTabsV2Entries.test.tsx does for the other entries; coachTabsV2.test.tsx
 * proves MoneyStack / CoachMoney lands in the real navigator.
 */
import * as fs from 'fs';
import * as path from 'path';

const read = (rel: string) => fs.readFileSync(path.join(__dirname, '..', '..', '..', rel), 'utf8');

describe('Money opens the Money tab, not a copy inside Settings (flag on)', () => {
  it.each([
    ['Brief Money action', 'screens/coach/brief/briefActions.ts', /featureFlags\.coachTabsV2\s*\?\s*\{ tab: 'MoneyStack', params: \{ screen: 'CoachMoney', pop: true \} \}\s*:\s*\{ tab: 'SettingsStack', params: \{ screen: 'CoachMoney', initial: false \} \}/],
    ['Team profile Open Money', 'screens/coach/CoachTeamProfileScreen.tsx', /featureFlags\.coachTabsV2\s*\?\s*navigation\.navigate\('MoneyStack', \{ screen: 'CoachMoney', pop: true \}\)\s*:\s*navigation\.navigate\('CoachMoney'\)/],
    ['Package edit Open Money', 'screens/coach/payments/CoachPackageEditScreen.tsx', /featureFlags\.coachTabsV2\s*\?\s*navigation\.navigate\("MoneyStack", \{ screen: "CoachMoney", pop: true \}\)\s*:\s*navigation\.navigate\("CoachMoney"\)/],
  ])('%s', (_name, file, wire) => {
    expect(read(file)).toMatch(wire);
  });
});

it('the Calendar tab root names itself instead of an empty header band', () => {
  const nav = read('navigation/CoachNavigator.tsx');
  const inbox = nav.slice(nav.indexOf('function CalendarStackNavigator'));
  expect(inbox).toMatch(/name="CoachBookingInbox"\s*component=\{CoachBookingInboxScreen\}\s*options=\{\(\{ navigation \}\) => \(\{[\s\S]{0,120}headerTitle: 'Calendar',\s*headerTitleAlign: 'left',/);
  expect(nav).toMatch(/calendarTitle: \{ fontFamily: 'CormorantGaramond_400Regular', fontSize: 28 \}/);
});

describe('owner radius scale (12 / 16 / 24) on the Calendar and Messages tab screens', () => {
  it.each([
    'screens/coach/broadcasts/BroadcastsEntry.tsx',
    'screens/coach/CommunityReportsEntry.tsx',
    'screens/coach/CoachBookingInboxScreen.tsx',
    'screens/coach/CoachAvailabilityEditorScreen.tsx',
    'screens/coach/CoachBookingOptionsScreen.tsx',
    'screens/coach/CoachAppointmentTypesScreen.tsx',
    'screens/coach/CoachTimeOffScreen.tsx',
  ])('%s has no off-scale literal radius', (file) => {
    const literals = read(file).match(/borderRadius:\s*\d+/g) ?? [];
    // Allowed: the 20 pt round count badge (10) and literal 12 (= radius.button).
    for (const l of literals) expect(['borderRadius: 10', 'borderRadius: 12']).toContain(l.replace(/\s+/g, ' '));
    if (file.endsWith('CommunityReportsEntry.tsx')) {
      expect(read(file)).toMatch(/minWidth: 20,\s*height: 20,\s*borderRadius: 10,/);
    } else {
      expect(literals).not.toContain('borderRadius: 10');
    }
  });
});

it('Availability steppers carry hitSlop 4 (effective 44 pt not proven here); the Clients filters are 44 wide', () => {
  const avail = read('screens/coach/CoachAvailabilityEditorScreen.tsx');
  expect(avail.match(/hitSlop=\{4\}\n\s*style=\{\[styles\.stepBtn,/g)).toHaveLength(4);
  expect(avail).toMatch(/stepBtn: \{[^}]*width: 36,\s*height: 36,/);
  expect(avail).toMatch(/windowRow: \{\s*flexDirection: 'row',[^}]*flexWrap: 'wrap',/);
  expect(read('screens/coach/ClientsListScreen.tsx')).toMatch(/filterChip: \{\s*paddingHorizontal: 8,\s*minHeight: 44,\s*minWidth: 44,/);
});

it('44 pt targets: the Clients-stack bell (Broadcasts, Reports and other pushed screens) and the Money filter chips', () => {
  expect(read('navigation/CoachNavigator.tsx')).toMatch(/bellButton: \{[^}]*marginRight: 12,\s*minWidth: 44,\s*minHeight: 44,/);
  expect(read('screens/coach/money/MoneyScreen.tsx')).toMatch(/chip: \{\s*minHeight: 44,\s*minWidth: 44,/);
});
