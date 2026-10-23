// #168-13 GREY-TEXT fix round 1: the three states the first sweep missed, checked on the rendered tree.
// B1 a disabled Later keeps stone while a save is pending; B2 the recovery label never takes the slate ring
// colour as text; B3 an unavailable cross-pillar tile keeps its words opaque (no ancestor opacity).
import React from 'react';
import { AccessibilityInfo, StyleSheet } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AllergySafetyPrompt from '../../components/AllergySafetyPrompt';
import { RecoveryRingHero } from '../../screens/client/wearables/cards/RecoveryRingHero';
import { RECOVERY_PALETTE, resolveRecoveryState } from '../../screens/client/wearables/recoveryTheme';
import { testColors } from '../../screens/client/wearables/recoveryTestColors';
import { makeAccessibilitySubscription } from '../../screens/client/wearables/testSupport/accessibilityMocks';
import CrossPillarHomeScreen from '../../screens/coach/cross-pillar/CrossPillarHomeScreen';
import { crossPillarApi } from '../../services/api';
import { colors } from '../tokens';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../ThemeProvider', () => ({
  useTheme: () => ({ colors: jest.requireActual('../../constants/colors').default }),
}));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ goBack: jest.fn(), navigate: jest.fn() }) }));
jest.mock('../../services/api', () => ({ crossPillarApi: { getAnalytics: jest.fn(), getClients: jest.fn() } }));

function lum(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const textColor = (node: { props: { style?: unknown } }) => StyleSheet.flatten(node.props.style as never)?.color as string;

beforeEach(() => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue(makeAccessibilitySubscription());
});
afterEach(() => jest.restoreAllMocks());

describe('B1 allergy prompt: Later while a save is pending', () => {
  it('is graphite when live, stone and disabled while the save is pending, graphite again after', async () => {
    let finish: () => void = () => undefined;
    const onSubmit = jest.fn(() => new Promise<void>((done) => { finish = done; }));
    await render(<AllergySafetyPrompt visible onDismiss={jest.fn()} onSubmit={onSubmit} onLater={jest.fn()} />);
    expect(textColor(screen.getByText('Set this up later'))).toBe(colors.graphite);

    await fireEvent.press(screen.getByLabelText('None'));
    await fireEvent.press(screen.getByLabelText('Save restrictions'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith([]));
    expect(textColor(screen.getByText('Set this up later'))).toBe(colors.stone);
    expect(screen.getByLabelText('Set this up later').props.accessibilityState).toMatchObject({ disabled: true });

    await act(async () => finish());
    await waitFor(() => expect(textColor(screen.getByText('Set this up later'))).toBe(colors.graphite));
  });
});

describe('B2 recovery ring: the state label reads at AA in every state', () => {
  it.each([
    [80, 'Recovered'],
    [50, 'Recovering'],
    [20, 'Run-down'],
    [null, 'Recovery'],
  ] as const)('score %s labels "%s" at 4.5:1 or more on bone; a slate ring keeps its slate', async (score, label) => {
    await render(<RecoveryRingHero score={score} colors={testColors} />);
    const node = screen.getByTestId('recovery-state-label');
    expect(node.props.children).toBe(label);
    expect(ratio(textColor(node), colors.bone)).toBeGreaterThanOrEqual(4.5);
    const ring = resolveRecoveryState(score).color(RECOVERY_PALETTE);
    expect(ring).toBe(score === null || score < 34 ? RECOVERY_PALETTE.accentMuted : RECOVERY_PALETTE.accent);
  });
});

describe('B3 cross-pillar overview: the Wealth tile while finance is unavailable', () => {
  it('keeps the label and hint opaque and readable on the screen ground', async () => {
    jest.mocked(crossPillarApi.getAnalytics).mockResolvedValue({
      data: {
        generated_at: '2026-10-23T12:00:00Z',
        identity_mapping: 'email',
        fitness: { client_count: 12, active_client_count_7d: 9 },
        finance: { status: 'unavailable', data: null },
      },
    } as never);
    jest.mocked(crossPillarApi.getClients).mockResolvedValue({
      data: {
        generated_at: '2026-10-23T12:00:00Z',
        identity_mapping: 'email',
        finance: { status: 'unavailable', ok_count: 0, not_found_count: 0, error_count: 0 },
        results: [],
      },
    } as never);
    await render(<CrossPillarHomeScreen />);
    const ground = jest.requireActual('../../constants/colors').default.background as string;
    for (const words of ['WEALTH USERS', 'Backend unavailable']) {
      const node = await screen.findByText(words);
      for (let n: typeof node | null = node; n; n = n.parent) {
        const opacity = StyleSheet.flatten(n.props.style as never)?.opacity;
        expect(opacity === undefined || opacity === 1).toBe(true);
      }
      expect(ratio(textColor(node), ground)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
