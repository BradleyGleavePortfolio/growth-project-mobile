/**
 * LO-960R1 B1 (lens, agent 203): on an open live set row with last time's set,
 * "Previous" stays on the left of its line (as on main and as styles.ts says:
 * "Previous (when shown) on the left and the remove control on the right"), so
 * the "Use previous" target is not drawn flush against the bin that removes an
 * unticked set at once. HapticPressable puts `style` on its inner Pressable;
 * the flex child of the tools line is its Animated wrapper (containerStyle).
 *
 * LO-960R2 C1 (FIX-960R2): the test checks where "Previous" ends, not how.
 * There is no layout engine in jest here, so a small row-and-column model
 * places the boxes from the real rendered styles at the three phone widths the
 * renders measured (ctx#511 at a5ba91d4, png/head/capture-log.json, 100% text):
 * the tools line runs from x 45 to 355 / 325 / 285 pt; the words "Previous
 * 150 × 6" are 108.234375 pt wide (the model cannot measure text). The promise:
 * the words start where main's lone Previous line starts them (the line's left
 * edge plus that line's own left padding), the bin's 44 pt box ends at the
 * line's right edge, and the two boxes do not overlap. A layout key on these
 * views that the model does not handle fails the test with its name. The
 * render is the next set at the test's own width; a set tapped open (as at
 * 320 pt) draws the same tools line with the same styles.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import { SetLogger } from '../screens/client/active-workout/SetLogger';
import { makeStyles } from '../screens/client/active-workout/styles';

const colors = new Proxy({}, { get: () => '#000000' }) as never;

type Node = { type: unknown; props: Record<string, unknown>; parent: Node | null; children: (Node | string)[] };
function hostViewsAbove(node: Node, count: number): Node[] {
  const out: Node[] = [];
  let at = node.parent;
  while (at && out.length < count) {
    if (at.type === 'View') out.push(at);
    at = at.parent;
  }
  return out;
}

// The renders' numbers (100% text): the tools line's box per phone width.
const PHONES = [
  { phone: 390, left: 45, right: 355 },
  { phone: 360, left: 45, right: 325 },
  { phone: 320, left: 45, right: 285 },
];
const WORDS = 108.234375; // "Previous 150 × 6": both Texts and their gap
const ICON = 22; // the bin's trash-outline glyph (SetLogger.tsx)
const BIN = 44; // the bin's box in every render
const EPS = 0.01;

type Style = Record<string, unknown>;
type Len = number | 'auto' | undefined;

// Keys that draw but never move a box along the line.
const LOOK = /^(backgroundColor|color|opacity|overflow|zIndex|elevation|cursor|backfaceVisibility|borderStyle|borderCurve|border(Top|Bottom|Left|Right|Start|End)?Color|border(TopLeft|TopRight|BottomLeft|BottomRight|TopStart|TopEnd|BottomStart|BottomEnd)?Radius|shadow(Color|Offset|Opacity|Radius))$/;
// Keys that act only up and down on that view (the line is a row; the
// wrappers are its items and columns; the inners are column children).
const VERTICAL = ['minHeight', 'height', 'maxHeight', 'marginTop', 'marginBottom', 'marginVertical', 'paddingTop', 'paddingBottom', 'paddingVertical'];
const PADS = ['padding', 'paddingHorizontal', 'paddingLeft', 'paddingRight', 'paddingStart', 'paddingEnd'];
const MARGINS = ['margin', 'marginHorizontal', 'marginLeft', 'marginRight', 'marginStart', 'marginEnd'];
const HANDLED: Record<'line' | 'wrapper' | 'inner', string[]> = {
  line: [...VERTICAL, ...PADS, 'flexBasis', 'flexDirection', 'flexWrap', 'justifyContent', 'alignItems', 'alignContent', 'gap', 'columnGap', 'rowGap'],
  wrapper: [...VERTICAL, ...PADS, ...MARGINS, 'flexBasis', 'width', 'minWidth', 'maxWidth', 'flexGrow', 'flexShrink', 'alignSelf',
    'flexDirection', 'alignItems', 'justifyContent', 'gap', 'columnGap', 'rowGap', 'transform'],
  inner: [...VERTICAL, ...PADS, ...MARGINS, 'flexBasis', 'flexGrow', 'flexShrink', 'alignSelf', 'width', 'minWidth', 'maxWidth',
    'justifyContent', 'flexDirection', 'alignItems', 'gap', 'columnGap', 'rowGap'],
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

function len(v: unknown, of: number, name: string, bad: string[]): Len {
  if (v === undefined || v === null) return undefined;
  if (v === 'auto') return 'auto';
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && /^-?\d+(\.\d+)?%$/.test(v)) return (parseFloat(v) / 100) * of;
  bad.push(`${name} (${JSON.stringify(v)}): a value the model does not handle`);
  return undefined;
}
const edge = (s: Style, kind: 'margin' | 'padding', e: 'Left' | 'Right') =>
  s[`${kind}${e === 'Left' ? 'Start' : 'End'}`] ?? s[`${kind}${e}`] ?? s[`${kind}Horizontal`] ?? s[kind];
const pad = (s: Style, e: 'Left' | 'Right', of: number, name: string, bad: string[]) => {
  const v = len(edge(s, 'padding', e), of, `${name}.padding${e}`, bad);
  return typeof v === 'number' ? v : 0;
};
const numOr = (v: Len, d: number) => (typeof v === 'number' ? v : d);
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

type Item = { name: string; wrapper: Style; inner: Style; content: number };
type Placed = { name: string; box: { x: number; w: number }; textX: number };

// The inner's own width when nothing stretches it.
function innerOwn(it: Item, of: number, bad: string[]) {
  const s = it.inner;
  const w = len(s.width, of, `${it.name} inner.width`, bad);
  const own = typeof w === 'number' ? w : pad(s, 'Left', of, `${it.name} inner`, bad) + it.content + pad(s, 'Right', of, `${it.name} inner`, bad);
  const min = numOr(len(s.minWidth, of, `${it.name} inner.minWidth`, bad), 0);
  const max = numOr(len(s.maxWidth, of, `${it.name} inner.maxWidth`, bad), Infinity);
  return { own: clamp(own, min, max), min, max, fixedW: typeof w === 'number' };
}

// Inside the wrapper (a column): the inner along the cross axis (x).
function placeInner(it: Item, wx: number, ww: number, bad: string[]): Placed {
  const wr = it.wrapper;
  const s = it.inner;
  const dir = wr.flexDirection ?? 'column';
  if (dir !== 'column') bad.push(`${it.name} wrapper.flexDirection (${JSON.stringify(dir)}): the model handles a column`);
  const wpL = pad(wr, 'Left', ww, `${it.name} wrapper`, bad);
  const avail = ww - wpL - pad(wr, 'Right', ww, `${it.name} wrapper`, bad);
  const mL = len(edge(s, 'margin', 'Left'), avail, `${it.name} inner.marginLeft`, bad);
  const mR = len(edge(s, 'margin', 'Right'), avail, `${it.name} inner.marginRight`, bad);
  const fixedM = numOr(mL, 0) + numOr(mR, 0);
  const autos = (mL === 'auto' ? 1 : 0) + (mR === 'auto' ? 1 : 0);
  const self = s.alignSelf ?? 'auto';
  const align = self === 'auto' ? (wr.alignItems ?? 'stretch') : self;
  const { own, min, max, fixedW } = innerOwn(it, avail, bad);
  let x = numOr(mL, 0);
  let w = own;
  if (align === 'stretch' && !fixedW && autos === 0) {
    w = clamp(avail - fixedM, min, max);
  } else {
    const free = avail - w - fixedM;
    // An auto margin on the cross axis turns stretch off and takes the free space.
    if (autos > 0) x = mL === 'auto' ? Math.max(0, free) / autos : x;
    else if (align === 'center') x += free / 2;
    else if (align === 'flex-end') x += free;
    else if (!['flex-start', 'stretch', 'baseline'].includes(String(align))) bad.push(`${it.name} align (${JSON.stringify(align)}): a value the model does not handle`);
  }
  // The inner places its Texts along its own row: only justifyContent moves them.
  const ipL = pad(s, 'Left', avail, `${it.name} inner`, bad);
  const tFree = w - ipL - pad(s, 'Right', avail, `${it.name} inner`, bad) - it.content;
  const j = s.justifyContent ?? 'flex-start';
  const tOff = j === 'flex-start' || j === 'space-between' ? 0 : j === 'center' ? tFree / 2 : j === 'flex-end' ? tFree : NaN;
  if (Number.isNaN(tOff)) bad.push(`${it.name} inner.justifyContent (${JSON.stringify(j)}): a value the model does not handle`);
  const bx = wx + wpL + x;
  return { name: it.name, box: { x: bx, w }, textX: bx + ipL + (tOff || 0) };
}

// The tools line: one row of flex items (the HapticPressable wrappers).
function placeLine(line: Style, items: Item[], lineLeft: number, W: number, bad: string[]): Placed[] {
  if ((line.flexDirection ?? 'column') !== 'row') bad.push(`line.flexDirection (${JSON.stringify(line.flexDirection)}): the model handles a row`);
  // The line's own width is the set row's full width (what the renders measured).
  if (line.flexBasis !== '100%') bad.push(`line.flexBasis (${JSON.stringify(line.flexBasis)}): the model takes the line as the row's full width`);
  const pL = pad(line, 'Left', W, 'line', bad);
  const avail = W - pL - pad(line, 'Right', W, 'line', bad);
  const gap = numOr(len(line.columnGap ?? line.gap, avail, 'line.gap', bad), 0);
  const gaps = gap * Math.max(0, items.length - 1);
  const f = items.map((it) => {
    const s = it.wrapper;
    const mL = len(edge(s, 'margin', 'Left'), avail, `${it.name} wrapper.marginLeft`, bad);
    const mR = len(edge(s, 'margin', 'Right'), avail, `${it.name} wrapper.marginRight`, bad);
    const iM = (['Left', 'Right'] as const).reduce((a, e) => a + numOr(len(edge(it.inner, 'margin', e), avail, `${it.name} inner.margin${e}`, bad), 0), 0);
    const content = pad(s, 'Left', avail, `${it.name} wrapper`, bad) + innerOwn(it, avail, bad).own + iM + pad(s, 'Right', avail, `${it.name} wrapper`, bad);
    const fb = len(s.flexBasis, avail, `${it.name} wrapper.flexBasis`, bad);
    const basis = typeof fb === 'number' ? fb : numOr(len(s.width, avail, `${it.name} wrapper.width`, bad), content);
    const min = numOr(len(s.minWidth, avail, `${it.name} wrapper.minWidth`, bad), 0);
    const max = numOr(len(s.maxWidth, avail, `${it.name} wrapper.maxWidth`, bad), Infinity);
    return { it, mL, mR, basis, min, max, size: clamp(basis, min, max), grow: Number(s.flexGrow ?? 0), shrink: Number(s.flexShrink ?? 0) };
  });
  const fixedM = f.reduce((a, x) => a + numOr(x.mL, 0) + numOr(x.mR, 0), 0);
  const used0 = f.reduce((a, x) => a + x.size, 0) + fixedM + gaps;
  const wrap = line.flexWrap ?? 'nowrap';
  if (wrap !== 'nowrap' && !(wrap === 'wrap' && used0 <= avail + EPS)) bad.push(`line.flexWrap (${JSON.stringify(wrap)}): the items would wrap, which the model does not handle`);
  // Flexible lengths: grow when the items fit, else shrink; a clamped item freezes.
  const growing = used0 < avail;
  const factor = (i: number) => (growing ? f[i].grow : f[i].shrink * f[i].basis);
  const frozen = new Set(f.map((_, i) => i).filter((i) => factor(i) <= 0));
  for (let round = 0; round <= f.length && frozen.size < f.length; round++) {
    const open = f.map((_, i) => i).filter((i) => !frozen.has(i));
    const space = avail - fixedM - gaps - f.reduce((a, x, i) => a + (frozen.has(i) ? x.size : x.basis), 0);
    const total = open.reduce((a, i) => a + factor(i), 0);
    let clamped = false;
    for (const i of open) {
      const target = f[i].basis + (space * factor(i)) / total;
      f[i].size = clamp(target, f[i].min, f[i].max);
      if (f[i].size !== target) { frozen.add(i); clamped = true; }
    }
    if (!clamped) break;
  }
  let rest = avail - f.reduce((a, x) => a + x.size, 0) - fixedM - gaps;
  // An auto margin on the main axis gets only the space flexGrow leaves.
  const autos = f.reduce((a, x) => a + (x.mL === 'auto' ? 1 : 0) + (x.mR === 'auto' ? 1 : 0), 0);
  const auto = autos > 0 && rest > 0 ? rest / autos : 0;
  if (auto > 0) rest = 0;
  const n = f.length;
  const pos = Math.max(0, rest);
  const j = line.justifyContent ?? 'flex-start';
  const spread: Record<string, [number, number]> = {
    'flex-start': [0, 0],
    'flex-end': [rest, 0],
    center: [rest / 2, 0],
    'space-between': [0, n > 1 ? pos / (n - 1) : 0],
    'space-around': [pos / (2 * n), pos / n],
    'space-evenly': [pos / (n + 1), pos / (n + 1)],
  };
  if (!spread[String(j)]) bad.push(`line.justifyContent (${JSON.stringify(j)}): a value the model does not handle`);
  const [offset, between] = spread[String(j)] ?? [0, 0];
  let x = lineLeft + pL + offset;
  return f.map((it) => {
    x += it.mL === 'auto' ? auto : numOr(it.mL, 0);
    const placed = placeInner(it.it, x, it.size, bad);
    x += it.size + (it.mR === 'auto' ? auto : numOr(it.mR, 0)) + gap + between;
    return placed;
  });
}

const flat = (n: Node) => (StyleSheet.flatten(n.props.style as never) ?? {}) as Style;
const r = (v: number) => Math.round(v * 100) / 100;

it('B1: Previous keeps the left of the tools line under an open set; the bin sits right', async () => {
  const view = await render(
    <SetLogger set={{ weight: 155, reps: 6, completed: false }} setIdx={1} exIdx={0}
      onUpdate={() => undefined} onToggleComplete={() => undefined}
      colors={colors} styles={makeStyles(colors)} nextUp
      previous={{ weight: 150, reps: 6, completed: false }}
      onRemove={() => undefined} exerciseName="Bench press" />,
  );
  expect(view.getByLabelText('Remove set 2 from Bench press')).toBeTruthy();
  const prev = view.getByLabelText('Use previous set 2: 150 pounds, 6 reps') as unknown as Node;
  const bin = view.getByLabelText('Remove set 2 from Bench press') as unknown as Node;
  const [prevWrapper, line] = hostViewsAbove(prev, 2);
  const [binWrapper] = hostViewsAbove(bin, 1);
  const bad: string[] = [];
  const known = new Map<Node, Item>([
    [prevWrapper, { name: 'Previous', wrapper: flat(prevWrapper), inner: flat(prev), content: WORDS }],
    [binWrapper, { name: 'bin', wrapper: flat(binWrapper), inner: flat(bin), content: ICON }],
  ]);
  if (binWrapper.parent !== line) bad.push('the bin is not on the line that holds Previous');
  const kids = line.children.filter((c): c is Node => typeof c !== 'string');
  const items = kids.map((k) => known.get(k));
  if (items.some((it) => !it)) bad.push(`the line holds ${kids.length} views; the model knows Previous and the bin`);
  for (const [w, it] of known) {
    if (w.children.filter((c) => typeof c !== 'string').length !== 1) bad.push(`${it.name} wrapper holds more than its button`);
  }
  const lineStyle = flat(line);
  checkKeys('line', 'line', lineStyle, bad);
  for (const it of known.values()) {
    checkKeys(`${it.name} wrapper`, 'wrapper', it.wrapper, bad);
    checkKeys(`${it.name} inner`, 'inner', it.inner, bad);
  }
  // Main's lone Previous line starts the words at the line's left edge plus its own padding.
  const mainPad = Number(StyleSheet.flatten(makeStyles(colors).previousLine).paddingLeft);
  if (items.every(Boolean)) {
    for (const p of PHONES) {
      const placed = placeLine(lineStyle, items as Item[], p.left, p.right - p.left, bad);
      const P = placed.find((x) => x.name === 'Previous')!;
      const B = placed.find((x) => x.name === 'bin')!;
      const at = `${p.phone} pt (line ${p.left}-${p.right}; Previous box ${r(P.box.x)}-${r(P.box.x + P.box.w)}, words from ${r(P.textX)}; bin box ${r(B.box.x)}-${r(B.box.x + B.box.w)})`;
      if (Math.abs(P.textX - (p.left + mainPad)) > EPS) bad.push(`${at}: the "Previous" words start at ${r(P.textX)}; main's lone line starts them at ${p.left + mainPad}`);
      if (Math.abs(B.box.x + B.box.w - p.right) > EPS || Math.abs(B.box.w - BIN) > EPS) bad.push(`${at}: the bin's box is not the ${BIN} pt at the line's right end (${p.right - BIN}-${p.right})`);
      if (P.box.x < B.box.x + B.box.w - EPS && B.box.x < P.box.x + P.box.w - EPS) bad.push(`${at}: the Previous box and the bin's box overlap`);
    }
  }
  expect(bad).toEqual([]);
});
