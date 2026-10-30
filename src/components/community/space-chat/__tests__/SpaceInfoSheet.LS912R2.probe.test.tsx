/**
 * LS-912R2 independent probes. Review-only tests, never a product fix.
 * Geometry is a style-tree projection, not a native layout or screen-reader claim.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, render, within } from '@testing-library/react-native';
import SpaceInfoSheet from '../SpaceInfoSheet';
import type { SpacePeopleAccess } from '../SpaceInfoSheet';
import { HapticService } from '../../../../ui/haptics/haptics.service';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, right: 0, bottom: 34, left: 0 }),
}));
const mockPeople = jest.fn(() => ({
  data: { pages: [{ members: [{ user_id: 'me', display_name: 'Me', role: 'student' }], next_cursor: null }] },
  error: null, hasNextPage: false, isFetching: false, isFetchingNextPage: false, isFetchNextPageError: false,
  refetch: jest.fn(), fetchNextPage: jest.fn(),
}));
jest.mock('../spaceMembers', () => ({
  ...jest.requireActual('../spaceMembers'),
  useSpaceMembers: () => mockPeople(),
}));

const LONG = 'Morning mobility and stretching for the whole studio';
const NAMES = ['Everyone', LONG, 'W'.repeat(180)];
const SCALES = [...Array.from({ length: 101 }, (_, i) => 1 + i / 100), 11 / 6, 1.83332, 1.83334];
const dims = (fontScale: number) => ({ width: 320, height: 568, scale: 2, fontScale });

function props(name = LONG, people: SpacePeopleAccess = 'closed') {
  return {
    cohortId: 'review-space', name, members: '24 members', description: 'Say hi.',
    viewerId: 'me', people, offline: false, onClose: jest.fn(), onRetry: jest.fn(),
  };
}

function projection(r: Awaited<ReturnType<typeof render>>, name: string, scale: number) {
  const sheet = r.getByTestId('space-info-sheet');
  const close = within(sheet).getByTestId('space-info-close');
  const title = within(sheet).getByText(name);
  const headText = within(sheet).getAllByRole('header')[0].parent!;
  const titleStyle = StyleSheet.flatten(title.props.style);
  const textStyle = StyleSheet.flatten(headText.props.style);
  const closeStyle = StyleSheet.flatten(close.props.style);
  const firstLine = (textStyle.paddingTop ?? 0) + titleStyle.lineHeight * scale / 2;
  const centre = (closeStyle.marginTop ?? 0) + closeStyle.height / 2;
  expect(Math.abs(firstLine - centre)).toBeLessThan(0.000001);
  expect(closeStyle.width).toBe(44);
  expect(closeStyle.height).toBe(44);
  expect(textStyle.paddingTop ?? 0).toBeGreaterThanOrEqual(0);
  expect(closeStyle.marginTop ?? 0).toBeGreaterThanOrEqual(0);
  expect(title.props.numberOfLines).toBe(2);
  expect(title.props.allowFontScaling).not.toBe(false);
  expect(title.props.maxFontSizeMultiplier).toBeUndefined();
  expect(within(r.getByTestId('space-info-scroll')).queryByTestId('space-info-close')).toBeNull();
  expect(sheet.props.accessibilityViewIsModal).toBe(true);
}

describe('LS-912R2 independent Close regression probes', () => {
  it.each(NAMES)('every 1 percent scale, the branch boundary and a live scale change: %s', async (name) => {
    const dimensions = jest.spyOn(require('react-native'), 'useWindowDimensions').mockReturnValue(dims(1));
    const p = props(name);
    const r = await render(<SpaceInfoSheet {...p} />);
    try {
      for (const scale of SCALES) {
        dimensions.mockReturnValue(dims(scale));
        await r.rerender(<SpaceInfoSheet {...p} />);
        projection(r, name, scale);
        expect(r.getAllByRole('button', { name: 'Close', includeHiddenElements: true })
          .map((n) => n.props.testID)).toEqual(['space-info-close']);
        expect(p.onClose).not.toHaveBeenCalled();
      }
      dimensions.mockReturnValue(dims(1));
      await r.rerender(<SpaceInfoSheet {...p} />);
      projection(r, name, 1);
    } finally {
      dimensions.mockRestore();
      await r.unmount();
    }
  }, 30000);

  it.each(['close', 'scrim', 'android-back', 'voiceover-escape'])('%s invokes only its close callback once', async (exit) => {
    const p = props();
    const r = await render(<SpaceInfoSheet {...p} />);
    const impact = jest.spyOn(HapticService, 'softImpact');
    impact.mockClear();
    try {
      if (exit === 'close') await fireEvent.press(r.getByTestId('space-info-close'));
      if (exit === 'scrim') await fireEvent.press(r.getByTestId('space-info-scrim', { includeHiddenElements: true }));
      if (exit === 'android-back') {
        let modal = r.getByTestId('space-info-sheet').parent;
        while (modal && !modal.props.onRequestClose) modal = modal.parent;
        expect(modal).not.toBeNull();
        await act(async () => modal!.props.onRequestClose());
      }
      if (exit === 'voiceover-escape') await fireEvent(r.getByTestId('space-info-sheet'), 'accessibilityEscape');
      expect(p.onClose).toHaveBeenCalledTimes(1);
      expect(p.onRetry).not.toHaveBeenCalled();
      expect(impact).toHaveBeenCalledTimes(exit === 'close' ? 1 : 0);
    } finally {
      impact.mockRestore();
      await r.unmount();
    }
  });

  it.each(['closed', 'wait', 'failed'] as const)('%s never mounts a members read to make the new Close available', async (people) => {
    mockPeople.mockClear();
    const p = props('Everyone', people);
    const r = await render(<SpaceInfoSheet {...p} />);
    try {
      expect(mockPeople).not.toHaveBeenCalled();
      const scrim = r.getByTestId('space-info-scrim', { includeHiddenElements: true });
      expect(scrim.props.accessible).toBe(false);
      expect(scrim.props.importantForAccessibility).toBe('no');
      expect(scrim.props.accessibilityRole).toBeUndefined();
      expect(scrim.props.accessibilityLabel).toBeUndefined();
      const close = r.getByTestId('space-info-close');
      expect(close.props.accessibilityRole).toBe('button');
      expect(close.props.accessibilityLabel).toBe('Close');
      await fireEvent.press(close);
      expect(p.onClose).toHaveBeenCalledTimes(1);
      expect(mockPeople).not.toHaveBeenCalled();
    } finally {
      await r.unmount();
    }
  });
});
