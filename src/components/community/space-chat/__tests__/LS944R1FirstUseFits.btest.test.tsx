/**
 * B-TEST LS-944R1 B1 (m#944 review round 1, the Fable lens): the 08a first-use card on the smallest screen the renders
 * rule names (320 x 568 pt) at 130% text (KT-5). The card is a bottom sheet with no scroll and no height cap, and its two
 * buttons are 130 pt each, so it must fit the screen: when it is taller, its top (the title and the line that says who
 * can hear a voice note) is drawn off the top of the screen and cannot be reached.
 * A layout projection from the styles, not device pixels: the LEAST height the card can have (every line of words
 * wrapped as tightly as letters 0.45 em wide allow; Inter runs near 0.5 em, so the phone draws it taller than this).
 * Green when the card fits 568 pt, or when it scrolls under a height cap of the screen.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen, within } from '@testing-library/react-native';
import type { TestInstance } from 'test-renderer';

jest.mock('../spaceChatApi', () => ({ spaceChatApi: { getVoiceConsent: jest.fn(), recordVoiceConsent: jest.fn() } }));

import SpaceVoiceFirstUse from '../SpaceVoiceFirstUse';

const W = 320;
const H = 568;
const FS = 1.3;
type Box = Record<string, number | undefined>;
const flat = (n: TestInstance): Box => (StyleSheet.flatten(n.props.style) ?? {}) as Box;
const n0 = (v: number | undefined) => v ?? 0;
const up = (n: TestInstance) => n.parent as TestInstance;
const fewestLines = (letters: number, fontSize: number, width: number) => Math.max(1, Math.ceil((letters * 0.45 * fontSize * FS) / width));
const scrollsInside = (root: TestInstance): boolean => {
  if (typeof root.type === 'string' && /ScrollView/i.test(root.type)) return true;
  return root.children.some((c) => typeof c !== 'string' && scrollsInside(c));
};

describe('B-TEST LS-944R1 B1', () => {
  it.each([false, true])('B-TEST LS-944R1 B1: the first-use card fits a 320 x 568 pt screen at 130%% text, or scrolls (coach: %s)', async (coach) => {
    const dimensions = jest.spyOn(require('react-native'), 'useWindowDimensions').mockReturnValue({ width: W, height: H, scale: 2, fontScale: FS });
    try {
      await render(<SpaceVoiceFirstUse visible cohortName="Everyone" coach={coach} onRecord={jest.fn()} onClose={jest.fn()} />);
      const sheet = screen.getByTestId('space-chat-voice-first-use');
      const box = flat(sheet);
      const title = flat(within(sheet).getByText('Voice notes'));
      const record = screen.getByTestId('space-chat-voice-first-use-record');
      const notNow = screen.getByTestId('space-chat-voice-first-use-not-now');
      const buttons = flat(up(record));
      const lines = within(sheet).getAllByText(/voice note/).filter((t) => String(t.props.children).length > 20);
      expect(lines).toHaveLength(coach ? 2 : 3);
      const points = flat(up(up(lines[0])));
      const grab = flat(sheet.children[0] as TestInstance);
      const rows = lines.map((line) => {
        const row = up(line);
        const wash = flat(row.children[0] as TestInstance);
        const words = flat(line);
        const width = W - 2 * n0(box.paddingHorizontal) - n0(wash.width) - n0(flat(row).gap);
        return Math.max(n0(wash.height), fewestLines(String(line.props.children).length, n0(words.fontSize), width) * n0(words.lineHeight) * FS);
      });
      const least =
        n0(box.paddingTop) + n0(box.paddingBottom) +
        n0(grab.height) + n0(grab.marginBottom) +
        n0(title.lineHeight) * FS + n0(title.marginTop) + n0(title.marginBottom) +
        n0(points.marginTop) + n0(points.marginBottom) + n0(points.gap) * (rows.length - 1) + rows.reduce((a, b) => a + b, 0) +
        n0(buttons.marginTop) + n0(buttons.marginBottom) + n0(buttons.gap) + n0(flat(record).minHeight) + n0(flat(notNow).minHeight);
      const scrolls = scrollsInside(sheet) && typeof box.maxHeight === 'number' && box.maxHeight <= H;
      expect({ fitsOrScrolls: scrolls || least <= H, leastHeight: Math.round(least), screen: H }).toEqual({ fitsOrScrolls: true, leastHeight: Math.round(least), screen: H });
    } finally {
      dimensions.mockRestore();
    }
  });
});
