/**
 * C1-935-FOLLOWUPS-M (agent 203), class-first [R24]: on the coach Messages drafts card (K2 Style B), the one ring whose
 * only job is to mark Roman draws Roman's gold, colors.romanAccent (#C9A961), on every side, as every K2 B_inbox
 * drawing does (measured ΔE76 0.0 to 1.2), side by side and stacked (320 pt at 130%). Nothing else under the card is
 * bordered but the kind chips, and nothing else reads the dark bronze gold[700] (LO-970R1 N5: a per-side colour or an
 * outer unpadded ring must fail here). Member rows (a, b) are red while the ring reads gold[700]; control rows hold.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000000' }), semanticColors: jest.requireActual('../../../theme/tokens').lightTokens }),
}));
const mockDrafts = jest.fn();
jest.mock('../../../hooks/usePendingAiDrafts', () => ({
  COACH_AI_PENDING_DRAFTS_QUERY_KEY: ['coach', 'ai', 'pending-drafts'],
  usePendingAiDrafts: (o: unknown) => mockDrafts(o),
}));
const mockPathDrafts = jest.fn();
jest.mock('../../../api/copilotApi', () => {
  const actual = jest.requireActual('../../../api/copilotApi');
  return { ...actual, copilotApi: { ...actual.copilotApi, pathChangeDrafts: () => mockPathDrafts() } };
});
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), canGoBack: () => true }),
  useIsFocused: () => true,
}));
let mockWidth = 390;
let mockFontScale = 1;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: mockWidth, height: 844, scale: 3, fontScale: mockFontScale }),
}));

import { RomanDraftsHero } from '../inboxStyleB';
import { coachInboxB as B, colors, gold, radius } from '../../../theme/tokens';
import type { AiActionDraftRow } from '../../../api/types/coachAiExecution';

const row = (id: string, capability: string) => ({ id, capability, status: 'pending', payload: {} }) as unknown as AiActionDraftRow;
const queue = [row('d1', 'draft.assign_workout'), row('d2', 'draft.assign_workout'), row('d3', 'draft.send_notification')];

type Node = { type?: string; props?: Record<string, unknown>; children?: Array<Node | string> | null };
const style = (n: Node) => (StyleSheet.flatten(n.props?.style as never) ?? {}) as Record<string, unknown>;
const all = (node: Node | string | null | undefined, out: Node[] = []): Node[] => {
  if (!node || typeof node === 'string') return out;
  out.push(node);
  (node.children ?? []).forEach((c) => all(c, out));
  return out;
};
const texts = (n: Node): string[] => all(n).flatMap((x) => (x.children ?? []).filter((c): c is string => typeof c === 'string'));
const borderWidths = (n: Node) => Object.entries(style(n)).filter(([k, v]) => /^border.*Width$/.test(k) && typeof v === 'number' && v > 0);
/** Every border colour key set on a node (borderColor, borderTopColor, ... borderStartColor, borderEndColor). */
const borderColours = (n: Node) => Object.entries(style(n)).filter(([k, v]) => /^border.*Color$/.test(k) && v !== undefined);
const isPortrait = (n: Node) => n.props?.source !== undefined;

let client: QueryClient;
async function draw(width: number, fontScale: number) {
  mockWidth = width;
  mockFontScale = fontScale;
  const view = await render(<QueryClientProvider client={client}><RomanDraftsHero /></QueryClientProvider>);
  return view;
}
async function card(width: number, fontScale: number) {
  const view = await draw(width, fontScale);
  await view.findByTestId('inbox-roman-drafts');
  const root = all(view.toJSON() as Node).find((n) => n.props?.testID === 'inbox-roman-drafts') as Node;
  const nodes = all(root);
  // The ring: the node whose own child is Roman's portrait image.
  const rings = nodes.filter((n) => (n.children ?? []).some((c) => typeof c !== 'string' && isPortrait(c)));
  return { view, root, nodes, rings };
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mockPathDrafts.mockReset().mockResolvedValue([]);
  mockDrafts.mockReset().mockReturnValue({ data: { drafts: queue } });
});
afterEach(() => client.clear());

const LAYOUTS = [
  ['side by side, 390 pt at 100%', 390, 1],
  ['stacked, 320 pt at 130%', 320, 1.3],
] as const;

describe('C1-935-FOLLOWUPS-M: Roman\'s ring on the coach drafts card is Roman\'s gold', () => {
  it('colors.romanAccent is still Roman\'s drawn gold, and gold[700] the dark bronze', () => {
    expect(colors.romanAccent).toBe('#C9A961');
    expect(gold[700]).toBe('#8A6A2A');
  });

  it.each(LAYOUTS)('member (a, b): %s, every border colour on the ring is colors.romanAccent', async (_n, width, fontScale) => {
    const { rings } = await card(width, fontScale);
    expect(rings).toHaveLength(1);
    const ring = rings[0];
    expect(style(ring)).toMatchObject({ borderWidth: 2, padding: 2 });
    const set = borderColours(ring);
    expect(set.map(([k]) => k)).toContain('borderColor');
    expect(Object.fromEntries(set)).toEqual(Object.fromEntries(set.map(([k]) => [k, '#C9A961'])));
    expect(Object.fromEntries(set)).toEqual(Object.fromEntries(set.map(([k]) => [k, colors.romanAccent])));
  });

  it.each(LAYOUTS)('class (c): %s, the only bordered nodes are the ring and the kind chips; nothing else reads gold[700]', async (_n, width, fontScale) => {
    const { nodes, rings } = await card(width, fontScale);
    const others = nodes.filter((n) => !rings.includes(n));
    const bordered = others.filter((n) => borderWidths(n).length > 0);
    expect(bordered.map((n) => texts(n).join(' '))).toEqual(['2 Workouts', '1 Nudge']);
    for (const chip of bordered) {
      expect(borderColours(chip).map(([, v]) => v)).toEqual([B.onDeepMuted]);
    }
    const bronze = others.filter((n) => Object.values(style(n)).some((v) => typeof v === 'string' && v.toUpperCase() === gold[700]));
    expect(bronze).toEqual([]);
  });

  it.each(LAYOUTS)('control (d): %s, the card, ring geometry, portrait and words are as main has them', async (_n, width, fontScale) => {
    const { root, rings, view } = await card(width, fontScale);
    expect(style(root).backgroundColor).toBe(B.deep);
    expect(style(rings[0])).toMatchObject({ borderWidth: 2, padding: 2, borderRadius: radius.chip });
    const portraits = all(rings[0]).filter(isPortrait);
    expect(portraits.map((p) => [style(p).width, style(p).height])).toEqual([[44, 44]]);
    expect(texts(root)).toEqual(['Roman has 3 drafts ready', '2 Workouts', '1 Nudge', "Approve Roman's drafts →"]);
    const btn = view.getByTestId('inbox-drafts-open');
    expect(StyleSheet.flatten(btn.props.style).backgroundColor).toBe(B.onDeep);
  });

  it('control (d): no draft waiting gives no card', async () => {
    mockDrafts.mockReturnValue({ data: { drafts: [] } });
    const view = await draw(390, 1);
    expect(view.queryByTestId('inbox-roman-drafts')).toBeNull();
  });
});
