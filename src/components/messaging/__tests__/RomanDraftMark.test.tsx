import React from 'react';
import { Animated, PanResponder, StyleSheet, type GestureResponderEvent, type PanResponderGestureState } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import MessageBubble from '../MessageBubble';
import { RomanDraftSheet } from '../RomanDraftSheet';
import { ROMAN_DRAFT_HINT } from '../RomanDraftMark';
import { bubbleV2Fields, readThreadV2Fields } from '../threadV2';
import { featureFlags } from '../../../config/featureFlags';
import { HapticService } from '../../../ui/haptics/haptics.service';

let mockReduced = false;
jest.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => mockReduced }));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ semanticColors: jest.requireActual('../../../theme/tokens').lightTokens }),
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 34 }) }));
jest.mock('../../../ui/haptics/haptics.service', () => ({
  HapticService: { selection: jest.fn(), softImpact: jest.fn() },
}));
const context = { coach: 'Sam', client: 'Jordan', isSender: false };
const base = { id: 'message', body: 'Keep the next run easy.', created_at: '2026-10-15T07:40:00Z' };
const cases: Array<[string, Record<string, unknown>, boolean]> = [
  ['draft', { ai_draft_id: 'draft' }, true],
  ['edited draft', { ai_draft_id: 'draft', edited_at: '2026-10-15T07:41:00Z' }, true],
  ['typed', {}, false],
  ['null id', { ai_draft_id: null }, false],
  ['voice', { ai_draft_id: 'draft', voice_url: 'voice.m4a' }, false],
  ['deleted', { ai_draft_id: 'draft', deleted: true }, false],
  ['legacy deleted', { ai_draft_id: 'draft', deleted_at: '2026-10-15T07:41:00Z' }, false],
  ['client authored', { ai_draft_id: 'draft', sender_role: 'client' }, false],
  ['reply quote only', { reply_to: { id: 'parent', kind: 'text', preview: 'Quote', ai_draft_id: 'draft' } }, false],
];
beforeEach(() => {
  featureFlags.romanDraftMark = true;
  mockReduced = false;
  jest.clearAllMocks();
  jest.spyOn(PanResponder, 'create');
  jest.spyOn(Animated, 'timing').mockImplementation(() => ({
    start: (done) => done?.({ finished: true }), stop: jest.fn(), reset: jest.fn(),
  }));
});
afterEach(() => { jest.restoreAllMocks(); featureFlags.romanDraftMark = false; });

it('defaults off even in development', () => {
  jest.isolateModules(() => expect(require('../../../config/featureFlags').featureFlags.romanDraftMark).toBe(false));
});

it.each([false, true])('walks every governed message path on side isMe=%s', async (isMe) => {
  for (const [name, row, expected] of cases) {
    const message = { ...base, ...bubbleV2Fields(readThreadV2Fields(row), 'client', null) };
    const u = await render(<MessageBubble message={message} isMe={isMe} onLongPress={jest.fn()}
      draftContext={row.sender_role === 'client' ? undefined : { ...context, isSender: isMe }} />);
    expect(Boolean(u.queryByTestId('roman-draft-mark'))).toBe(expected);
    if (expected) expect(u.getByTestId('roman-draft-mark').props.accessibilityHint).toBe(ROMAN_DRAFT_HINT);
    expect(u.queryByText('Drafted by Roman')).toBeNull();
    await u.unmount();
    expect(name).toBeTruthy();
  }
  featureFlags.romanDraftMark = false;
  const u = await render(<MessageBubble message={{ ...base, drafted: true }} isMe={isMe}
    onLongPress={jest.fn()} draftContext={context} />);
  expect(u.queryByTestId('roman-draft-mark')).toBeNull();
});

it.each([false, true])('two taps reveal then explain, with long press forwarded on side %s', async (isMe) => {
  const onLongPress = jest.fn();
  const message = { ...base, drafted: true };
  const u = await render(<MessageBubble message={message} isMe={isMe} onLongPress={onLongPress}
    draftContext={{ ...context, isSender: isMe }} />);
  const mark = u.getByTestId('roman-draft-mark');
  expect(mark.props.accessibilityLabel).toBe(`Roman helped draft this message. ${isMe ? 'You' : 'Sam'} sent it.`);
  expect(StyleSheet.flatten(mark.props.style)).toMatchObject({ width: 44, height: 44, bottom: -18, [isMe ? 'left' : 'right']: -16 });
  expect(StyleSheet.flatten(u.getByTestId('roman-draft-ring').props.style)).toMatchObject({ width: 24, height: 24, top: 18, left: 10 });
  await fireEvent(mark, 'longPress');
  expect(onLongPress).toHaveBeenCalledWith(message);
  expect(u.queryByText('Drafted by Roman')).toBeNull();
  await fireEvent.press(mark);
  const line = u.getByText('Drafted by Roman');
  expect(StyleSheet.flatten(line.props.style)).toMatchObject({ fontStyle: 'italic', textDecorationLine: 'underline' });
  expect(u.queryByText('Drafted with Roman')).toBeNull();
  await fireEvent.press(u.getByLabelText('Drafted by Roman'));
  expect(u.getByRole('header', { name: 'Drafted with Roman' })).toBeTruthy();
  expect(u.getByText(isMe ? /Jordan sees this mark/ : /Sam chose to send it to you/)).toBeTruthy();
  expect(HapticService.selection).toHaveBeenCalledTimes(3);
  await fireEvent.press(u.getByTestId('roman-draft-ok'));
  expect(u.queryByText('Drafted with Roman')).toBeNull();
  expect(u.getByTestId('roman-draft-mark').props.accessibilityState).toEqual({ expanded: true });
});

it.each([false, true])('sheet motion, content and every dismissal (reduced=%s)', async (reduced) => {
  mockReduced = reduced;
  for (const path of ['ok', 'scrim', 'back', 'swipe', 'escape']) {
    const onClose = jest.fn();
    const u = await render(<RomanDraftSheet context={context} onClose={onClose} onDismiss={jest.fn()} />);
    expect(Animated.timing).toHaveBeenLastCalledWith(expect.anything(),
      expect.objectContaining({ toValue: 1, duration: reduced ? 150 : 250, useNativeDriver: true }));
    const sheet = u.getByTestId('roman-draft-sheet');
    expect(StyleSheet.flatten(sheet.props.style)).toMatchObject({ borderTopLeftRadius: 24, paddingBottom: 34 });
    if (reduced) expect(StyleSheet.flatten(sheet.props.style).transform).toEqual([{ translateY: 0 }]);
    expect(u.getByText(/only while you allow AI help/)).toBeTruthy();
    if (path === 'ok' || path === 'scrim') await fireEvent.press(u.getByTestId(`roman-draft-${path}`));
    if (path === 'back') await fireEvent(u.UNSAFE_getByType(require('react-native').Modal), 'requestClose');
    if (path === 'swipe') {
      const handlers = jest.mocked(PanResponder.create).mock.calls.slice(-1)[0][0];
      await act(async () => handlers.onPanResponderRelease?.(
        {} as GestureResponderEvent, { dy: 80, dx: 0 } as PanResponderGestureState,
      ));
    }
    if (path === 'escape') await fireEvent(sheet, 'accessibilityEscape');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(Animated.timing).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ toValue: 0, duration: reduced ? 150 : 250 }));
    await u.unmount();
  }
});
