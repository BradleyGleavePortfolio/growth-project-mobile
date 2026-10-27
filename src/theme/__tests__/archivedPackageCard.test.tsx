// GREY-ARCHIVED (LO-875R OB1): an archived package card is not faded. The ARCHIVED pill marks the
// state, every word on the card clears 4.5:1 on the card, and the card still opens as "Edit {title}".
import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import CoachPackagesListScreen from '../../screens/coach/payments/CoachPackagesListScreen';
import type { CoachPackage } from '../../api/packagesApi';
import { lightTokens } from '../tokens';

const pkg = (over: Partial<CoachPackage>): CoachPackage => ({
  id: 'p1',
  coachUserId: 'c1',
  title: 'Twelve weeks',
  description: null,
  priceCents: 19900,
  currency: 'usd',
  billingInterval: 'monthly',
  intervalCount: 1,
  trialDays: null,
  features: [],
  status: 'active',
  shareToken: null,
  subscriberCount: 3,
  monthlyRevenueCents: 59700,
  statsAvailable: true,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  archivedAt: null,
  publishedAt: '2026-10-01T00:00:00Z',
  ...over,
});

const mockPackages = [
  pkg({}),
  pkg({ id: 'p2', title: 'Summer block', status: 'archived', subscriberCount: 1, monthlyRevenueCents: 19900, archivedAt: '2026-10-20T00:00:00Z' }),
];

jest.mock('../../api/packagesApi', () => ({
  coachPackagesApi: { list: jest.fn(() => Promise.resolve({ data: mockPackages })) },
}));
jest.mock('../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../utils/haptics', () => ({ mediumTap: jest.fn(), successTap: jest.fn(), warningTap: jest.fn() }));

const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
type Node = ReturnType<typeof screen.getByText>;
const flat = (n: Node) => StyleSheet.flatten(n.props.style) ?? {};
const texts = (card: Node) => card.queryAll((n) => n.type === 'Text');

const nav = { goBack: jest.fn(), navigate: jest.fn(), addListener: jest.fn(() => jest.fn()) };
async function renderList() {
  await render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, bottom: 34, left: 0, right: 0 } }}>
      <CoachPackagesListScreen navigation={nav as never} />
    </SafeAreaProvider>,
  );
  return screen.findByLabelText('Edit Summer block');
}

describe('GREY-ARCHIVED: archived package card', () => {
  it('is not faded: no opacity under 1 on the card or any of its words', async () => {
    const card = await renderList();
    for (const text of texts(card)) {
      for (let n: Node | null = text; n; n = n.parent) {
        const { opacity } = flat(n);
        expect({ text: text.props.children, opacity: opacity === undefined ? 1 : opacity }).toEqual({ text: text.props.children, opacity: 1 });
      }
    }
  });

  it('marks the state with the ARCHIVED pill, and every word clears 4.5:1 on the card', async () => {
    const card = await renderList();
    expect(screen.getByText('Archived')).toBeTruthy();
    const ground = flat(card).backgroundColor as string;
    expect(ground).toBe(lightTokens.bgSurface);
    const words = texts(card);
    expect(words.length).toBeGreaterThanOrEqual(5);
    for (const text of words) {
      const color = flat(text).color as string;
      expect({ color, pass: ratio(color, ground) >= 4.5 }).toEqual({ color, pass: true });
    }
  });

  it('still opens the editor for that package', async () => {
    const card = await renderList();
    fireEvent.press(card);
    expect(nav.navigate).toHaveBeenCalledWith('CoachPackageEdit', expect.objectContaining({ packageId: 'p2' }));
  });
});
