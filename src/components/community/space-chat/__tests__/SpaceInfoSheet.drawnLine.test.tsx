/**
 * B-TEST LO-912R2 B1 (m#912 review round 2, agent 186): the X stays level with the name's first line as the phone draws
 * it. Android 14+ scales text non-linearly (FontScaleConverterFactory: at the 130% step a 24 sp line is 26.4 dp, at 200%
 * it is 36 dp), while useWindowDimensions().fontScale stays the linear 1.3 / 2. So the inset must follow the drawn first
 * line (the title's onTextLayout lines[0].height), not 24 x fontScale. The iOS rows (linear) must stay level too.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import type { TestInstance } from 'test-renderer';
import SpaceInfoSheet from '../SpaceInfoSheet';
import type { SpaceMember } from '../spaceMembers';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, right: 0, bottom: 34, left: 0 }),
}));
const person = (user_id: string, display_name: string, role = 'student'): SpaceMember => ({ user_id, display_name, role });
jest.mock('../spaceMembers', () => ({
  ...jest.requireActual('../spaceMembers'),
  useSpaceMembers: () => ({
    data: { pages: [{ members: [person('coach-1', 'Sam', 'coach'), person('me-1', 'Dana')], next_cursor: null }] },
    error: null, hasNextPage: false, isFetchNextPageError: false, isFetchingNextPage: false, isFetching: false,
    refetch: jest.fn(), fetchNextPage: jest.fn(),
  }),
}));

const ROWS = [
  { platform: 'Android 14+', fontScale: 1.3, drawnLine: 26.4 },
  { platform: 'Android 14+', fontScale: 1.5, drawnLine: 28 },
  { platform: 'Android 14+', fontScale: 2, drawnLine: 36 },
  { platform: 'iOS', fontScale: 1.3, drawnLine: 31.2 },
  { platform: 'iOS', fontScale: 1, drawnLine: 24 },
];

describe('B-TEST LO-912R2 B1', () => {
  it.each(ROWS)('B-TEST LO-912R2 B1: the X is level with the drawn first line ($platform, $fontScale, line $drawnLine)', async ({ fontScale, drawnLine }) => {
    const dimensions = jest.spyOn(require('react-native'), 'useWindowDimensions').mockReturnValue({
      width: 320, height: 568, scale: 2, fontScale,
    });
    try {
      await render(
        <SpaceInfoSheet cohortId="c-every" name="Everyone" members="24 members" description="Say hi and share your wins."
          people="open" viewerId="me-1" offline={false} error={null} onRetry={jest.fn()} onClose={jest.fn()} />,
      );
      const sheet = screen.getByTestId('space-info-sheet');
      const title = within(sheet).getByText('Everyone');
      // What the phone reports once it has drawn the name: one line, drawnLine tall.
      await fireEvent(title, 'textLayout', { nativeEvent: { lines: [{ x: 0, y: 0, width: 120, height: drawnLine, ascender: drawnLine * 0.8, descender: drawnLine * 0.2, capHeight: 14, xHeight: 10, text: 'Everyone' }] } });
      const headText = within(sheet).getAllByRole('header')[0].parent as TestInstance;
      const inset = StyleSheet.flatten(headText.props.style).paddingTop ?? 0;
      const closeStyle = StyleSheet.flatten(screen.getByTestId('space-info-close').props.style);
      const lineCentre = inset + drawnLine / 2;
      const xCentre = (closeStyle.marginTop ?? 0) + closeStyle.height / 2;
      // Round 1 graded 3.6 pt at 130% a B; keep the same 1 pt bar as LS-912 B1's B-TEST.
      expect(Math.abs(lineCentre - xCentre)).toBeLessThanOrEqual(1);
      expect([closeStyle.width, closeStyle.height]).toEqual([44, 44]);
    } finally {
      dimensions.mockRestore();
    }
  });
});
