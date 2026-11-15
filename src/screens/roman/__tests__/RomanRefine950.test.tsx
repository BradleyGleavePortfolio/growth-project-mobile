/**
 * REFINE-950 (fix round 4 on m#950, owner #203-E31: "another round heading towards the goal"): the hold menu and
 * the report sheet that the Roman room opens are drawn toward their GOAL frames, on Android at 390 pt / 100% and
 * at 320 x 568 / 130%, while the direct-message screens keep main's sheets exactly.
 *
 * GOAL frames (PNG, 2x of a 390 pt phone), on tgp-agent-context @ 2870199e under
 * handoffs/op-201/renders/ROMAN-HOLD-M/goal/:
 *   b05 = dm-menu__ctx-MOCKUP3-P3-b05.png (the people's chat hold menu)
 *   879 = report-sheet__ctx-renders-mobile-879-05.png (the people's report sheet)
 * Each number below quotes the 2x rows (r) or columns (c) it was read from; pt = px / 2.
 * The menu is the in-app Android sheet (iOS shows the native ActionSheetIOS, which takes no style).
 * The harness is RomanHold197.test.tsx's (mocked useRomanChat, the hold), with the icons drawn as host
 * elements so their size and colour can be read.
 */
import React from 'react';
import { AccessibilityInfo, Alert, Platform, StyleSheet } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import type { UseRomanChatResult } from '../useRomanChat';
import type { RomanMessage } from '../../../api/romanApi';
import { MessageActionSheet } from '../../../components/messaging/MessageActionSheet';
import { ReportMessageSheet } from '../../../components/messaging/ReportMessageSheet';

const mockWindow = { width: 390, height: 844, scale: 2, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => mockWindow }));
jest.mock('../../../storage/mmkv', () => ({
  ...jest.requireActual('../../../storage/mmkv'),
  cacheStorage: {
    getString: () => undefined,
    getStringAsync: async () => undefined,
    set: async () => undefined,
    delete: async () => undefined,
    getAllKeys: async () => [],
  },
}));
jest.mock('../../../services/api', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn(), delete: jest.fn() } }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));
const mockUseRomanChat = jest.fn();
jest.mock('../useRomanChat', () => ({ useRomanChat: (s: unknown) => mockUseRomanChat(s) }));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'client-1', firstName: 'Maya' }) }));
jest.mock('../../../hooks/useCoachlessClient', () => ({ useCoachlessClient: () => false }));
jest.mock('@react-navigation/native', () => ({
  NavigationContext: jest.requireActual('react').createContext({ goBack: jest.fn(), navigate: jest.fn() }),
}));
jest.mock('@expo/vector-icons', () => {
  const R = jest.requireActual('react');
  return { Ionicons: (p: Record<string, unknown>) => R.createElement('Ionicons', p) };
});
jest.mock('../../../components/roman/RomanAvatar', () => () => null);
jest.mock('../../../components/ai/useOpenSupport', () => ({ useOpenSupport: () => jest.fn() }));
jest.mock('../../../components/roman/RomanConsentGate', () => ({ children }: { children: React.ReactNode }) => children);

const RomanChatScreen = require('../RomanChatScreen').default;

type Node = { type: string; props: Record<string, any>; parent: Node | null; queryAll: (p: (n: Node) => boolean) => Node[] };
type R = Awaited<ReturnType<typeof render>>;
const flat = (n: Node): Record<string, unknown> => (StyleSheet.flatten(n.props.style) ?? {}) as Record<string, unknown>;
const icon = (row: Node) => row.queryAll((n) => n.type === 'Ionicons')[0].props;
const words = (row: Node) => row.queryAll((n) => n.type === 'Text')[0];

const REPLY = 'Keep Thursday easy: a 30-minute ride at a pace you could talk through. Save the hills for Saturday.';
const msgs = (): RomanMessage[] => [
  { id: 'u-1', role: 'user', content: 'Swap my Thursday run for a ride?', interrupted: false, createdAt: '2026-11-06T10:00:00Z' },
  { id: 'r-1', role: 'assistant', content: REPLY, interrupted: false, createdAt: '2026-11-06T10:00:05Z' },
];

const realOS = Platform.OS;
beforeAll(() => Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' }));
afterAll(() => Object.defineProperty(Platform, 'OS', { configurable: true, get: () => realOS }));

let state: UseRomanChatResult;
beforeEach(() => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  state = {
    phase: 'ready', session: null, isFirstOpen: false, messages: msgs(),
    sending: false, sendError: null, nextCursor: null, loadingOlder: false,
    reload: jest.fn(), loadOlder: jest.fn(), clearSendError: jest.fn(),
    send: jest.fn(async () => 'sent' as const),
  };
  mockUseRomanChat.mockImplementation(() => state);
});
afterEach(() => jest.restoreAllMocks());

const openMenu = async (): Promise<{ r: R; sheet: Node; backdrop: Node }> => {
  const r = await render(<RomanChatScreen surface="client" />);
  await act(async () => { fireEvent(r.getByTestId('roman-message-r-1-reply'), 'longPress'); });
  const backdrop = r.getByLabelText('Close menu') as unknown as Node;
  const sheet = backdrop.queryAll((n) => n !== backdrop && n.type === 'View')[0];
  return { r, sheet, backdrop };
};
const openReport = async (): Promise<R> => {
  const { r } = await openMenu();
  await act(async () => { fireEvent.press(r.getByLabelText('Report Message')); });
  return r;
};

const SIZES = [
  { name: '390 pt, 100%', width: 390, height: 844, fontScale: 1 },
  { name: '320 x 568, 130%', width: 320, height: 568, fontScale: 1.3 },
];

describe.each(SIZES)('Roman room, Android, $name: the hold menu toward dm-menu P3 b05', (size) => {
  beforeEach(() => Object.assign(mockWindow, { width: size.width, height: size.height, fontScale: size.fontScale }));

  it('M-1/M-2/M-9: the sheet is the GOAL\'s bgSurface #FFFDF8 with 24 pt top corners and 34 pt under Cancel', async () => {
    // b05 c390 r1226-1360 #FFFDF8; corner: r1205 starts at c27, 5 px under the top at r1200 -> radius 48 px;
    // under Cancel: Cancel's row ends r1619 (centre r1575.5 + 44 px), the frame ends r1687 -> 34 pt.
    const { sheet } = await openMenu();
    expect(flat(sheet)).toMatchObject({
      backgroundColor: '#FFFDF8', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 8, paddingBottom: 34,
    });
  });

  it('M-3: a 36 x 5 pt sageLine grab 8 pt under the top and 10 pt above the first line', async () => {
    // b05 r1220: c354-425 #CDDBD1 (72 px); c390 r1216-1225 (10 px) #C9D8CD, sheet top r1200 -> 8 pt (paddingTop).
    const { r } = await openMenu();
    expect(flat(r.getByTestId('message-sheet-grab') as unknown as Node)).toMatchObject({
      width: 36, height: 5, borderRadius: 3, alignSelf: 'center', marginBottom: 10, backgroundColor: '#C9D8CD',
    });
  });

  it('M-7: the top line sits left at the title\'s 20 pt inset, with no side padding of its own', async () => {
    // b05 title band r1265-1308 starts at c39 (19.5 pt); the sheet's 20 pt inset holds it.
    const { sheet } = await openMenu();
    const preview = sheet.queryAll((n) => n.type === 'Text' && n.props.numberOfLines === 2)[0];
    expect(flat(sheet).paddingHorizontal).toBe(20);
    expect(flat(preview)).toMatchObject({ textAlign: 'left', paddingHorizontal: 0, paddingVertical: 0, marginBottom: 8 });
  });

  it('M-4: rows 48 pt tall at the 20 pt inset with a 16 pt gap and 22 pt forest icons', async () => {
    // b05 rows: Report band r1355-1390, Block r1450-1486 -> pitch 95.5 px (48 pt); icons at c44-52 (22 pt from the
    // edge), flag strokes #2C4A36 at c60 r1356-1373; words start c113 (57 pt = 20 + 22 + 16 less the glyph bearing).
    const { r } = await openMenu();
    for (const label of ['Reply', 'Copy', 'Report Message']) {
      const row = r.getByLabelText(label) as unknown as Node;
      expect(flat(row)).toMatchObject({ minHeight: 48, paddingHorizontal: 0, paddingVertical: 0, gap: 16 });
      expect(icon(row)).toMatchObject({ size: 22, color: '#2C4A36' });
    }
  });

  it('M-5: Report reads in ink with a forest flag, as the GOAL\'s report row does (not red)', async () => {
    // b05 c60 r1356-1373 flag #2C4A36; "Report this content" glyphs #1A1A18 (r1364 c114-130).
    const { r } = await openMenu();
    const row = r.getByLabelText('Report Message') as unknown as Node;
    expect(flat(words(row)).color).toBe('#1A1A18');
    expect(icon(row).color).toBe('#2C4A36');
  });

  it('M-6: Cancel is a 44 pt centred text row in forest 600 with no fill, 8 pt under the rows', async () => {
    // b05 c390 r1570-1573 #2C4A36 (Cancel's glyphs, band r1564-1587) on the sheet's own #FFFDF8: no pill;
    // last row centre r1468 -> Cancel centre r1575.5 = 53.75 pt = 24 + 8 + 22.
    const { sheet } = await openMenu();
    const text = sheet.queryAll((n) => n.type === 'Text' && n.props.children === 'Cancel')[0];
    expect(flat(text)).toMatchObject({ color: '#2C4A36', fontWeight: '600', fontSize: 16 });
    expect(flat(text.parent as Node)).toMatchObject({
      minHeight: 44, marginTop: 8, paddingVertical: 0, justifyContent: 'center', alignItems: 'center', backgroundColor: 'transparent',
    });
  });

  it('M-8: the scrim is ink at 0.45 (voiceShades.scrim), the mockups\' scrim, not black', async () => {
    // b05 c390 r1150-1194 #989793 over the chat: a warm grey; black at 0.45 on bone draws #888A88.
    const { backdrop } = await openMenu();
    expect(flat(backdrop).backgroundColor).toBe('rgba(26, 26, 24, 0.45)');
  });
});

describe.each(SIZES)('Roman room, Android, $name: the report sheet toward mobile-879-05', (size) => {
  beforeEach(() => Object.assign(mockWindow, { width: size.width, height: size.height, fontScale: size.fontScale }));
  const LABELS = ['Spam', 'Harassment or bullying', 'Sexual content', 'Hate speech', 'Violence or threats',
    'Self-harm or suicide', 'Misinformation', 'Something else'];

  it('R-1: the sheet\'s body is white', async () => {
    // 879 c390 r348-363, r374-393 #FFFFFF (the sheet), c30 r352-1687 #FFFFFF.
    const r = await openReport();
    const body = (r.getByLabelText('Close report sheet') as unknown as Node).parent!.parent as Node;
    expect(flat(body).backgroundColor).toBe('#FFFFFF');
  });

  it('R-2: the message card is white with a 1 pt hairline, 16 pt corners and 8/12 padding', async () => {
    // 879 c390: card edges r394-395 and r500-501 #E2E6E1 (1 pt), fill #FFFFFF between; SafetyMenu .bquote 16 corners, 8 12.
    const r = await openReport();
    const card = (r.getByText('Message') as unknown as Node).parent as Node;
    expect(flat(card)).toMatchObject({
      backgroundColor: '#FFFFFF', borderColor: '#E2E6E1', borderWidth: 1, borderRadius: 16, paddingVertical: 8, paddingHorizontal: 12,
    });
  });

  it('R-3/R-5: "Why are you reporting this?" is 600 18/23 ink, 6 pt above rows that touch', async () => {
    // 879 c390 r545-546 #1B1B19 (the heading's glyphs); the first row ends at its hairline r678, 96 px (48 pt) under
    // the heading's box + 6 pt; rows meet at the hairlines r678, r774 ... r1158 with no space between.
    const r = await openReport();
    const heading = r.getByText('Why are you reporting this?') as unknown as Node;
    expect(flat(heading)).toMatchObject({ fontSize: 18, lineHeight: 23, fontWeight: '600', color: '#1A1A18', marginBottom: 6 });
    const list = r.getByTestId('report-sheet-reasons') as unknown as Node;
    expect(flat(list).gap).toBe(0);
    expect((r.getByLabelText('Spam') as unknown as Node).parent).toBe(list);
  });

  it('R-4: reason rows are 48 pt, unfilled, with a 1 pt hairline between them and 16/21 ink words', async () => {
    // 879 c390: hairlines #E2E6E1 at r678, r774, r870, r966, r1062, r1158 (pitch 96 px), white between; no row fill
    // or corner; words 16/21 ink (SafetyMenu .srow).
    const r = await openReport();
    LABELS.forEach((label, i) => {
      const row = r.getByLabelText(label) as unknown as Node;
      expect(flat(row)).toMatchObject({
        minHeight: 48, paddingVertical: 6, paddingHorizontal: 0, borderRadius: 0, borderWidth: 0,
        backgroundColor: 'transparent', borderBottomWidth: i < LABELS.length - 1 ? 1 : 0,
      });
      if (i < LABELS.length - 1) expect(flat(row).borderBottomColor).toBe('#E2E6E1');
      expect(flat(words(row))).toMatchObject({ fontSize: 16, lineHeight: 21, color: '#1A1A18' });
    });
    await act(async () => { fireEvent.press(r.getByLabelText('Misinformation')); });
    const picked = r.getByLabelText('Misinformation') as unknown as Node;
    expect(flat(picked).borderBottomColor).toBe('#E2E6E1');
    expect(flat(words(picked))).toMatchObject({ color: '#2C4A36', fontWeight: '600' });
  });

  it('R-6: the emergency note, when shown, is the GOAL\'s leaf-wash box', async () => {
    // 879 c390: box edge r1372-1373 and r1542-1543 #D3E2B8, fill #EEF4E2 r1374-1541 (86 pt with the edge); 14/20 ink.
    const r = await openReport();
    await act(async () => { fireEvent.press(r.getByLabelText('Violence or threats')); });
    expect(flat(r.getByTestId('report-emergency-note') as unknown as Node)).toMatchObject({
      backgroundColor: '#EEF4E2', borderColor: '#D3E2B8', borderWidth: 1, borderRadius: 16,
      paddingVertical: 12, paddingHorizontal: 14, fontSize: 14, lineHeight: 20, color: '#1A1A18', marginTop: 10,
    });
  });
});

/**
 * The direct-message promise: MessagesScreen.tsx:989/:1001 and ClientMessagesScreen.tsx:536/:548 render these two
 * sheets with no look prop (canReply false, canReport by sender). Every style value below is read from
 * MessageActionSheet.tsx and ReportMessageSheet.tsx at 17bf7e3f95dc25c5850161a3fcb51b352af2749c with the light theme.
 */
describe('the direct-message sheets keep main\'s look (no look prop)', () => {
  it('MessageActionSheet: every drawn value as at 17bf7e3f', async () => {
    const r = await render(
      <MessageActionSheet visible messagePreview="See you Thursday" onReply={jest.fn()} onCopy={jest.fn()}
        onReport={jest.fn()} onClose={jest.fn()} canReport canReply={false} />,
    );
    const backdrop = r.getByLabelText('Close menu') as unknown as Node;
    const sheet = backdrop.queryAll((n) => n !== backdrop && n.type === 'View')[0];
    expect(flat(backdrop)).toEqual({ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' });
    expect(flat(sheet)).toEqual({
      backgroundColor: '#F1E8D5', borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingTop: 8, paddingBottom: 36, paddingHorizontal: 8,
    });
    expect(r.queryByTestId('message-sheet-grab')).toBeNull();
    expect(flat(r.getByText('See you Thursday') as unknown as Node)).toEqual({
      fontSize: 12, color: '#6B675F', paddingVertical: 10, paddingHorizontal: 12, textAlign: 'center',
    });
    const rowStyle = { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 12 };
    const copy = r.getByLabelText('Copy') as unknown as Node;
    const report = r.getByLabelText('Report Message') as unknown as Node;
    expect(flat(copy)).toEqual(rowStyle);
    expect(flat(report)).toEqual(rowStyle);
    expect(icon(copy)).toMatchObject({ name: 'copy-outline', size: 20, color: '#1A1A18' });
    expect(icon(report)).toMatchObject({ name: 'flag-outline', size: 20, color: '#B91C1C' });
    expect(flat(words(copy))).toEqual({ fontSize: 16, color: '#1A1A18' });
    expect(flat(words(report))).toEqual({ fontSize: 16, color: '#B91C1C' });
    const cancel = r.getByText('Cancel') as unknown as Node;
    expect(flat(cancel)).toEqual({ fontSize: 16, color: '#1A1A18', fontWeight: '600' });
    expect(flat(cancel.parent as Node)).toEqual({
      marginTop: 8, paddingVertical: 14, paddingHorizontal: 16, alignItems: 'center', borderRadius: 12, backgroundColor: '#F7FAF7',
    });
    expect(r.queryByLabelText('Reply')).toBeNull();
  });

  it('ReportMessageSheet: every drawn value as at 17bf7e3f', async () => {
    const onSubmit = jest.fn(async () => { throw new Error('offline'); });
    const r = await render(<ReportMessageSheet visible messagePreview="See you Thursday" onSubmit={onSubmit} onClose={jest.fn()} />);
    const close = r.getByLabelText('Close report sheet') as unknown as Node;
    const header = close.parent as Node;
    const body = header.parent as Node;
    expect(flat(body)).toEqual({ flex: 1, backgroundColor: '#F7FAF7' });
    expect(flat(header)).toEqual({
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16,
      paddingTop: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#DCD5CC',
    });
    expect(flat(r.getByText('Report Message') as unknown as Node)).toEqual({ fontSize: 16, fontWeight: '600', color: '#1A1A18' });
    const scroll = body.queryAll((n) => n.type === 'RCTScrollView')[0];
    expect(StyleSheet.flatten(scroll.props.contentContainerStyle)).toEqual({ padding: 20, gap: 12 });
    expect(r.queryByTestId('report-sheet-reasons')).toBeNull();
    expect(flat(r.getByText(/^Reports are reviewed/) as unknown as Node)).toEqual({ fontSize: 13, color: '#3D3D3A', lineHeight: 18 });
    const label = r.getByText('Message') as unknown as Node;
    expect(flat(label.parent as Node)).toEqual({
      backgroundColor: '#F1E8D5', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#DCD5CC', gap: 4,
    });
    expect(flat(label)).toEqual({ fontSize: 11, color: '#6B675F', fontWeight: '600' });
    expect(flat(r.getByText('See you Thursday') as unknown as Node)).toEqual({ fontSize: 14, color: '#1A1A18', lineHeight: 20 });
    const section = { fontSize: 13, color: '#3D3D3A', fontWeight: '600', marginTop: 8 };
    expect(flat(r.getByText('Why are you reporting this?') as unknown as Node)).toEqual(section);
    expect(flat(r.getByText('More details (optional)') as unknown as Node)).toEqual(section);
    const option = {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, paddingHorizontal: 14,
      borderRadius: 10, backgroundColor: '#F1E8D5', borderWidth: 1, borderColor: '#DCD5CC',
    };
    const spam = r.getByLabelText('Spam') as unknown as Node;
    expect(flat(spam)).toEqual(option);
    expect(flat(words(spam))).toEqual({ fontSize: 14, color: '#1A1A18' });
    const stub = spam.queryAll((n) => n.type === 'View' && n !== spam)[0];
    expect(flat(stub)).toEqual({ width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: '#DCD5CC' });
    expect(flat(r.getByLabelText('Additional details') as unknown as Node)).toEqual({
      minHeight: 100, borderWidth: 1, borderColor: '#DCD5CC', borderRadius: 10, padding: 12, fontSize: 14,
      color: '#1A1A18', backgroundColor: '#F1E8D5', textAlignVertical: 'top',
    });
    expect(flat(r.getByText('0/1000') as unknown as Node)).toEqual({ fontSize: 11, color: '#6B675F', alignSelf: 'flex-end' });
    const submit = r.getByLabelText('Submit report') as unknown as Node;
    const button = { paddingVertical: 14, borderRadius: 10, alignItems: 'center' };
    expect(flat(submit)).toEqual({ ...button, backgroundColor: '#DCD5CC' });
    expect(flat(submit.parent as Node)).toEqual({ padding: 16, borderTopWidth: 1, borderTopColor: '#DCD5CC', backgroundColor: '#F1E8D5' });
    expect(flat(r.getByText('Submit Report') as unknown as Node)).toEqual({ color: '#F7FAF7', fontSize: 15, fontWeight: '600' });
    await act(async () => { fireEvent.press(r.getByLabelText('Violence or threats')); });
    const picked = r.getByLabelText('Violence or threats') as unknown as Node;
    expect(flat(picked)).toEqual({ ...option, borderColor: '#2C4A36' });
    expect(flat(words(picked))).toEqual({ fontSize: 14, color: '#2C4A36', fontWeight: '600' });
    expect(flat(r.getByTestId('report-emergency-note') as unknown as Node)).toEqual({
      fontSize: 13, color: '#1A1A18', lineHeight: 18, fontWeight: '600',
    });
    expect(flat(r.getByLabelText('Submit report') as unknown as Node)).toEqual({ ...button, backgroundColor: '#2C4A36' });
    await act(async () => { fireEvent.press(r.getByLabelText('Submit report')); });
    expect(flat(r.getByTestId('report-sheet-error') as unknown as Node)).toEqual({ color: '#B91C1C', fontSize: 13, marginTop: 8 });
  });
});
