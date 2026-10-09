/**
 * DS-PRIMITIVES-133: the shared client primitives, rendered at 360 x 800
 * (Android, edge-to-edge insets) and 390 x 844 (iPhone with a notch).
 */
import React from 'react';
import { StyleSheet, Text, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockImpact = jest.fn((_s: string) => Promise.resolve());
jest.mock('expo-haptics', () => ({
  impactAsync: (s: string) => mockImpact(s),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

import {
  AccentRule,
  Headline,
  Lede,
  Overline,
  PrimaryButton,
  Screen,
  ScreenTopBar,
  TextLink,
} from '..';
import { layout, lightTokens, radius, SERIF_MIN_LINE_RATIO } from '../../theme/tokens';

type Flat = ViewStyle & TextStyle;
const flat = (node: { props: { style?: unknown } }): Flat =>
  (StyleSheet.flatten(node.props.style as StyleProp<Flat>) ?? {}) as Flat;

const DEVICES = [
  { name: 'Android 360x800', frame: { x: 0, y: 0, width: 360, height: 800 }, insets: { top: 24, bottom: 24, left: 0, right: 0 } },
  { name: 'iPhone 390x844', frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, bottom: 34, left: 0, right: 0 } },
] as const;

function AuthLike() {
  return (
    <Screen
      testID="s"
      scroll={false}
      centerContent
      footer={
        <>
          <PrimaryButton label="Get started" onPress={jest.fn()} testID="cta" />
          <TextLink label="Log in" onPress={jest.fn()} testID="link" />
        </>
      }
    >
      <Overline>Personal training, in your pocket</Overline>
      <Headline level="display">The Growth Project</Headline>
      <AccentRule />
      <Lede>A plan, daily targets, and a coach who knows you.</Lede>
    </Screen>
  );
}

beforeEach(() => {
  mockImpact.mockClear();
});

describe.each(DEVICES)('Screen at $name', ({ frame, insets }) => {
  const wrap = (ui: React.ReactElement) => <SafeAreaProvider initialMetrics={{ frame, insets }}>{ui}</SafeAreaProvider>;

  it('clears the status bar with breathing room and the gesture bar under the footer', async () => {
    const r = await render(wrap(<AuthLike />));
    expect(flat(r.getByTestId('s')).paddingTop).toBe(insets.top + layout.statusBarGap);
    expect(flat(r.getByTestId('s-footer')).paddingBottom).toBe(
      Math.max(insets.bottom, layout.footerBottomMin) + layout.footerBottomGap,
    );
    expect(flat(r.getByTestId('s-scroll')).paddingHorizontal).toBe(layout.gutter);
    // The one filled button spans the gutter-to-gutter width at both sizes.
    expect(flat(r.getByTestId('cta'))).toMatchObject({ alignSelf: 'stretch', minHeight: layout.buttonHeight });
    expect(r.getAllByRole('button').filter((b) => flat(b).backgroundColor === lightTokens.accent)).toHaveLength(1);
  });

  it('a tab root owns only the top edge', async () => {
    const r = await render(wrap(<Screen testID="t" edges={['top']}><Text>Home</Text></Screen>));
    expect(flat(r.getByTestId('t')).paddingTop).toBe(insets.top + layout.statusBarGap);
    expect(StyleSheet.flatten(r.getByTestId('t-scroll').props.contentContainerStyle).paddingBottom).toBe(layout.gutter);
  });
});

describe('Screen without a provider', () => {
  it('uses zero insets (no double padding under a parent safe area)', async () => {
    const r = await render(<Screen testID="z" edges={[]}><ScreenTopBar onBack={jest.fn()} testID="bar" /></Screen>);
    expect(flat(r.getByTestId('z')).paddingTop).toBe(0);
    expect(r.getByTestId('bar-back').props.accessibilityLabel).toBe('Back');
  });
});

describe('PrimaryButton', () => {
  it('forest fill, bone label, 54 pt, soft corners, light haptic', async () => {
    const onPress = jest.fn();
    const r = await render(<PrimaryButton label="Continue" onPress={onPress} testID="b" />);
    const style = flat(r.getByTestId('b'));
    expect(style).toMatchObject({ backgroundColor: lightTokens.accent, minHeight: 54, borderRadius: radius.button });
    expect(radius.button).toBeGreaterThanOrEqual(12);
    expect(flat(r.getByText('Continue')).color).toBe(lightTokens.textOnAccent);
    fireEvent.press(r.getByTestId('b'));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(mockImpact).toHaveBeenCalledWith('light');
  });

  it('disabled uses the disabled tokens and ignores presses', async () => {
    const onPress = jest.fn();
    const r = await render(<PrimaryButton label="Continue" onPress={onPress} disabled testID="b" />);
    expect(flat(r.getByTestId('b')).backgroundColor).toBe(lightTokens.disabledBg);
    expect(flat(r.getByText('Continue')).color).toBe(lightTokens.textOnDisabled);
    fireEvent.press(r.getByTestId('b'));
    expect(onPress).not.toHaveBeenCalled();
    expect(r.getByTestId('b').props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('loading shows a spinner, is busy and ignores presses', async () => {
    const onPress = jest.fn();
    const r = await render(<PrimaryButton label="Saving" onPress={onPress} loading testID="b" />);
    expect(r.getByTestId('b-spinner')).toBeTruthy();
    expect(r.getByTestId('b').props.accessibilityState).toMatchObject({ busy: true, disabled: true });
    expect(r.getByTestId('b').props.accessibilityLabel).toBe('Saving');
    fireEvent.press(r.getByTestId('b'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('a fuller screen-reader label never changes the visible word', async () => {
    const r = await render(<PrimaryButton label="Save" accessibilityLabel="Save weight log entry" onPress={jest.fn()} testID="b" />);
    expect(r.getByTestId('b').props.accessibilityLabel).toBe('Save weight log entry');
    expect(r.getByText('Save')).toBeTruthy();
    expect(r.queryByText('Save weight log entry')).toBeNull();
  });
});

describe('TextLink', () => {
  it('quiet, underlined, 44 pt target, no fill', async () => {
    const onPress = jest.fn();
    const r = await render(<TextLink label="Log in" onPress={onPress} testID="l" />);
    const box = flat(r.getByTestId('l'));
    expect(box.minHeight).toBe(44);
    expect(box.backgroundColor).toBeUndefined();
    expect(flat(r.getByText('Log in'))).toMatchObject({ color: lightTokens.textMuted, textDecorationLine: 'underline' });
    fireEvent.press(r.getByTestId('l'));
    expect(onPress).toHaveBeenCalled();
  });
});

describe('Headline', () => {
  it.each(['display', 'h1', 'h2', 'h3'] as const)('%s is a serif header that keeps its descenders', async (level) => {
    const r = await render(<Headline level={level} testID="h">Your height and weight</Headline>);
    const t = flat(r.getByTestId('h'));
    expect(r.getByTestId('h').props.accessibilityRole).toBe('header');
    expect(String(t.fontFamily)).toMatch(/^CormorantGaramond/);
    expect(t.lineHeight).toBeGreaterThanOrEqual(SERIF_MIN_LINE_RATIO * Number(t.fontSize));
  });
});
