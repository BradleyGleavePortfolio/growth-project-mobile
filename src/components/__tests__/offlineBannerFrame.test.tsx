/**
 * FIX-974R1 (LS-974R1 B3): the offline band as C1 Style C v2 C2_offline_* draws it (measured on C2_offline_ios390_100,
 * 2x): the app's Inter Medium at 14 on an 18 line, a 12 pt cloud icon 6 pt from the words, the 24 pt screen gutter.
 * At those sizes C1-S-10 takes the frame's two lines at 390 pt, where main's system font, 16 pt icon and 24 pt
 * padding took three.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import { layout, typography } from '../../theme/tokens';

jest.mock('../../hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => ({ isConnected: false, isInternetReachable: false }),
  isEffectivelyOnline: () => false,
}));
jest.mock('../../lib/userCache', () => ({ readUserCacheSync: () => ({ role: 'client' }) }));
const mockIcon = jest.fn();
jest.mock('@expo/vector-icons', () => ({ Ionicons: (props: Record<string, unknown>) => { mockIcon(props); return null; } }));

import OfflineBanner from '../OfflineBanner';

const C1_S_10 = 'You are offline. Workouts and food logs are saved on this phone and sync when you reconnect.';
type HostNode = { props: Record<string, unknown>; parent: HostNode | null };

it('the words: Inter Medium 14 on an 18 line, no system weight', async () => {
  const view = await render(<OfflineBanner />);
  const text = StyleSheet.flatten(view.getByText(C1_S_10).props.style);
  expect(typography.bodyMd.fontFamily).toBe('Inter_500Medium');
  expect(text).toMatchObject({ fontFamily: typography.bodyMd.fontFamily, fontSize: 14, lineHeight: 18 });
  expect(text.fontWeight).toBeUndefined();
});

it('the icon: 12 pt, 6 pt from the words; the band keeps the 24 pt gutter', async () => {
  const view = await render(<OfflineBanner />);
  expect(mockIcon).toHaveBeenCalled();
  expect(mockIcon.mock.calls[mockIcon.mock.calls.length - 1][0]).toMatchObject({ name: 'cloud-offline-outline', size: 12 });
  let band = view.getByText(C1_S_10) as unknown as HostNode | null;
  while (band && band.props.accessibilityRole !== 'alert') band = band.parent;
  const style = StyleSheet.flatten(band?.props.style as never) as Record<string, unknown>;
  expect(style).toMatchObject({ paddingHorizontal: layout.gutter, gap: 6 });
  expect(layout.gutter).toBe(24);
});
