/**
 * B-TEST (LS-OFFLINE-BAND-ROOT-M-1, B1) on growth-project-mobile#1012 @ b5a3325a.
 *
 * The space list drawer (src/components/community/SpaceDrawer.tsx, on main since m#944 and m#945 merged) is a
 * statusBarTranslucent <Modal>: it draws from the window's top, over the offline band and the top strip. Its panel pads
 * by useSafeAreaInsets().top + 12 (main :45, :78). Under this PR's ScreenArea that read is the area's top, 0 while the
 * band shows, so offline the drawer's monogram and space name start 12 pt from the window's top, under the clock
 * (main: 47 + 12 on the 390 iPhone). The census keeps the file as "WAITS m#944", but m#944 has merged and no open PR
 * lists the file, so nothing else will change it.
 *
 * Fails at the reviewed head (the file is not in its tree: the branch has not merged main 5b15f6ad), fails by assertion
 * at the head merged with main (paddingTop 12, not 59), passes once main is merged and the drawer reads the window's
 * top through useWindowInsets (C1's rule). Fictional people: client Jordan, coach Sam.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { SafeAreaProvider, type Metrics } from 'react-native-safe-area-context';
import { ScreenArea } from '../ui/layout/ScreenArea';
import { SpaceListButton } from '../components/community/SpaceDrawer';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-navigation/native', () => ({ useRoute: () => ({ params: { cohortId: 'space-jordan' } }) }));
jest.mock('../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('../components/community/SpaceTree', () => ({
  Monogram: () => null,
  SpaceTree: () => null,
  useOpenSpaceTarget: () => () => undefined,
  useSpaceTree: () => ({ name: "Sam's community", sections: [] }),
}));

const m = (top: number, bottom: number, y: number, width: number, height: number): Metrics => ({
  insets: { top, bottom, left: 0, right: 0 },
  frame: { x: 0, y, width, height },
});
// The 390 iPhone: the window (App.tsx's provider), and what the area's native view sends offline (under the band) and online.
const WINDOW = m(47, 34, 0, 390, 844);
const STATES: Array<[string, Metrics]> = [
  ['offline (the area starts under the band, its own top 0)', m(0, 34, 101, 390, 743)],
  ['online (the area at the window origin)', m(47, 34, 0, 390, 844)],
];

describe('LS-OFFLINE-BAND-ROOT-M-1 B1: the space list drawer, a Modal over the band, keeps the window top', () => {
  it.each(STATES)('%s: the drawer panel pads by the window top + 12 (59 pt), as on main', async (_label, area) => {
    const view = await render(
      <SafeAreaProvider initialMetrics={WINDOW}>
        <ScreenArea>
          <SpaceListButton />
        </ScreenArea>
      </SafeAreaProvider>,
    );
    await act(async () => {
      (view.getByTestId('screen-area').props.onInsetsChange as (e: { nativeEvent: Metrics }) => void)({ nativeEvent: area });
    });
    await act(async () => {
      await fireEvent.press(view.getByTestId('space-list-open'));
    });
    const panel = StyleSheet.flatten(view.getByTestId('space-list').props.style) as { paddingTop?: number };
    expect(panel.paddingTop).toBe(47 + 12);
  });
});
