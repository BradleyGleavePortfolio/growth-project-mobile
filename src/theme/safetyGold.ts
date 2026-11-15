/**
 * Safety gold (owner #197-E3, 11-04: "lets go with the proposed gold for the buttons/safety status").
 * The urgent, eating-disorder and crisis alerts (#169-1, #169-6) on the app's #F7FAF7 page (#196-D13, #197-E6).
 * Proposal drawn in TAN-MOCK (ctx#441, third panel): edge 6.30:1 on the page; chip words 7.21:1 on the chip.
 * Shared byte for byte by NEEDS-YOU-M (m#934) and SAFETY-GOLD-M; change it only in one PR after both merge.
 */
import { gold } from './tokens';

export const safetyGold = {
  /** Card edge and the count box ring of a safety alert. */
  edge: gold[800],
  /** The Safety chip's fill. */
  chipFill: gold[800],
  /** Words and shield on the Safety chip. */
  chipText: '#FFF8EC',
  /** A safety alert card's fill. */
  card: '#FFF8EC',
  /** The "Safety alert" mark on a white or #FFF8EC card. */
  text: gold[800],
} as const;
