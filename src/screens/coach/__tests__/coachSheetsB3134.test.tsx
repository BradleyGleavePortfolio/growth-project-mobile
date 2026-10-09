// COACH-INSETS-B3-134 (agent 134; B16 B29): the package-content sheets take their
// corners from the rounded tokens (bottom sheet 24, buttons 12, fields 12), the
// Subscribers line leaves a missing date out instead of printing a dash, and the
// Templates cards carry no emoji-style glyph tile.
import React from 'react';
import * as fs from 'fs';
import * as path from 'path';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { radius, spacing } from '../../../theme/tokens';
import { PushPromptSheet } from '../payments/contents/PushPromptSheet';
import CoachPackageSubscribersScreen from '../payments/CoachPackageSubscribersScreen';
import ProgramTemplatesScreen from '../ProgramTemplatesScreen';

const mockSubscribers = jest.fn();
jest.mock('../../../api/packagesApi', () => ({
  coachPackagesApi: { subscribers: (...a: unknown[]) => mockSubscribers(...a) },
}));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../utils/haptics', () => ({
  lightTap: jest.fn(), mediumTap: jest.fn(), successTap: jest.fn(), warningTap: jest.fn(),
}));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'coach-1' }) }));
jest.mock('../../../store/coachStore', () => ({
  useCoachStore: () => ({ clients: [], loadClients: jest.fn() }),
}));
jest.mock('../../../hooks/useApi', () => ({
  usePostClientGuidelines: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));

// The two phones the Q5 bar names: a 360x800 Android and a 390x844 iPhone.
const DEVICES = [
  { name: 'Android 360x800', frame: { x: 0, y: 0, width: 360, height: 800 }, insets: { top: 24, bottom: 16, left: 0, right: 0 } },
  { name: 'iPhone 390x844', frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, bottom: 34, left: 0, right: 0 } },
];
const nav = { goBack: jest.fn(), navigate: jest.fn(), addListener: jest.fn(() => jest.fn()) };

const sub = (over: Record<string, unknown>) => ({
  id: `e-${String(over.name)}`, userId: `u-${String(over.name)}`, name: 'Client', email: '',
  startedAt: '', status: 'active', rawStatus: 'active', nextRenewalAt: null,
  amountCents: 0, currency: 'usd', entitlementActive: true, cancelAtPeriodEnd: false, ...over,
});

describe.each(DEVICES)('on $name', (device) => {
  const wrap = (node: React.ReactElement) => (
    <SafeAreaProvider initialMetrics={{ frame: device.frame, insets: device.insets }}>{node}</SafeAreaProvider>
  );

  it('the push prompt is a 24 pt bottom sheet above the home indicator, with a 12 pt forest button', async () => {
    const view = await render(wrap(
      <PushPromptSheet visible contentTitle="Week 1" mode="new_content" onPushExisting={jest.fn()} onFutureOnly={jest.fn()} onDismiss={jest.fn()} />,
    ));
    const panel = StyleSheet.flatten(view.getByTestId('push-prompt-panel').props.style);
    expect(panel.borderTopLeftRadius).toBe(radius.sheet);
    expect(panel.borderTopRightRadius).toBe(radius.sheet);
    expect(panel.paddingBottom).toBe(spacing.lg + device.insets.bottom);
    expect(StyleSheet.flatten(view.getByTestId('push-prompt-existing').props.style).borderRadius).toBe(radius.button);
  });

  it('Subscribers leaves a missing or unreadable date out of the line, never a dash or "null"', async () => {
    mockSubscribers.mockResolvedValueOnce({
      data: {
        subscribers: [
          sub({ name: 'Ada', startedAt: '', nextRenewalAt: 'not-a-date' }),
          sub({ name: 'Bea', startedAt: '2026-10-01T12:00:00.000Z', nextRenewalAt: '2026-11-01T12:00:00.000Z' }),
        ],
        totalActive: 2, monthlyRecurringRevenueCents: null, currency: null, nextOffset: null,
      },
    });
    const view = await render(wrap(
      <CoachPackageSubscribersScreen
        navigation={nav as never}
        route={{ key: 's', name: 'CoachPackageSubscribers', params: { packageId: 'p1', title: 'Twelve weeks' } } as never}
      />,
    ));
    await view.findByText('Ada');
    const metas = view.getAllByText(/^Access (active|ended)/).map((n) => [n.props.children].flat().join(''));
    expect(metas[0]).toBe('Access active');
    expect(metas[1]).toBe('Access active · Started Oct 1, 2026 · Renews Nov 1, 2026');
    for (const m of metas) expect(m).not.toMatch(/—|null|undefined/);
  });

  it('Templates cards show the title with no initials or emoji tile', async () => {
    const view = await render(wrap(<ProgramTemplatesScreen />));
    expect(view.getByText('Fat Loss Protocol')).toBeTruthy();
    for (const glyph of ['FL', 'LB', 'RC', 'MP', 'MW']) expect(view.queryByText(glyph)).toBeNull();
  });
});

// ── Source guards ───────────────────────────────────────────────────────────
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const SHEETS = path.resolve(__dirname, '..', 'payments', 'contents');
const SHEET_FILES = ['ContentAttachForm', 'PushConfirmModal', 'MediaAssetPicker', 'PushPromptSheet'];

describe('package-content sheets (source)', () => {
  it.each(SHEET_FILES)('%s has no literal or legacy radius', (n) => {
    const src = strip(fs.readFileSync(path.join(SHEETS, `${n}.tsx`), 'utf8'));
    expect(src.match(/border(?:Top|Bottom)?(?:Left|Right)?Radius:\s*\d+/g)).toBeNull();
    expect(src).not.toMatch(/radius\.(?:sm|md|lg|xl)\b/);
  });
});

describe('copy rules (source)', () => {
  it('Templates has no emoji field, tile style or pictographic character', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '..', 'ProgramTemplatesScreen.tsx'), 'utf8');
    expect(strip(src)).not.toMatch(/\bemoji/i);
    expect(src).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('Subscribers prints no dash placeholder for a missing date', () => {
    const src = strip(fs.readFileSync(path.resolve(__dirname, '..', 'payments', 'CoachPackageSubscribersScreen.tsx'), 'utf8'));
    expect(src).not.toMatch(/\?\?\s*'—'/);
  });
});
