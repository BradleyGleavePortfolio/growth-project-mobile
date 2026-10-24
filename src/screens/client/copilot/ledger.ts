/**
 * The Forest ledger card (style A, owner #162-1; GOAL index section 6): every Copilot card is white with the cool
 * hairline, on the bone page. One scoped surface variant, so the history, the answers, the suggestion and the ask
 * block all read as one family.
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
  /** A declined change's chip (GOAL .ot.no). */
  still: '#F2F2EE',
  /** Dates, month headings and fact labels (GOAL #5A5A56). */
  muted: '#5A5A56',
  /** Answer and notice body text (GOAL .ans .body, .stc p). */
  ink: '#2E2E2B',
  /** Back on the forest masthead (GOAL .nav). */
  nav: brand[100],
} as const;

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
});
