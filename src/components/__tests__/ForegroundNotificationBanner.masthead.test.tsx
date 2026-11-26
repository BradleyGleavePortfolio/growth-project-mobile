/**
 * REFINE-966 (#203-E44): the in-app banner is the owner's Masthead slip, ctx#523 style 1 (planning/BANNER-MOCK at
 * 4119234a09361990859bca4309c4f1f0f024602a, src/html/1_msg_client_ios.html: the CSS line is quoted beside each case),
 * or the shared safety look exactly when the push opens CoachSafetyAlert. Every value from a token.
 */
import React from 'react';
import { AccessibilityInfo, Animated, PanResponder } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, lightTokens, radius, shadows } from '../../theme/tokens';

jest.mock('../../theme/ThemeProvider', () => {
  const tokens = jest.requireActual('../../theme/tokens');
  return { useTheme: () => ({ colors: {}, semanticColors: tokens.lightTokens, tokens: tokens.default }) };
});
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 47, bottom: 0, left: 0, right: 0 }) }));
jest.mock('../../services/pushTapRouter', () => {
  const actual = jest.requireActual('../../services/pushTapRouter');
  return { ...actual, routePushTap: jest.fn() };
});

import ForegroundNotificationBanner, { AUTO_DISMISS_MS } from '../ForegroundNotificationBanner';
import { foregroundBannerStore, type BannerPayload } from '../../store/foregroundBannerStore';
import { routePushTap } from '../../services/pushTapRouter';

type Node = {
  props: Record<string, unknown>;
  parent: Node | null;
  queryAll: (p: (n: Node) => boolean) => Node[];
};
const flatten = (style: unknown): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  const walk = (s: unknown) => {
    if (Array.isArray(s)) s.forEach(walk);
    else if (s && typeof s === 'object') Object.assign(out, s as Record<string, unknown>);
  };
  walk(style);
  return out;
};
const ancestors = (n: Node) => { const out: Node[] = []; for (let p = n.parent; p; p = p.parent) out.push(p); return out; };
const GLYPHS = (Ionicons as unknown as { glyphMap: Record<string, number> }).glyphMap;
const textOf = (n: Node): string =>
  [n.props.children].flat(Infinity).filter((c): c is string => typeof c === 'string').join('');
/** vector-icons draws a Text holding the glyph: the icon's name, read from either. */
const isGlyph = (n: Node, name: string) => n.props.name === name || textOf(n) === String.fromCodePoint(GLYPHS[name]);

const TITLE = 'Stand-in title';
const BODY = 'Stand-in body';
const LABEL = `${TITLE}. ${BODY}. Tap to view.`;
const plain: BannerPayload = {
  title: TITLE, body: BODY, notificationId: 'm-1', actionScreen: 'Messages', deepLink: 'tgp://messages', kind: 'message_received',
};
const safety: BannerPayload = {
  title: TITLE, body: BODY, notificationId: 's-1', actionScreen: 'CoachSafetyAlert', actionParams: { alertId: 'a-1' }, kind: 'coach_alert',
};
const staff: BannerPayload = { title: TITLE, body: BODY, notificationId: 'c-1', actionScreen: 'NotificationCenter', kind: 'coach_alert' };

let timing: jest.SpyInstance;
const ends: ((r: { finished: boolean }) => void)[] = [];
beforeEach(() => {
  ends.length = 0;
  timing = jest.spyOn(Animated, 'timing').mockImplementation(() => ({
    start: (done?: (r: { finished: boolean }) => void) => { if (done) ends.push(done); }, stop: jest.fn(), reset: jest.fn(),
  }) as never);
  jest.mocked(routePushTap).mockClear();
});
afterEach(async () => {
  timing.mockRestore();
  await act(async () => foregroundBannerStore.getState().reset());
});
const finish = () => act(async () => { ends.splice(0).forEach((done) => done({ finished: true })); });

async function drawn(payload: BannerPayload) {
  await act(async () => foregroundBannerStore.getState().showBanner(payload));
  const view = await render(<ForegroundNotificationBanner />);
  return view;
}
const card = (view: Awaited<ReturnType<typeof drawn>>) => view.getByTestId('foreground-banner-card') as unknown as Node;
const timingsOf = (duration: number) => timing.mock.calls.filter(([, c]) => (c as { duration: number }).duration === duration);

describe('item 1: place', () => {
  it('the outer container stays as main tests it, with no fill, box-none and the card\'s 16 pt sides', async () => {
    // .s1 { left:16px; right:16px; top: calc(var(--top) + 8px) }
    const view = await drawn(plain);
    const outer = flatten(view.root?.props.style);
    expect(outer).toMatchObject({ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 999, paddingTop: 47 });
    expect(outer.backgroundColor).toBeUndefined();
    expect(outer.pointerEvents).toBe('box-none');
    expect(outer.paddingHorizontal).toBe(16);
    expect(flatten(card(view).parent?.props.style).marginTop).toBe(8);
  });
});

describe('item 2: the card', () => {
  it('surface.masthead, radius.card on all four corners, shadows.lg exactly (the doctrine\'s cap), clipped', async () => {
    // .s1 { background:#1C3023; border-radius:16px; box-shadow:0 4px 12px rgba(26,26,24,.08); overflow:hidden }
    const view = await drawn(plain);
    const c = flatten(card(view).props.style);
    expect(c.backgroundColor).toBe(lightTokens.surface.masthead);
    expect(c.borderRadius).toBe(radius.card);
    for (const corner of ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius']) {
      expect(c[corner]).toBeUndefined();
    }
    expect({
      shadowColor: c.shadowColor, shadowOffset: c.shadowOffset, shadowOpacity: c.shadowOpacity,
      shadowRadius: c.shadowRadius, elevation: c.elevation,
    }).toEqual(shadows.lg);
    expect(c.shadowOpacity as number).toBeLessThanOrEqual(shadows.lg.shadowOpacity);
    const clip = flatten((card(view).queryAll((n) => flatten(n.props.style).overflow === 'hidden')[0]).props.style);
    expect(clip.borderRadius).toBe(radius.card);
  });
});

describe('item 3: the hairline', () => {
  it('1 pt, 16 in from each side, textOnMastheadMuted at 45%', async () => {
    // .s1 .rule { left:16px; right:16px; top:0; height:1px; background:rgba(184,204,191,.45) }
    const view = await drawn(plain);
    expect(flatten(view.getByTestId('foreground-banner-rule').props.style)).toMatchObject({
      position: 'absolute', top: 0, left: 16, right: 16, height: 1, backgroundColor: 'rgba(184, 204, 191, 0.45)',
    });
  });
});

describe('item 4: the tap area and the close are two elements', () => {
  it('siblings, the close a 44 x 44 box of its own (no hit slop), each with its label', async () => {
    // .s1 .main { min-height:44px; gap:12px; padding:12px 0 14px 14px }  .tap { min-width:44px; min-height:44px }
    const view = await drawn(plain);
    const tap = view.getByLabelText(LABEL) as unknown as Node;
    const close = view.getByLabelText('Dismiss notification') as unknown as Node;
    expect(ancestors(close)).not.toContain(tap);
    expect(ancestors(tap)).not.toContain(close);
    expect(close.props.hitSlop).toBeUndefined();
    const box = flatten(close.props.style);
    expect(box.width as number).toBeGreaterThanOrEqual(44);
    expect(box.height as number).toBeGreaterThanOrEqual(44);
    expect(box).toMatchObject({ marginTop: 2, marginRight: 2 });
    expect(flatten(tap.props.style)).toMatchObject({
      minHeight: 44, gap: 12, paddingTop: 12, paddingBottom: 14, paddingLeft: 14, paddingRight: 0,
    });
    expect(tap.props.accessibilityRole).toBe('button');
  });

  it('the tap routes once with the store\'s four values; the close and a swipe route nothing', async () => {
    const created = jest.spyOn(PanResponder, 'create');
    let view = await drawn({ ...plain, actionParams: { clientId: 'c-1' } });
    await fireEvent.press(view.getByLabelText(LABEL));
    await finish();
    expect(routePushTap).toHaveBeenCalledTimes(1);
    expect(routePushTap).toHaveBeenCalledWith('Messages', { clientId: 'c-1' }, 'm-1', 'tgp://messages');
    await view.unmount();

    jest.mocked(routePushTap).mockClear();
    view = await drawn(plain);
    await fireEvent.press(view.getByLabelText('Dismiss notification'));
    await finish();
    expect(foregroundBannerStore.getState().banner).toBeNull();
    await view.unmount();

    view = await drawn(plain);
    const pan = created.mock.calls[created.mock.calls.length - 1][0];
    await act(async () => { pan.onPanResponderRelease?.({} as never, { dy: -40 } as never); });
    await finish();
    expect(foregroundBannerStore.getState().banner).toBeNull();
    expect(routePushTap).not.toHaveBeenCalled();
    created.mockRestore();
    await view.unmount();
  });
});

describe('items 5 to 7: mark, title and body', () => {
  it('the mark: a 38 pt ring, 1.25 pt textOnMastheadMuted, a 22 pt glyph, hidden from the screen reader', async () => {
    // .s1 .ring1 { width:38px; height:38px; border-radius:50%; border:1.25px solid #B8CCBF; color:#B8CCBF }
    const view = await drawn(plain);
    const mark = view.getByTestId('foreground-banner-mark', { includeHiddenElements: true }) as unknown as Node;
    expect(mark.props.size ?? flatten(mark.props.style).fontSize).toBe(22);
    expect(mark.props.accessibilityElementsHidden ?? true).toBe(true);
    const ring = flatten((ancestors(mark).find((n) => flatten(n.props.style).width === 38) as Node).props.style);
    expect(ring).toMatchObject({ width: 38, height: 38, borderRadius: radius.chip, borderWidth: 1.25, borderColor: lightTokens.textOnMastheadMuted });
  });

  it('the title in Cormorant 500, 19/24, two lines; the body in Inter 14.5/20, two lines, 2 pt below', async () => {
    // .s1 .tt { font-size:19px; line-height:1.25; color:#FBF7F0 } .c2   .s1 .bd { font-size:14.5px; line-height:1.38; color:#B8CCBF; margin-top:2px }
    const view = await drawn(plain);
    const title = view.getByText(TITLE);
    const body = view.getByText(BODY);
    expect(title.props.numberOfLines).toBe(2);
    expect(body.props.numberOfLines).toBe(2);
    expect(title.props.ellipsizeMode ?? 'tail').toBe('tail');
    expect(flatten(title.props.style)).toMatchObject({
      fontFamily: 'CormorantGaramond_500Medium', fontSize: 19, lineHeight: 24, color: lightTokens.textOnAccent,
    });
    expect(flatten(body.props.style)).toMatchObject({
      fontFamily: 'Inter_400Regular', fontSize: 14.5, lineHeight: 20, marginTop: 2, color: lightTokens.textOnMastheadMuted,
    });
    // Item 11: every size follows the phone's text size.
    expect(title.props.allowFontScaling).not.toBe(false);
    expect(body.props.allowFontScaling).not.toBe(false);
  });
});

describe('item 8: the timer line', () => {
  it('drains once over AUTO_DISMISS_MS on the native driver, as a transform, and restarts on a second arrival', async () => {
    // .s1 .timer { position:absolute; left:0; bottom:0; height:3px; background:#A3C46A; border-radius:0 2px 2px 0 }
    expect(AUTO_DISMISS_MS).toBe(4000);
    const view = await drawn(plain);
    const line = flatten(view.getByTestId('foreground-banner-timer').props.style);
    expect(line).toMatchObject({
      position: 'absolute', left: 0, bottom: 0, height: 3, backgroundColor: lightTokens.data.leaf,
      borderTopRightRadius: 2, borderBottomRightRadius: 2,
    });
    expect(line.width).toBeUndefined();
    expect((line.transform as Record<string, unknown>[])[0]).toHaveProperty('translateX');
    const drains = timingsOf(AUTO_DISMISS_MS);
    expect(drains).toHaveLength(1);
    expect(drains[0][1]).toMatchObject({ toValue: 1, useNativeDriver: true });
    await act(async () => foregroundBannerStore.getState().showBanner({ ...plain, notificationId: 'm-2' }));
    expect(timingsOf(AUTO_DISMISS_MS)).toHaveLength(2);
  });

  it('none under Reduce Motion', async () => {
    jest.mocked(AccessibilityInfo.isReduceMotionEnabled).mockResolvedValueOnce(true);
    const view = await drawn(plain);
    await act(async () => { await Promise.resolve(); });
    expect(view.queryByTestId('foreground-banner-timer')).toBeNull();
  });
});

describe('item 9: the shared safety look, keyed only on CoachSafetyAlert', () => {
  it('warningBg, a 1.5 pt warningInk edge, no shadow, no hairline, no timer, Inter 600 16 ink, charcoal body, the warning mark', async () => {
    // .safe { background:#F8F2E5; border:1.5px solid #8A6A2A; box-shadow:none }  .s1.safe .tt { Inter 600 16px }
    const view = await drawn(safety);
    const c = flatten(card(view).props.style);
    expect(c).toMatchObject({ backgroundColor: colors.warningBg, borderWidth: 1.5, borderColor: colors.warningInk, borderRadius: radius.card });
    expect(c.shadowOpacity).toBeUndefined();
    expect(c.elevation).toBeUndefined();
    expect(view.queryByTestId('foreground-banner-rule')).toBeNull();
    expect(view.queryByTestId('foreground-banner-timer')).toBeNull();
    expect(timingsOf(AUTO_DISMISS_MS)).toHaveLength(0);
    expect(flatten(view.getByText(TITLE).props.style)).toMatchObject({ fontFamily: 'Inter_600SemiBold', fontSize: 16, color: colors.ink });
    expect(flatten(view.getByText(BODY).props.style).color).toBe(colors.charcoal);
    const mark = view.getByTestId('foreground-banner-mark', { includeHiddenElements: true }) as unknown as Node;
    expect(isGlyph(mark, 'warning-outline')).toBe(true);
    expect(mark.props.size ?? flatten(mark.props.style).fontSize).toBe(26);
    expect(mark.props.color ?? flatten(mark.props.style).color).toBe(colors.warningInk);
    const ring = flatten((ancestors(mark).find((n) => flatten(n.props.style).width === 38) as Node).props.style);
    expect(ring.borderWidth).toBe(0);
    const cross = (view.getByLabelText('Dismiss notification') as unknown as Node).queryAll((n) => isGlyph(n, 'close'))[0];
    expect(cross.props.color ?? flatten(cross.props.style).color).toBe(colors.ink);
  });

  it('a coach_alert that opens NotificationCenter (the staff alert) keeps the plain look and the neutral mark', async () => {
    const view = await drawn(staff);
    expect(flatten(card(view).props.style).backgroundColor).toBe(lightTokens.surface.masthead);
    expect(isGlyph(view.getByTestId('foreground-banner-mark', { includeHiddenElements: true }) as unknown as Node, 'notifications-outline')).toBe(true);
    expect(view.getByTestId('foreground-banner-timer')).toBeTruthy();
  });
});

describe('item 10: the slide', () => {
  it('300 ms in from past the card\'s own height, 250 ms out to it', async () => {
    const view = await drawn(plain);
    const outer = view.root;
    if (!outer) throw new Error('expected the banner to be drawn');
    await act(async () => { fireEvent(outer, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 150 } } }); });
    const slideIn = timing.mock.calls.find(([, c]) => (c as { duration: number }).duration === 300);
    expect(slideIn?.[1]).toMatchObject({ toValue: 0, useNativeDriver: true });
    const from = (slideIn?.[0] as unknown as { __getValue: () => number }).__getValue();
    // Past the measured height and what reaches under it (the shadows.lg blur, the stacked edge).
    expect(from).toBeLessThanOrEqual(-150 - shadows.lg.shadowOffset.height - shadows.lg.shadowRadius);
    await fireEvent.press(view.getByLabelText('Dismiss notification'));
    const slideOut = timing.mock.calls.find(([, c]) => (c as { duration: number }).duration === 250);
    expect((slideOut?.[1] as { toValue: number }).toValue).toBe(from);
  });
});
