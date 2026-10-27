/**
 * The Forest ledger card (style A, owner #162-1; GOAL index section 6): every Copilot card is white with the cool
 * hairline, on the bone page. One scoped surface variant, so the history, the answers, the suggestion and the ask
 * block all read as one family. `chip` is the leaf hairline of the quick chips under an answer (frame 03).
 *
 * ledgerType is style A's type for Copilot only (GOAL style_a.py; #852 round 3, B-H1). It never changes a global
 * token. Serif lines keep 1.25 x size or more (SERIF_MIN_LINE_RATIO: Cormorant clips on Android below it), and a
 * 600 serif is drawn at 500, the heaviest Cormorant the app loads.
 */
import { StyleSheet } from 'react-native';
import { SERIF_MIN_LINE_RATIO, brand, neutral } from '../../../theme/tokens';

export const ledger = {
  card: neutral[0],
  line: '#E6E9DF',
  chip: '#D2E2B4',
  /** A declined change's chip (GOAL .ot.no). */
  still: '#F2F2EE',
  /** An awaiting change's chip and status tile (GOAL .ot.wait, .stl .d.wait; Sol C-852R3-2). */
  wait: '#F7EFD6',
  /** Dates, month headings and fact labels (GOAL #5A5A56). */
  muted: '#5A5A56',
  /** Answer and notice body text (GOAL .ans .body, .stc p). */
  ink: '#2E2E2B',
  /** Back on the forest masthead (GOAL .nav). */
  nav: brand[100],
  /** The composer bar (GOAL .cmp). */
  bar: '#FFFDF8',
  /** A hairline between facts (GOAL .fact). */
  factLine: '#F0F2EA',
  /** The masthead's week tiles and their changed chip (GOAL .stat, .chg). */
  tile: 'rgba(255,255,255,0.06)',
  tileLine: 'rgba(184,204,191,0.2)',
  mini: 'rgba(255,255,255,0.08)',
  changed: '#A3C46A',
  changedInk: '#1A1A18',
  /** The new Your path row on More (GOAL .lrow.new). */
  rowNew: '#EEF4E0',
  rowNewIcon: brand[800],
} as const;

/** Style A's page gutter (GOAL --g): 20 on a phone 375 wide or more, 16 below it (Opus B-878-G2). */
export const ledgerGutter = (width: number) => (width < 375 ? 16 : 20);

const serif = (size: number) => ({ fontFamily: 'CormorantGaramond_500Medium', fontWeight: '500' as const, fontSize: size, lineHeight: Math.ceil(size * SERIF_MIN_LINE_RATIO) });
const sans = (size: number, lh: number, weight: '400' | '500' | '600' = '400') => ({
  fontFamily: weight === '600' ? 'Inter_600SemiBold' : weight === '500' ? 'Inter_500Medium' : 'Inter_400Regular',
  fontWeight: weight,
  fontSize: size,
  lineHeight: Math.round(size * lh),
});

export const ledgerType = StyleSheet.create({
  /** Compact masthead title (.mhs h1). */
  mastSmall: serif(25),
  /** Back on the masthead (.nav). */
  nav: sans(16, 1.35),
  /** A chip on the compact masthead (.mhs .mini span). */
  mini: sans(12.5, 1.35),
  /** A past question (.hrow .t) and its date (.hrow .t small). */
  row: sans(15, 1.35),
  small: sans(12.5, 1.35),
  /** A month heading (.hist .m). */
  month: sans(13, 1.35, '600'),
  /** An outcome chip (.ot). */
  outcome: sans(12, 1.35, '600'),
  /** A notice's title and body (.stc h3, .stc p), and an answer's body (.ans .body). */
  title: sans(17, 1.3, '600'),
  body: sans(15, 1.5),
  /** The masthead title (.mh h1). */
  mast: serif(34),
  /** The masthead's week line, tiles and changed chip (.mh .sub, .stat b, .stat span, .chg). */
  sub: sans(14, 1.35),
  stat: sans(21, 1.1, '600'),
  statLabel: sans(12, 1.25),
  changed: sans(11, 1.35, '600'),
  /** The question asked (.ask .who, .ask .q). */
  who: sans(12.5, 1.35),
  question: sans(18, 1.35, '600'),
  /** An answer (.ans .hd, .ans .lead) and its facts (.fy, .fact .t, .fact .t small, .tag). */
  head: sans(13, 1.35, '600'),
  lead: serif(24),
  factsLabel: sans(12.5, 1.35, '600'),
  fact: sans(14.5, 1.35),
  tag: sans(11.5, 1.35, '600'),
  /** A quick chip under an answer (.chip), and the composer's field (.cmp .in). */
  chip: sans(14.5, 1.35, '500'),
  field: sans(16, 1.35),
  /** A suggestion (.sug .lbl, .na, .sug h3, .pv, .lnk, .sentl). */
  label: sans(13, 1.35, '600'),
  badge: sans(11.5, 1.35, '600'),
  change: sans(19, 1.3, '600'),
  privacy: sans(13, 1.45),
  link: sans(15, 1.35, '500'),
  sent: sans(13.5, 1.35, '600'),
  /** Style A's one forest button (.btn: 16/600, min 52; Sol B-878-G). */
  button: sans(16, 1.35, '600'),
  /** A section heading (.sec h2) and a status row (.stl .t, .stl .s, .stl .d). */
  section: sans(15, 1.35, '600'),
  statusTitle: sans(15, 1.3, '600'),
  status: sans(13.5, 1.35, '500'),
  meta: sans(12.5, 1.35),
  /** Ask rows on Your path (.qrow) and the footer (.foot). */
  ask: sans(16, 1.3),
  /** The asked count beside Past questions (.qrow span, 14 #5A5A56; Opus B-852R3-1). */
  count: sans(14, 1.3),
  foot: sans(12, 1.4),
});
