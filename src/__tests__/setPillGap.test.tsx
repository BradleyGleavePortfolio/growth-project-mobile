/**
 * SET-PILL-GAP-M (LO-960R3 C1; operator rulings 14:2x PST 11-12): while an open
 * set's bin line shows, a tap just under "As planned" (or the round check) must
 * not land on the bin, which removes an unticked set at once. The bin is drawn
 * after the done control in the row, and React Native gives a touch in an
 * overlap to the later child (RCTViewComponentView.mm:704, TouchTargetHelper.kt:217
 * in react-native 0.85.3), so the bin's touch area must start G below the done
 * control's. G is the C1 Style C v2 logger drawings' in-row value: 6 pt from the
 * numbers' dashed line to a wrapped pill (C2_logger_ios390_130, _android360_130).
 * Where the pill wraps under the numbers, the same 6 pt is drawn between them.
 *
 * There is no layout engine in jest here, so a small wrap-and-column model
 * places the row's views from their real rendered styles. Fed per size, from
 * the renders at 868825cc (capture-log.json rows), is only what jest cannot
 * measure: the heights of the row's lines above the tools line and the line
 * that holds the done control. Everything else (padding, gaps, margins, each
 * view's height from its min / max / padding / borders / content, alignment,
 * hitSlop) is read from the tree. A layout key on these views that the model
 * does not handle fails the test with its name. The x positions need text
 * widths, so the gap is checked across the whole row width, which is stricter
 * than "where the two overlap left to right".
 */
import React from 'react';
import { Dimensions, StyleSheet } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { SetLogger } from '../screens/client/active-workout/SetLogger';
import { makeStyles } from '../screens/client/active-workout/styles';

const colors = new Proxy({}, { get: () => '#000000' }) as never;
const G = 6; // pt: the drawings' in-row value (operator ruling 14:2x)
const TARGET = 44; // pt: the bin's box, and the done control's least height
const EPS = 0.01;

type Style = Record<string, unknown>;
type Node = { type: unknown; props: Record<string, unknown>; parent: Node | null; children: (Node | string)[] };

// The four sizes the logger frames draw, and 320 pt where a tapped-open set shows the line too.
const SIZES = [
  { phone: 390, height: 844, pct: 100 }, { phone: 390, height: 844, pct: 130 },
  { phone: 360, height: 800, pct: 100 }, { phone: 360, height: 800, pct: 130 },
  { phone: 320, height: 568, pct: 100 }, { phone: 320, height: 568, pct: 130 },
] as const;
type SizeKey = `${(typeof SIZES)[number]['phone']}/${(typeof SIZES)[number]['pct']}`;

// Fed from the base renders: line heights above the tools line (pt), the line holding the done control, and,
// for the record, what the renders measured at 868825cc from the done control's bottom to the bin's top.
type Feed = { lines: number[]; done: number; main: number } | 'no bin line';
const one = (h: number): Feed => ({ lines: [h], done: 0, main: (h - TARGET) / 2 });
const two = (h: number): Feed => ({ lines: [h, TARGET], done: 1, main: 0 });

const last = { weight: 150, reps: 6, completed: false };
type Props = Partial<React.ComponentProps<typeof SetLogger>>;
type Row = { name: string; props: Props; done: string; tapOpen: (phone: number) => boolean; feed: Record<SizeKey, Feed> };
const ROWS: Row[] = [
  {
    // hist-next row 1-1. At 320 pt the next set is its text row (SetLogger.tsx:163): no bin line.
    name: 'the next set with last time\'s set (the pill)',
    props: { set: { weight: 155, reps: 6, completed: false }, nextUp: true, previous: last },
    done: 'As planned, mark set 2 done', tapOpen: () => false,
    feed: { '390/100': one(44), '390/130': two(46), '360/100': one(44), '360/130': two(46), '320/100': 'no bin line', '320/130': 'no bin line' },
  },
  {
    // zero-next row 0-0 (the harness's 0 x 0 next set); tapped open at 320 pt.
    name: 'an open next set with no plan and no last time (the check)',
    props: { set: { weight: 0, reps: 0, completed: false }, nextUp: true },
    done: 'Mark set 2 done', tapOpen: (phone) => phone < 360,
    feed: { '390/100': one(44), '390/130': one(46), '360/100': one(44), '360/130': one(46), '320/100': one(44), '320/130': one(46) },
  },
  {
    // live-ticked-open row 1-0.
    name: 'a ticked set tapped open (the check)',
    props: { set: { weight: 155, reps: 6, completed: true } },
    done: 'Mark set 2 done', tapOpen: () => true,
    feed: { '390/100': one(44), '390/130': one(45), '360/100': one(44), '360/130': one(45), '320/100': one(44), '320/130': one(45) },
  },
  {
    // hist-open row 1-2: a set that is not next, tapped open, with "Previous" beside the bin.
    name: 'a set tapped open (the pill, with Previous)',
    props: { set: { weight: 155, reps: 6, completed: false }, previous: last },
    done: 'As planned, mark set 2 done', tapOpen: () => true,
    feed: { '390/100': one(44), '390/130': one(45), '360/100': one(44), '360/130': two(45), '320/100': two(44), '320/130': two(45) },
  },
  {
    // hist-timed row 3-1: below 390 pt a timed next set is its text row, tapped open (SetLogger.tsx:163).
    name: 'a timed next set (the pill)',
    props: { set: { weight: 0, reps: 60, completed: false }, nextUp: true, timed: true, previous: { weight: 0, reps: 45, completed: false } },
    done: 'As planned, mark set 2 done', tapOpen: (phone) => phone < 390,
    feed: { '390/100': one(44), '390/130': two(46), '360/100': two(44), '360/130': two(46), '320/100': two(44), '320/130': two(46) },
  },
];

// ---- the model ----

// Keys that draw but never move a box.
const LOOK = /^(backgroundColor|color|opacity|overflow|zIndex|elevation|cursor|backfaceVisibility|borderStyle|borderCurve|border(Top|Bottom|Left|Right|Start|End)?Color|border(TopLeft|TopRight|BottomLeft|BottomRight|TopStart|TopEnd|BottomStart|BottomEnd)?Radius|shadow(Color|Offset|Opacity|Radius))$/;
// Keys that act only along a line (left and right), never up and down.
const ALONG = ['justifyContent', 'columnGap', 'flexGrow', 'flexShrink', 'flexBasis', 'width', 'minWidth', 'maxWidth',
  'paddingLeft', 'paddingRight', 'paddingHorizontal', 'paddingStart', 'paddingEnd',
  'marginLeft', 'marginRight', 'marginHorizontal', 'marginStart', 'marginEnd',
  'borderLeftWidth', 'borderRightWidth', 'borderStartWidth', 'borderEndWidth'];
const BOX_V = ['minHeight', 'height', 'maxHeight', 'padding', 'paddingVertical', 'paddingTop', 'paddingBottom', 'borderWidth', 'borderTopWidth', 'borderBottomWidth'];
const MARGIN_V = ['margin', 'marginVertical', 'marginTop', 'marginBottom'];
const HANDLED: Record<'row' | 'line' | 'wrapper' | 'inner', string[]> = {
  // The row's own outer margins sit outside the row; they never move what is inside it.
  row: [...ALONG, ...BOX_V, ...MARGIN_V, 'flexDirection', 'flexWrap', 'alignItems', 'alignContent', 'rowGap', 'gap'],
  line: [...ALONG, ...BOX_V, ...MARGIN_V, 'flexDirection', 'flexWrap', 'alignItems', 'alignSelf'],
  wrapper: [...ALONG, ...BOX_V, ...MARGIN_V, 'alignSelf', 'flexDirection', 'alignItems', 'transform'],
  inner: [...ALONG, ...BOX_V, ...MARGIN_V, 'alignSelf', 'flexDirection', 'alignItems', 'gap', 'rowGap'],
};

function checkKeys(name: string, kind: keyof typeof HANDLED, s: Style, bad: string[]) {
  for (const [k, v] of Object.entries(s)) {
    if (v === undefined || v === null || LOOK.test(k)) continue;
    if (!HANDLED[kind].includes(k)) bad.push(`${name}.${k} (${JSON.stringify(v)}): a layout key the model does not handle`);
    else if (k === 'transform') {
      const atRest = Array.isArray(v) && v.every((t) => Object.entries(t as Style).every(([tk, tv]) => /^scale[XY]?$/.test(tk) && Number(tv) === 1));
      if (!atRest) bad.push(`${name}.transform (${JSON.stringify(v)}): only scale 1 (at rest) is handled`);
    }
  }
}

function num(s: Style, keys: string[], name: string, bad: string[]): number {
  for (const k of keys) {
    const v = s[k];
    if (v === undefined || v === null) continue;
    if (typeof v === 'number') return v;
    bad.push(`${name}.${k} (${JSON.stringify(v)}): a value the model does not handle`);
    return 0;
  }
  return 0;
}
const top = (s: Style, kind: 'padding' | 'margin', name: string, bad: string[]) => num(s, [`${kind}Top`, `${kind}Vertical`, kind], name, bad);
const bottom = (s: Style, kind: 'padding' | 'margin', name: string, bad: string[]) => num(s, [`${kind}Bottom`, `${kind}Vertical`, kind], name, bad);
const borderT = (s: Style, name: string, bad: string[]) => num(s, ['borderTopWidth', 'borderWidth'], name, bad);
const borderB = (s: Style, name: string, bad: string[]) => num(s, ['borderBottomWidth', 'borderWidth'], name, bad);
const opt = (s: Style, k: string, name: string, bad: string[]): number | undefined => (s[k] === undefined || s[k] === null ? undefined : num(s, [k], name, bad));
const clampH = (s: Style, own: number, name: string, bad: string[]) => {
  const h = opt(s, 'height', name, bad);
  const v = h ?? own;
  return Math.min(opt(s, 'maxHeight', name, bad) ?? Infinity, Math.max(opt(s, 'minHeight', name, bad) ?? 0, v));
};

const flat = (n: Node) => (StyleSheet.flatten(n.props.style as never) ?? {}) as Style;
const hostParent = (n: Node) => {
  let at = n.parent;
  while (at && at.type !== 'View') at = at.parent;
  return at;
};
const kids = (n: Node) => n.children.filter((c): c is Node => typeof c !== 'string');

// A text's height: its lineHeight at the font scale; an icon glyph: its size. A text with no lineHeight
// gets an upper bound (1.5 x its scaled size), usable only when a min height wins over it.
function contentOf(inner: Node, name: string, scale: number, bad: string[]) {
  const s = flat(inner);
  const dir = s.flexDirection ?? 'column';
  let bound = false;
  const sizes = kids(inner).map((c) => {
    if (c.type !== 'Text') { bad.push(`${name}: a ${String(c.type)} child the model does not measure`); return { h: 0, w: 0 }; }
    const t = flat(c);
    const fs = Number(t.fontSize ?? 14);
    if (String(t.fontFamily ?? '').toLowerCase() === 'ionicons') {
      const k = c.props.allowFontScaling === false ? 1 : scale;
      return { h: fs * k, w: fs * k };
    }
    if (typeof t.lineHeight === 'number') return { h: t.lineHeight * scale, w: NaN };
    bound = true;
    return { h: fs * scale * 1.5, w: NaN };
  });
  const gap = num(s, dir === 'row' ? [] : ['rowGap', 'gap'], `${name}.gap`, bad);
  const h = dir === 'row' ? Math.max(0, ...sizes.map((x) => x.h)) : sizes.reduce((a, x) => a + x.h, 0) + gap * Math.max(0, sizes.length - 1);
  const w = dir === 'row' ? sizes.reduce((a, x) => a + x.w, 0) : Math.max(0, ...sizes.map((x) => x.w));
  return { h, w, bound };
}

// A HapticPressable: its inner button (the testID / label view) inside its Animated wrapper (a column).
function pressable(inner: Node, name: string, scale: number, bad: string[]) {
  const wrapper = hostParent(inner)!;
  const ws = flat(wrapper);
  const is = flat(inner);
  checkKeys(`${name} wrapper`, 'wrapper', ws, bad);
  checkKeys(`${name} inner`, 'inner', is, bad);
  if (kids(wrapper).length !== 1) bad.push(`${name} wrapper holds more than its button`);
  if ((ws.flexDirection ?? 'column') !== 'column') bad.push(`${name} wrapper.flexDirection (${JSON.stringify(ws.flexDirection)}): the model handles a column`);
  const c = contentOf(inner, `${name} inner`, scale, bad);
  const frame = top(is, 'padding', `${name} inner`, bad) + bottom(is, 'padding', `${name} inner`, bad) + borderT(is, `${name} inner`, bad) + borderB(is, `${name} inner`, bad);
  const own = frame + c.h;
  const innerH = clampH(is, own, `${name} inner`, bad);
  if (c.bound && Math.abs(innerH - own) < EPS) bad.push(`${name} inner: its height comes from a text with no lineHeight, which the model cannot measure`);
  const iMT = top(is, 'margin', `${name} inner`, bad);
  const iMB = bottom(is, 'margin', `${name} inner`, bad);
  const wPT = top(ws, 'padding', `${name} wrapper`, bad) + borderT(ws, `${name} wrapper`, bad);
  const wPB = bottom(ws, 'padding', `${name} wrapper`, bad) + borderB(ws, `${name} wrapper`, bad);
  const wrapperH = clampH(ws, wPT + iMT + innerH + iMB + wPB, `${name} wrapper`, bad);
  if (wrapperH > wPT + iMT + innerH + iMB + wPB + EPS && Number(is.flexGrow ?? 0) <= 0) {
    bad.push(`${name} wrapper is taller than its button; the model does not place a button inside a taller wrapper`);
  }
  // The inner's width, for the bin's 44 x 44 (an icon is as wide as its size; a text cannot be measured).
  const wFixed = opt(is, 'width', `${name} inner`, bad);
  const padW = num(is, ['paddingLeft', 'paddingStart', 'paddingHorizontal', 'padding'], `${name} inner`, bad) + num(is, ['paddingRight', 'paddingEnd', 'paddingHorizontal', 'padding'], `${name} inner`, bad)
    + num(is, ['borderLeftWidth', 'borderStartWidth', 'borderWidth'], `${name} inner`, bad) + num(is, ['borderRightWidth', 'borderEndWidth', 'borderWidth'], `${name} inner`, bad);
  const ownW = wFixed ?? padW + c.w;
  const innerW = Math.min(opt(is, 'maxWidth', `${name} inner`, bad) ?? Infinity, Math.max(opt(is, 'minWidth', `${name} inner`, bad) ?? 0, ownW));
  return {
    wrapper, ws, is, innerH, innerW, wrapperH,
    outer: top(ws, 'margin', `${name} wrapper`, bad) + wrapperH + bottom(ws, 'margin', `${name} wrapper`, bad),
    mT: top(ws, 'margin', `${name} wrapper`, bad),
    innerOffset: wPT + iMT, // from the wrapper's top to the inner's top
    slop: { inner: inner.props.hitSlop, wrapper: wrapper.props.hitSlop },
  };
}

// A view placed in a line of height lineH by alignSelf, else its parent's alignItems.
function place(lineTop: number, lineH: number, outer: number, self: unknown, items: unknown, name: string, bad: string[]) {
  const a = self && self !== 'auto' ? self : (items ?? 'stretch');
  if (outer > lineH + EPS) bad.push(`${name} (${outer} pt) is taller than its line (${lineH} pt): the fed lines do not hold it`);
  if (a === 'center') return lineTop + (lineH - outer) / 2;
  if (a === 'flex-end') return lineTop + lineH - outer;
  if (a === 'flex-start' || a === 'stretch' || a === 'baseline') return lineTop;
  bad.push(`${name} align (${JSON.stringify(a)}): a value the model does not handle`);
  return lineTop;
}

type Slop = { top: number; bottom: number } | null;
function slopOf(v: unknown, name: string, bad: string[]): Slop {
  if (v === undefined || v === null) return null;
  if (typeof v === 'number') return { top: v, bottom: v };
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return { top: Number(o.top ?? 0), bottom: Number(o.bottom ?? 0) };
  }
  bad.push(`${name} hitSlop (${JSON.stringify(v)}): a value the model does not handle`);
  return null;
}

type Placed = { doneTop: number; doneBottom: number; doneTouchBottom: number; binTop: number; binTouchTop: number; numbersBottom: number | null; doneH: number; binH: number; binW: number };

async function layOut(row: Row, size: (typeof SIZES)[number], bad: string[]): Promise<Placed | 'no bin line'> {
  const scale = size.pct / 100;
  const view = await render(
    <SetLogger set={{ weight: 0, reps: 0, completed: false }} setIdx={1} exIdx={0}
      onUpdate={() => undefined} onToggleComplete={() => undefined}
      colors={colors} styles={makeStyles(colors)}
      onRemove={() => undefined} exerciseName="Bench press" {...row.props} />,
  );
  if (row.tapOpen(size.phone)) await act(async () => { fireEvent.press(view.getByTestId('set-value-0-1')); });
  const rowNode = view.getByTestId('set-row-0-1') as unknown as Node;
  const binInner = view.queryByTestId('remove-set-0-1') as unknown as Node | null;
  if (!binInner) return 'no bin line';
  const doneInner = view.getByTestId('set-done-0-1') as unknown as Node;
  if (doneInner.props.accessibilityLabel !== row.done) bad.push(`the done control is "${String(doneInner.props.accessibilityLabel)}", not "${row.done}"`);

  const rs = flat(rowNode);
  checkKeys('row', 'row', rs, bad);
  if (rs.flexDirection !== 'row' || rs.flexWrap !== 'wrap') bad.push('row: the model handles a wrapping row');
  const done = pressable(doneInner, 'done control', scale, bad);
  const bin = pressable(binInner, 'bin', scale, bad);
  const line = hostParent(bin.wrapper)!;
  const ls = flat(line);
  checkKeys('tools line', 'line', ls, bad);
  if (ls.flexBasis !== '100%') bad.push(`tools line.flexBasis (${JSON.stringify(ls.flexBasis)}): the model takes the tools line as its own line`);
  if ((ls.flexDirection ?? 'column') !== 'row') bad.push('tools line: the model handles a row');
  const children = kids(rowNode);
  if (children.length !== 3 || children[1] !== done.wrapper || children[2] !== line) {
    bad.push(`the row holds ${children.length} views; the model knows the numbers, then the done control, then the tools line`);
  }
  const lineItems = kids(line).map((k) => {
    if (k === bin.wrapper) return bin;
    const inner = kids(k)[0];
    return inner ? pressable(inner, inner.props.accessibilityLabel ? String(inner.props.accessibilityLabel).split(':')[0] : 'tools item', scale, bad) : null;
  });
  if (lineItems.some((x) => !x)) bad.push('the tools line holds a view that is not a button');

  const feed = row.feed[`${size.phone}/${size.pct}` as SizeKey];
  if (feed === 'no bin line') { bad.push('the renders show no bin line here, but this render draws one'); return 'no bin line'; }
  // Down the row: its top border and padding, the fed lines with the row gap between them, then the tools line.
  const gap = num(rs, ['rowGap', 'gap'], 'row', bad);
  const contentTop = borderT(rs, 'row', bad) + top(rs, 'padding', 'row', bad);
  const lineTop = (i: number) => contentTop + feed.lines.slice(0, i).reduce((a, h) => a + h, 0) + gap * i;
  const dWrapTop = place(lineTop(feed.done), feed.lines[feed.done], done.outer, done.ws.alignSelf, rs.alignItems, 'the done control', bad) + done.mT;
  const doneTop = dWrapTop + done.innerOffset;
  const toolsTop = lineTop(feed.lines.length) + top(ls, 'margin', 'tools line', bad);
  const lPT = borderT(ls, 'tools line', bad) + top(ls, 'padding', 'tools line', bad);
  const lPB = borderB(ls, 'tools line', bad) + bottom(ls, 'padding', 'tools line', bad);
  const tallest = Math.max(0, ...lineItems.map((x) => (x ? x.outer : 0)));
  const toolsH = clampH(ls, lPT + tallest + lPB, 'tools line', bad);
  const bWrapTop = place(toolsTop + lPT, toolsH - lPT - lPB, bin.outer, bin.ws.alignSelf, ls.alignItems, 'the bin', bad) + bin.mT;
  const binTop = bWrapTop + bin.innerOffset;
  // The row must have no free height for its lines to share (a min height taller than its lines).
  const total = lineTop(feed.lines.length) + top(ls, 'margin', 'tools line', bad) + toolsH + bottom(ls, 'margin', 'tools line', bad)
    + bottom(rs, 'padding', 'row', bad) + borderB(rs, 'row', bad);
  const rowMin = Math.max(opt(rs, 'minHeight', 'row', bad) ?? 0, opt(rs, 'height', 'row', bad) ?? 0);
  if (rowMin > total + EPS && !['flex-start', undefined].includes(rs.alignContent as never)) bad.push(`row: ${rowMin} pt min height over ${total} pt of lines, which the model does not share out`);

  // Touch areas: each box plus its hitSlop, on the inner button and on its wrapper.
  const dS = [slopOf(done.slop.inner, 'done inner', bad), slopOf(done.slop.wrapper, 'done wrapper', bad)];
  const bS = [slopOf(bin.slop.inner, 'bin inner', bad), slopOf(bin.slop.wrapper, 'bin wrapper', bad)];
  const doneTouchBottom = Math.max(doneTop + done.innerH + (dS[0]?.bottom ?? 0), dWrapTop + done.wrapperH + (dS[1]?.bottom ?? 0));
  const binTouchTop = Math.min(binTop - (bS[0]?.top ?? 0), bWrapTop - (bS[1]?.top ?? 0));
  // LO-960R3 N2: neither the bin nor "Use previous" reaches past its box.
  if (bS[0] || bS[1]) bad.push(`the bin carries a hitSlop (inner ${JSON.stringify(bin.slop.inner)}, wrapper ${JSON.stringify(bin.slop.wrapper)})`);
  const prev = view.queryByLabelText(/^Use previous set/) as unknown as Node | null;
  if (prev && (prev.props.hitSlop != null || hostParent(prev)!.props.hitSlop != null)) {
    bad.push(`"Use previous" carries a hitSlop (inner ${JSON.stringify(prev.props.hitSlop)}, wrapper ${JSON.stringify(hostParent(prev)!.props.hitSlop)})`);
  }
  return {
    doneTop, doneBottom: doneTop + done.innerH, doneTouchBottom, binTop, binTouchTop,
    numbersBottom: feed.done > 0 ? lineTop(feed.done - 1) + feed.lines[feed.done - 1] : null,
    doneH: done.innerH, binH: bin.innerH, binW: bin.innerW,
  };
}

// ---- the promise ----

const dims = { window: Dimensions.get('window'), screen: Dimensions.get('screen') };
function setPhone(size: (typeof SIZES)[number]) {
  const d = { width: size.phone, height: size.height, scale: 2, fontScale: size.pct / 100 };
  Dimensions.set({ window: d, screen: d });
}
afterAll(() => { Dimensions.set(dims); });

const r = (v: number) => Math.round(v * 100) / 100;
const cases = ROWS.flatMap((row) => SIZES.map((size) => ({ row, size, label: `${row.name} at ${size.phone} pt, ${size.pct}%` })));

it.each(cases)('the bin\'s touch area starts at least 6 pt under the done control\'s: $label', async ({ row, size }) => {
  setPhone(size);
  const bad: string[] = [];
  const p = await layOut(row, size, bad);
  const feed = row.feed[`${size.phone}/${size.pct}` as SizeKey];
  if (p === 'no bin line') {
    if (feed !== 'no bin line') bad.push('no bin line drawn, but the renders show one here');
  } else {
    const at = `${size.phone} pt ${size.pct}%: done control ${r(p.doneTop)}-${r(p.doneBottom)} (touch to ${r(p.doneTouchBottom)}), bin ${r(p.binTop)}-${r(p.binTop + p.binH)} (touch from ${r(p.binTouchTop)})` +
      (feed !== 'no bin line' ? `; main's renders at 868825cc: ${feed.main} pt from the done control to the bin` : '');
    const clear = p.binTouchTop - p.doneTouchBottom;
    if (clear < G - EPS) bad.push(`${at}: ${r(clear)} pt between the touch areas, under ${G}`);
    if (Math.abs(p.binH - TARGET) > EPS || Math.abs(p.binW - TARGET) > EPS) bad.push(`${at}: the bin is ${r(p.binW)} x ${r(p.binH)}, not ${TARGET} x ${TARGET}`);
    if (p.doneH < TARGET - EPS) bad.push(`${at}: the done control is ${r(p.doneH)} pt tall, under ${TARGET}`);
  }
  expect(bad).toEqual([]);
});

const wrapped = cases.filter(({ row, size }) => {
  const f = row.feed[`${size.phone}/${size.pct}` as SizeKey];
  return f !== 'no bin line' && f.done > 0;
});
it.each(wrapped)('a pill or check wrapped under the numbers sits at least 6 pt below them: $label', async ({ row, size }) => {
  setPhone(size);
  const bad: string[] = [];
  const p = await layOut(row, size, bad);
  if (p === 'no bin line' || p.numbersBottom === null) bad.push('expected the done control on a line under the numbers');
  else {
    const space = p.doneTop - p.numbersBottom;
    if (space < G - EPS) bad.push(`${size.phone} pt ${size.pct}%: the numbers' line ends at ${r(p.numbersBottom)}, the done control starts at ${r(p.doneTop)}: ${r(space)} pt, under the drawn ${G} (main's renders at 868825cc: 0)`);
  }
  expect(bad).toEqual([]);
});

it.each([
  { name: 'a closed row (not next, not tapped)', props: { set: { weight: 155, reps: 6, completed: false }, previous: last } as Props },
  { name: 'an open row with no remove', props: { set: { weight: 155, reps: 6, completed: false }, nextUp: true, previous: last, onRemove: undefined } as Props },
])('$name draws no bin line', async ({ props }) => {
  setPhone(SIZES[0]);
  const view = await render(
    <SetLogger set={{ weight: 0, reps: 0, completed: false }} setIdx={1} exIdx={0}
      onUpdate={() => undefined} onToggleComplete={() => undefined}
      colors={colors} styles={makeStyles(colors)}
      onRemove={() => undefined} exerciseName="Bench press" {...props} />,
  );
  expect(view.queryByTestId('remove-set-0-1')).toBeNull();
  expect(view.getByTestId('set-done-0-1')).toBeTruthy();
});
