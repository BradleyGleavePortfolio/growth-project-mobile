// FR-863R5 (HOME-WINS-FADE, GOAL HOME3 Style A): the parts shared components draw on the coach Home are Style A's white
// cards: the setup checklist on the hero (white, done bar, tick circles, chevrons), the push ask (a card with a filled
// Turn on) and today's brief. The old Overview ('all') keeps its hairline looks. Section labels and small grey lines on
// light grounds are graphite #2C2C2C (owner #168-13, m#875); a screen reader hears the open alerts row's second line.
// FR-863R6: the open tick circle is A's `.ck` #8A988E, the chevrons on white are `.mut` #4F5D54, the brief's text column
// has no gap, the Clients rows are `.lrow` / `.lt` / `.ls` / `.lv`, and the section labels sit 22 above and 8 below.
import React from 'react';
import { StyleSheet, Text, type TextStyle, type ViewStyle } from 'react-native';
import { render, within } from '@testing-library/react-native';
import CoachHomeCards from '../screens/coach/command-center/CoachHomeCards';
import { AlertsRow, LinkRow, useCardStyles } from '../screens/coach/home-v11/HomeParts';

jest.mock('@expo/vector-icons', () => {
  const R = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  const Icon = ({ name, color }: { name: string; color?: string }) => R.createElement(View, { testID: `icon-${name}`, iconColor: color } as import('react-native').ViewProps);
  return { Ionicons: Icon, MaterialIcons: Icon, MaterialCommunityIcons: Icon, Feather: Icon };
});

jest.mock('@react-navigation/native', () => {
  const R = jest.requireActual<typeof import('react')>('react');
  return {
    ...jest.requireActual('@react-navigation/native'),
    useNavigation: () => ({ navigate: jest.fn() }),
    useFocusEffect: (cb: () => void) => R.useEffect(() => cb(), [cb]),
  };
});
jest.mock('expo-notifications', () => ({ getPermissionsAsync: async () => ({ status: 'undetermined', canAskAgain: true }) }));
jest.mock('../services/pushNotifications', () => ({ registerForPushNotifications: jest.fn() }));
jest.mock('../storage/mmkv', () => ({
  ...jest.requireActual('../storage/mmkv'),
  prefsStorage: { getStringAsync: async () => undefined, set: async () => undefined },
}));
jest.mock('../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'coach-1', role: 'coach', firstName: 'Sarah' }) }));
jest.mock('../navigation/coachLanding', () => ({ ...jest.requireActual('../navigation/coachLanding'), coachLandingTab: () => 'CommandCenter' }));
jest.mock('../config/featureFlags', () => {
  const actual = jest.requireActual('../config/featureFlags');
  return { ...actual, featureFlags: { ...actual.featureFlags, coachBrief: true } };
});
jest.mock('../lib/coachSetup/setupStatus', () => ({
  ...jest.requireActual('../lib/coachSetup/setupStatus'),
  loadSetupStatus: async () => ({ connect: { state: 'none', actionRequired: false }, livePackageTitle: 'Strong 12', hasClient: true, paid: false, sharedLink: true, errors: [] }),
}));

const flat = (node: { props: { style?: unknown } }): ViewStyle & TextStyle => StyleSheet.flatten(node.props.style as ViewStyle) ?? {};
const WHITE_CARD = { backgroundColor: '#FFFFFF', borderColor: '#DCE3DB', borderWidth: 0.5, borderRadius: 16 };

describe('Style A white cards on the coach Home (FR-863R5)', () => {
  it('draws the setup checklist as the white GOAL card: count beside the title, a done bar, tick circles, chevrons', async () => {
    const v = await render(<CoachHomeCards part="setup" />);
    const card = await v.findByTestId('coach-setup-checklist');
    expect(flat(card)).toMatchObject(WHITE_CARD);
    expect(flat(card).backgroundColor).not.toBe('#F2EDE4');
    const title = within(card).getByText('Finish setting up');
    expect(flat(title)).toMatchObject({ fontFamily: 'Inter_600SemiBold', fontSize: 16, color: '#142019' });
    expect(flat(within(card).getByText('2 of 4 done'))).toMatchObject({ color: '#2C2C2C' });
    expect(flat(within(card).getByTestId('coach-setup-checklist-bar-fill'))).toMatchObject({ width: '50%' });
    const row = within(card).getByTestId('coach-setup-checklist-package');
    expect(flat(row)).toMatchObject({ minHeight: 50, borderTopWidth: 0.5 });
    expect(within(row).getByText('Your package is live.')).toBeTruthy();
    expect(row.props.accessibilityLabel).toBe('Create your first package. Done. Your package is live.');
  });

  it('draws the push ask and the brief as white cards, the ask with a filled Turn on and a Not now link', async () => {
    const v = await render(<CoachHomeCards part="below" />);
    const push = await v.findByTestId('push-permission-card');
    expect(flat(push)).toMatchObject(WHITE_CARD);
    expect(within(push).queryByText('STAY IN TOUCH')).toBeNull();
    const turnOn = within(push).getByTestId('push-permission-enable');
    expect(flat(turnOn)).toMatchObject({ minHeight: 48, borderRadius: 12, backgroundColor: '#2C4A36' });
    expect(flat(within(turnOn).getByText('Turn on'))).toMatchObject({ color: '#FFFFFF' });
    expect(within(push).getByTestId('push-permission-dismiss').props.accessibilityLabel).toBe('Not now');
    const brief = v.getByTestId('coach-home-brief-card');
    expect(flat(brief)).toMatchObject(WHITE_CARD);
    expect(flat(within(brief).getByText("Today's brief"))).toMatchObject({ fontFamily: 'Inter_600SemiBold', fontSize: 16 });
  });

  it('keeps the old Overview checklist in its hairline card', async () => {
    const v = await render(<CoachHomeCards />);
    const card = await v.findByTestId('coach-setup-checklist');
    expect(flat(card).backgroundColor).not.toBe('#FFFFFF');
    expect(v.queryByTestId('coach-setup-checklist-bar')).toBeNull();
  });

  it("draws the open tick circle in A's #8A988E and the chevrons on white in #4F5D54 (FR-863R6, Opus B2, Sol B2)", async () => {
    const v = await render(<CoachHomeCards part="setup" />);
    const card = await v.findByTestId('coach-setup-checklist');
    expect(flat(within(card).getByTestId('coach-setup-checklist-get_paid-tick'))).toMatchObject({ width: 22, height: 22, borderWidth: 1.5, borderColor: '#8A988E' });
    expect(flat(within(card).getByTestId('coach-setup-checklist-package-tick')).borderColor).not.toBe('#8A988E');
    const chevrons = within(card).getAllByTestId('icon-chevron-forward');
    expect(chevrons.map((c) => c.props.iconColor)).toEqual(chevrons.map(() => '#4F5D54'));
  });

  it("sets the brief's title and line with no gap between them (FR-863R6, Sol B2)", async () => {
    const v = await render(<CoachHomeCards part="below" />);
    const brief = await v.findByTestId('coach-home-brief-card');
    expect(flat(within(brief).getByTestId('coach-home-brief-text'))).toEqual({ flex: 1 });
    expect(within(brief).getByTestId('icon-chevron-forward').props.iconColor).toBe('#4F5D54');
  });

  it("draws a Clients row as A's `.lrow`: 56 high, 8 and 16 inside, 15/20 title, 13/18 graphite line, 18/22 forest count (FR-863R6)", async () => {
    const v = await render(
      <>
        <LinkRow first title="All 30 clients" line="Open Clients" onPress={() => undefined} testID="row-all" />
        <LinkRow title="Streaks" count={9} onPress={() => undefined} testID="row-streaks" />
      </>,
    );
    const all = v.getByTestId('row-all');
    expect(flat(all)).toMatchObject({ minHeight: 56, paddingVertical: 8, paddingHorizontal: 16, gap: 12 });
    expect(flat(all).borderTopWidth).toBeUndefined();
    expect(flat(v.getByTestId('row-streaks'))).toMatchObject({ borderTopWidth: 0.5, borderTopColor: '#DCE3DB' });
    expect(flat(within(all).getByText('All 30 clients'))).toMatchObject({ fontFamily: 'Inter_500Medium', fontSize: 15, lineHeight: 20, color: '#142019' });
    expect(flat(within(all).getByText('Open Clients'))).toMatchObject({ fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18, color: '#2C2C2C' });
    expect(flat(within(v.getByTestId('row-streaks')).getByText('9'))).toMatchObject({ fontFamily: 'Inter_600SemiBold', fontSize: 18, lineHeight: 22, color: '#2C4A36' });
    expect(v.getAllByTestId('icon-chevron-forward').map((c) => c.props.iconColor)).toEqual(['#4F5D54', '#4F5D54']);
  });

  it('colours the section labels graphite #2C2C2C on the light page (owner #168-13)', async () => {
    function Labels() {
      const cs = useCardStyles();
      return <Text style={cs.section} testID="label">BUSINESS</Text>;
    }
    const v = await render(<Labels />);
    expect(flat(v.getByTestId('label')).color).toBe('#2C2C2C');
    // A `.sec` margin 22px 0 8px: the page's gap of 10 plus 12 above, 8 below (FR-863R6, Sol B2).
    expect(flat(v.getByTestId('label'))).toMatchObject({ marginTop: 12, marginBottom: 8 });
  });

  it('says the open row\u2019s second line to a screen reader, and only when it shows', async () => {
    const open = await render(<AlertsRow count={3} onPress={() => undefined} />);
    expect(open.getByTestId('home-alerts').props.accessibilityLabel).toBe('Open alerts, 3, Waiting in Actions');
    expect(open.getByTestId('home-alerts-waiting')).toBeTruthy();
    const calm = await render(<AlertsRow count={0} onPress={() => undefined} />);
    expect(calm.getByTestId('home-alerts').props.accessibilityLabel).toBe('Open alerts, 0');
    expect(calm.queryByTestId('home-alerts-waiting')).toBeNull();
  });
});
