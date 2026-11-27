/**
 * SC-M4 (agent 203), case T11: the "+" (GOAL VOICE-B 05b .cbtn) and its sheet "Add to your message" (GOAL C6CHAT-S-V2
 * c05 cut to Photo library, R2), in SpaceMessageSheet's build. The keyboard goes first; the title is a header and takes
 * the screen reader's focus; one row and Cancel; Close, Cancel, escape and back start nothing; on iOS the pick starts
 * only once the sheet has gone (the Modal's onDismiss), on Android at once. The photo module stands in (its busy flag).
 */
import React from 'react';
import { AccessibilityInfo, Keyboard, Platform, StyleSheet } from 'react-native';
import { act, fireEvent, render, within } from '@testing-library/react-native';

const mockBusy = { current: false };
jest.mock('../spaceChatPhotos', () => ({ spacePhotoBusy: () => mockBusy.current }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 47, right: 0, bottom: 34, left: 0 }) }));
const mockSelection = jest.fn(async () => undefined);
jest.mock('../../../../ui/haptics/haptics.service', () => ({ HapticService: { selection: () => mockSelection() } }));

import SpaceChatPlus from '../SpaceChatPlus';
import { forestPop as fp } from '../../../../theme/tokens';

const realOS = Platform.OS;
const setOS = (os: string) => Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
let dismiss: jest.SpyInstance;
let onPick: jest.Mock;
beforeEach(() => {
  mockBusy.current = false;
  mockSelection.mockClear();
  onPick = jest.fn();
  dismiss = jest.spyOn(Keyboard, 'dismiss');
});
afterEach(() => { dismiss.mockRestore(); setOS(realOS); });

const mount = () => render(<SpaceChatPlus onPick={onPick} />);
type R = Awaited<ReturnType<typeof mount>>;
const modalOf = (r: R) => {
  let node = r.getByTestId('space-chat-add-sheet') as unknown as { props: Record<string, unknown>; parent: unknown } | null;
  while (node && typeof node.props.onDismiss !== 'function') node = node.parent as typeof node;
  if (!node) throw new Error('no Modal');
  return node.props as { onDismiss: () => void; onRequestClose: () => void; onShow: () => void; visible: boolean };
};
const openSheet = async (r: R) => {
  await fireEvent.press(r.getByTestId('space-chat-plus'));
  return modalOf(r);
};

describe('SCM4 T11: the + and the pop-up', () => {
  it('SCM4 T11: the + is a 44 pt button "Add a photo", a 24 pt plus of two 2 pt forest strokes and no disc', async () => {
    const r = await mount();
    const plus = r.getByTestId('space-chat-plus');
    expect(plus.props.accessibilityRole).toBe('button');
    expect(plus.props.accessibilityLabel).toBe('Add a photo');
    const box = StyleSheet.flatten(plus.props.style);
    expect([box.width, box.height]).toEqual([44, 44]);
    expect(box.backgroundColor).toBeUndefined();
    const glyph = plus.children[0] as unknown as { props: { style: unknown }; children: Array<{ props: { style: unknown } }> };
    expect(StyleSheet.flatten(glyph.props.style)).toEqual(expect.objectContaining({ width: 24, height: 24 }));
    const strokes = glyph.children.map((c) => StyleSheet.flatten(c.props.style));
    expect(strokes.map((st) => [st.width, st.height, st.backgroundColor])).toEqual([[16, 2, fp.forest], [2, 16, fp.forest]]);
    expect(r.queryByTestId('space-chat-add-sheet')).toBeNull();
  });

  it('SCM4 T11: a tap puts the keyboard away first, then opens the sheet: the title (a header), one row and Cancel', async () => {
    const r = await mount();
    await openSheet(r);
    expect(dismiss).toHaveBeenCalledTimes(1);
    const sheet = r.getByTestId('space-chat-add-sheet');
    expect(sheet.props.accessibilityViewIsModal).toBe(true);
    const title = within(sheet).getByTestId('space-chat-add-title');
    expect(title.props.children).toBe('Add to your message');
    expect(title.props.accessibilityRole).toBe('header');
    expect(StyleSheet.flatten(title.props.style)).toEqual(expect.objectContaining({ fontSize: 18 }));
    const buttons = within(sheet).getAllByRole('button');
    expect(buttons.map((b) => b.props.accessibilityLabel)).toEqual(['Photo library', 'Cancel']);
    expect(StyleSheet.flatten(r.getByTestId('space-chat-add-library').props.style).minHeight).toBe(48);
    expect(StyleSheet.flatten(r.getByTestId('space-chat-add-cancel').props.style).minHeight).toBe(44);
    // The scrim sits outside the modal sheet (accessibilityViewIsModal): hidden from a screen reader, its way out is escape.
    expect(r.getByLabelText('Close', { includeHiddenElements: true }).props.accessibilityRole).toBe('button');
  });

  it('SCM4 T11: the title takes the screen reader\'s focus when the sheet shows', async () => {
    const focus = jest.spyOn(AccessibilityInfo, 'setAccessibilityFocus').mockImplementation(() => undefined);
    const handle = jest.spyOn(jest.requireActual<Record<string, unknown>>('react-native'), 'findNodeHandle', 'get').mockReturnValue(() => 42);
    try {
      const r = await mount();
      const modal = await openSheet(r);
      await act(async () => { modal.onShow(); });
      expect(focus).toHaveBeenCalledWith(42);
    } finally {
      focus.mockRestore();
      handle.mockRestore();
    }
  });

  it.each([
    ['the scrim\'s Close', (r: R) => fireEvent.press(r.getByTestId('space-chat-add-scrim', { includeHiddenElements: true }))],
    ['Cancel', (r: R) => fireEvent.press(r.getByTestId('space-chat-add-cancel'))],
    ['the escape gesture', (r: R) => act(async () => { (r.getByTestId('space-chat-add-sheet').props.onAccessibilityEscape as () => void)(); })],
    ['Android back', (r: R) => act(async () => { modalOf(r).onRequestClose(); })],
  ])('SCM4 T11: %s closes the sheet and starts nothing', async (_n, out) => {
    const r = await mount();
    const modal = await openSheet(r);
    await out(r);
    expect(r.queryByTestId('space-chat-add-sheet')).toBeNull();
    await act(async () => { modal.onDismiss(); });
    expect(onPick).not.toHaveBeenCalled();
    expect(mockSelection).not.toHaveBeenCalled();
  });

  it('SCM4 T11: on iOS, Photo library gives a selection tick and starts the pick only once the sheet has gone', async () => {
    setOS('ios');
    const r = await mount();
    const modal = await openSheet(r);
    await fireEvent.press(r.getByTestId('space-chat-add-library'));
    expect(mockSelection).toHaveBeenCalledTimes(1);
    expect(r.queryByTestId('space-chat-add-sheet')).toBeNull();
    expect(onPick).not.toHaveBeenCalled();
    await act(async () => { modal.onDismiss(); });
    expect(onPick).toHaveBeenCalledTimes(1);
    await act(async () => { modal.onDismiss(); });
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it('SCM4 T11: on Android (no onDismiss), Photo library starts the pick at once', async () => {
    setOS('android');
    const r = await mount();
    await openSheet(r);
    await fireEvent.press(r.getByTestId('space-chat-add-library'));
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it('SCM4 T11: the sheet mounts on the first tap and opens again after a close', async () => {
    const r = await mount();
    expect(r.queryByTestId('space-chat-add-sheet')).toBeNull();
    const modal = await openSheet(r);
    await fireEvent.press(r.getByTestId('space-chat-add-cancel'));
    await act(async () => { modal.onDismiss(); });
    await openSheet(r);
    expect(r.getByTestId('space-chat-add-sheet')).toBeTruthy();
    expect(dismiss).toHaveBeenCalledTimes(2);
  });

  it('SCM4 T11: while a pick or its checks are up, a tap starts nothing', async () => {
    mockBusy.current = true;
    const r = await mount();
    await fireEvent.press(r.getByTestId('space-chat-plus'));
    expect(r.queryByTestId('space-chat-add-sheet')).toBeNull();
    expect(dismiss).not.toHaveBeenCalled();
  });
});
