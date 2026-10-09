/**
 * QA-EMPTY-131: the shared empty states share one calm look (AUD-FIN-DESIGN-129 U6).
 *
 *  - Base EmptyState (coach Clients, Messages search, client Train): the CTA is a
 *    44 pt forest button with radius.button (12) and an Inter 16 sentence-case label, pressed
 *    through HapticPressable; the body uses the one muted grey.
 *  - components/EmptyState (Recipes, Fasting, Bloodwork, coach Brief, ...): Cormorant
 *    title, theme colours (follows the active scheme), the same CTA.
 *  - EmptyStateNoClients (a new coach's Clients and Messages): Cormorant h2 headline,
 *    sentence-case 44 pt buttons with radius.button (12), an unfilled code box with the theme
 *    hairline, a button label that names where it goes, and the copy haptic through
 *    HapticService so the Haptics switch is honoured.
 */
import React from 'react';
import { StyleSheet, type StyleProp, type TextStyle } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

let mockSemantic = jest.requireActual('../../../theme/tokens').lightTokens;
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({
    colors: jest.requireActual('../../../constants/colors').default,
    semanticColors: mockSemantic,
    tokens: jest.requireActual('../../../theme/tokens').default,
  }),
}));

jest.mock('react-native-svg', () => {
  const ActualReact = jest.requireActual<typeof import('react')>('react');
  const { View: RNView } = jest.requireActual<typeof import('react-native')>('react-native');
  const Stub = ({ children }: { children?: React.ReactNode }) => ActualReact.createElement(RNView, null, children);
  return { __esModule: true, default: Stub, Svg: Stub, Path: Stub, Circle: Stub, Line: Stub, Rect: Stub, G: Stub };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const mockImpact = jest.fn((_style: string) => Promise.resolve());
jest.mock('expo-haptics', () => ({
  impactAsync: (style: string) => mockImpact(style),
  notificationAsync: jest.fn(() => Promise.resolve()),
  selectionAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));
const mockSoftImpact = jest.fn(() => Promise.resolve());
jest.mock('../../haptics/haptics.service', () => ({
  HapticService: { softImpact: () => mockSoftImpact() },
}));

const mockCopy = jest.fn((_code: string) => Promise.resolve(true));
jest.mock('expo-clipboard', () => ({ setStringAsync: (code: string) => mockCopy(code) }));
jest.mock('../../../storage/mmkv', () => ({
  prefsStorage: { getStringAsync: jest.fn(async () => null), set: jest.fn(async () => undefined) },
}));
const mockListInviteCodes = jest.fn();
jest.mock('../../../services/api', () => ({ coachApi: { listInviteCodes: () => mockListInviteCodes() } }));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'coach-1' }) }));

import { EmptyState } from '../EmptyState';
import { EmptyStateNoClients } from '../EmptyStateNoClients';
import { IconChartEmpty } from '../icons';
import LegacyEmptyState from '../../../components/EmptyState';
import Colors from '../../../constants/colors';
import { darkTokens, lightTokens, radius, typography } from '../../../theme/tokens';

type Styled = { props: { style?: StyleProp<TextStyle> } };
const flat = (node: Styled): TextStyle => StyleSheet.flatten(node.props.style) ?? {};

function expectCalmCta(button: Styled, label: Styled) {
  const b = flat(button);
  expect(b.borderRadius).toBe(radius.button);
  expect(b.minHeight).toBeGreaterThanOrEqual(44);
  const l = flat(label);
  expect(l.fontFamily).toBe(typography.bodyMd.fontFamily);
  expect(l.fontSize).toBe(16);
  expect(l.textTransform).toBeUndefined();
  expect(l.letterSpacing ?? 0).toBeLessThanOrEqual(0);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSemantic = lightTokens;
});

describe('base EmptyState', () => {
  it('CTA: 44 pt forest button, radius.button, Inter 16 label, light HapticPressable feedback', async () => {
    const onCta = jest.fn();
    const { getByTestId, getByText } = await render(
      <EmptyState icon={<IconChartEmpty />} headline="No results" body="Nothing matches." ctaLabel="Clear search" onCta={onCta} />,
    );
    expectCalmCta(getByTestId('empty-state-cta'), getByText('Clear search'));
    expect(flat(getByTestId('empty-state-cta')).backgroundColor).toBe(Colors.primary);
    expect(getByTestId('empty-state-cta').props.accessibilityRole).toBe('button');
    await fireEvent.press(getByTestId('empty-state-cta'));
    expect(onCta).toHaveBeenCalledTimes(1);
    // HapticPressable now taps through HapticService (honours the Haptics switch).
    expect(mockSoftImpact).toHaveBeenCalled();
  });

  it('body uses the one muted grey; the headline stays Cormorant h2', async () => {
    const { getByTestId } = await render(<EmptyState icon={<IconChartEmpty />} headline="Empty" body="Some copy." />);
    expect(flat(getByTestId('empty-state-body')).color).toBe(Colors.textMuted);
    expect(flat(getByTestId('empty-state-headline')).fontFamily).toBe(typography.h2.fontFamily);
  });
});

describe('components/EmptyState', () => {
  it('title is Cormorant h3 and every colour follows the theme', async () => {
    mockSemantic = darkTokens;
    const { getByText } = await render(
      <LegacyEmptyState icon="timer-outline" title="No fasting history" subtitle="Start a fast to see it here." />,
    );
    const title = flat(getByText('No fasting history'));
    expect(title.fontFamily).toBe(typography.h3.fontFamily);
    expect(title.fontSize).toBe(typography.h3.fontSize);
    expect(title.color).toBe(darkTokens.textPrimary);
    const subtitle = flat(getByText('Start a fast to see it here.'));
    expect(subtitle.fontFamily).toBe(typography.bodySmall.fontFamily);
    expect(subtitle.color).toBe(darkTokens.textMuted);
  });

  it('CTA matches the base empty state and keeps its handler', async () => {
    const onCta = jest.fn();
    const { getByRole, getByText } = await render(
      <LegacyEmptyState icon="alert-circle-outline" title="Brief not ready" ctaLabel="Try again" onCta={onCta} />,
    );
    const button = getByRole('button', { name: 'Try again' });
    expectCalmCta(button, getByText('Try again'));
    expect(flat(button).backgroundColor).toBe(lightTokens.accent);
    expect(flat(getByText('Try again')).color).toBe(lightTokens.textOnAccent);
    await fireEvent.press(button);
    expect(onCta).toHaveBeenCalledTimes(1);
  });
});

describe('EmptyStateNoClients', () => {
  it('no code yet: sentence-case button that names where it goes, 44 pt, radius.button', async () => {
    mockListInviteCodes.mockResolvedValue({ data: [] });
    const onInvite = jest.fn();
    const { findByTestId, getByText, queryByText } = await render(<EmptyStateNoClients onInvite={onInvite} />);
    const button = await findByTestId('empty-no-clients-settings-btn');
    expect(queryByText('GO TO SETTINGS')).toBeNull();
    expect(queryByText(/Settings/)).toBeNull();
    expect(button.props.accessibilityLabel).toBe('Open invite codes');
    expectCalmCta(button, getByText('Open invite codes'));
    expect(flat(getByText('Your first client is one link away.')).fontSize).toBe(typography.h2.fontSize);
    await fireEvent.press(button);
    expect(onInvite).toHaveBeenCalledTimes(1);
  });

  it('with a code: h2 headline, unfilled code box with the theme hairline, calm Share and 44 pt Copy', async () => {
    mockListInviteCodes.mockResolvedValue({ data: [{ id: 'i1', code: 'GP-TEST' }] });
    const { findByTestId, getByTestId, getByText, queryByText } = await render(<EmptyStateNoClients onInvite={jest.fn()} />);
    const box = flat(await findByTestId('invite-code-block'));
    expect(box.backgroundColor).toBeUndefined();
    expect(box.borderColor).toBe(lightTokens.border);
    expect(box.borderRadius).toBe(radius.input);
    const headline = flat(getByText('Your first client is one link away.'));
    expect(headline.fontFamily).toBe(typography.h2.fontFamily);
    expect(headline.fontSize).toBe(typography.h2.fontSize);
    expect(queryByText('SHARE YOUR CODE')).toBeNull();
    expectCalmCta(getByTestId('share-code-btn'), getByText('Share your code'));
    expect(flat(getByTestId('copy-code-btn')).minHeight).toBeGreaterThanOrEqual(44);
  });

  it('Copy copies the code and taps through HapticService (honours the Haptics switch)', async () => {
    mockListInviteCodes.mockResolvedValue({ data: [{ id: 'i1', code: 'GP-TEST' }] });
    const { findByTestId } = await render(<EmptyStateNoClients onInvite={jest.fn()} />);
    await fireEvent.press(await findByTestId('copy-code-btn'));
    expect(mockCopy).toHaveBeenCalledWith('GP-TEST');
    await waitFor(() => expect(mockSoftImpact).toHaveBeenCalledTimes(1));
    expect(mockImpact).not.toHaveBeenCalled();
  });
});
