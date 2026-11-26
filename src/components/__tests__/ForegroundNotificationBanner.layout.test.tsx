/**
 * FOREGROUND-BANNER-M case 11 and step 4: the banner, now drawn over every signed-in screen, reads whole to a screen
 * reader, keeps two title lines and two body lines, and meets [P06]: 44 pt targets, radii from 12/16/24.
 * REFINE-966 (the Masthead slip, #203-E44): the title now runs two lines, the close is its own 44 pt box beside the
 * tap area, and the corners are the card's. (This Mac runs no VoiceOver or TalkBack; 320 pt and 130% are rendered.)
 */
import React from 'react';
import { act, render } from '@testing-library/react-native';

jest.mock('../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: { textPrimary: '#1A1A18', textOnPrimary: '#FFFDF8', primary: '#4A0404', primaryPale: '#EFE6DC' } }),
}));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 47, bottom: 0, left: 0, right: 0 }) }));

import ForegroundNotificationBanner from '../ForegroundNotificationBanner';
import { foregroundBannerStore } from '../../store/foregroundBannerStore';

const flatten = (style: unknown): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  const walk = (s: unknown) => {
    if (Array.isArray(s)) s.forEach(walk);
    else if (s && typeof s === 'object') Object.assign(out, s as Record<string, unknown>);
  };
  walk(style);
  return out;
};
const RADII = [12, 16, 24];
type Node = { props: Record<string, unknown>; queryAll: (p: (n: Node) => boolean) => Node[] };
/** The icon's size: the host's own size prop, or the glyph's font size (vector-icons draws a Text). */
const iconSize = (n: Node) => (n.props.size as number | undefined) ?? (flatten(n.props.style).fontSize as number | undefined);
const TITLE = 'A stand-in title long enough to run past one line at three hundred and twenty points wide';
const BODY = 'A stand-in body long enough to run past two lines at three hundred and twenty points wide, so the ellipsis shows in the second line and the label still holds every word';

async function drawn() {
  await act(async () => foregroundBannerStore.getState().showBanner({ title: TITLE, body: BODY, notificationId: 'layout-1' }));
  return render(<ForegroundNotificationBanner />);
}
afterEach(async () => {
  await act(async () => foregroundBannerStore.getState().reset());
});

it('the screen reader hears the whole title and body', async () => {
  const view = await drawn();
  expect(view.getByLabelText(`${TITLE}. ${BODY}. Tap to view.`)).toBeTruthy();
});

it('the title keeps two lines and the body two, cut with an ellipsis', async () => {
  const view = await drawn();
  expect(view.getByText(TITLE).props.numberOfLines).toBe(2);
  expect(view.getByText(BODY).props.numberOfLines).toBe(2);
  expect(view.getByText(TITLE).props.ellipsizeMode ?? 'tail').toBe('tail');
});

it('the close control is a 44 pt box of its own around its icon, beside the tap area', async () => {
  const view = await drawn();
  const close = view.getByLabelText('Dismiss notification') as unknown as Node;
  const size = close.queryAll((n) => typeof iconSize(n) === 'number').map(iconSize)[0] as number;
  expect(size).toBe(18);
  // Its own layout, no hit slop counted.
  expect(close.props.hitSlop).toBeUndefined();
  const box = flatten(close.props.style);
  expect(box.width as number).toBeGreaterThanOrEqual(44);
  expect(box.height as number).toBeGreaterThanOrEqual(44);
  // Beside the row, never inside it (two elements to a screen reader).
  const row = view.getByLabelText(`${TITLE}. ${BODY}. Tap to view.`) as unknown as Node;
  expect(row.queryAll((n) => n === close)).toHaveLength(0);
});

it('the banner\'s own tap target is at least 44 pt tall', async () => {
  const view = await drawn();
  const row = flatten(view.getByLabelText(`${TITLE}. ${BODY}. Tap to view.`).props.style);
  const title = flatten(view.getByText(TITLE).props.style);
  const body = flatten(view.getByText(BODY).props.style);
  expect(row.minHeight as number).toBeGreaterThanOrEqual(44);
  expect((row.paddingTop as number) + (row.paddingBottom as number) + (title.lineHeight as number) + (body.lineHeight as number)).toBeGreaterThanOrEqual(44);
});

it('its corners come from the [P06] radius set', async () => {
  const view = await drawn();
  const card = flatten(view.getByTestId('foreground-banner-card').props.style);
  expect(RADII).toContain(card.borderRadius);
  const root = view.root as unknown as Node;
  // The kind's mark sits in a circle (radius.chip), the drawing's 38 pt ring.
  const ring = root.queryAll((n) => { const f = flatten(n.props.style); return f.width === 38 && f.height === 38; })[0];
  expect(flatten(ring.props.style).borderRadius as number).toBeGreaterThanOrEqual(38 / 2);
});
