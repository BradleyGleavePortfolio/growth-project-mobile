/**
 * ScreenArea (OFFLINE-BAND-ROOT-M; C1 Style C v2 C2_offline_*): the part of the root that every navigator draws in,
 * under the offline band. It holds its own SafeAreaProvider, whose native view is the area itself, so a screen reads
 * the insets of the area and not of the window: while the band shows, the area starts where the band ends and its top
 * inset is 0, so each screen starts right under the band as it starts under the top strip online (the page moves down
 * by the band's ink alone); with no band the area sits at the window's origin and reads the window's insets, so online
 * nothing changes. One source on both phones, sent by the area's own native view on every layout: UIKit's safe area of
 * that view on iPhone, the window's insets less the view's place on Android (react-native-safe-area-context).
 * Always mounted: nothing here reads the network, so no navigator remounts when the signal comes and goes.
 * - useWindowInsets(): the window's insets, for what draws from the window's top while inside the area (a Modal).
 * - useScreenAreaKeyboardOffset(): on iPhone the area's top in the window, for a screen's KeyboardAvoidingView, which
 *   counts its own place from its parent and so misses whatever sits above the area; 0 on Android and with no area.
 * Imports neither the src/ui barrel nor Screen.tsx (Screen imports this file; RootNavigator imports it directly).
 */
import React, { createContext, useContext } from 'react';
import { Dimensions, Platform } from 'react-native';
import * as SafeArea from 'react-native-safe-area-context';
import type { EdgeInsets, Rect } from 'react-native-safe-area-context';

const NO_INSETS: EdgeInsets = { top: 0, bottom: 0, left: 0, right: 0 };
const WindowInsetsContext = createContext<EdgeInsets | null>(null);
// A test's partial jest.mock of the package can leave either context undefined, and useContext(undefined) throws.
const NoInsetsContext = createContext<EdgeInsets | null>(null);
const NoFrameContext = createContext<Rect | null>(null);
const useNearestInsets = () => useContext(SafeArea.SafeAreaInsetsContext ?? NoInsetsContext);
const useNearestFrame = () => useContext(SafeArea.SafeAreaFrameContext ?? NoFrameContext);

export function ScreenArea({ children }: { children: React.ReactNode }): React.ReactElement {
  // The window's, from the app's one provider at the window's origin (App.tsx); all 0 with none (tests, previews).
  const windowInsets = useNearestInsets() ?? NO_INSETS;
  const windowFrame = useNearestFrame();
  const { width, height } = Dimensions.get('window');
  // initialMetrics: the children render on the first frame, with or without a provider above; the area's own native
  // view then sends its insets and frame, and again whenever either changes (the band showing or going).
  return (
    <WindowInsetsContext.Provider value={windowInsets}>
      <SafeArea.SafeAreaProvider
        testID="screen-area"
        initialMetrics={{ insets: windowInsets, frame: windowFrame ?? { x: 0, y: 0, width, height } }}
      >
        {children}
      </SafeArea.SafeAreaProvider>
    </WindowInsetsContext.Provider>
  );
}

/** The window's insets: inside the area, the ones the area was given; elsewhere the nearest provider's; else all 0. */
export function useWindowInsets(): EdgeInsets {
  const windowInsets = useContext(WindowInsetsContext);
  const nearest = useNearestInsets();
  return windowInsets ?? nearest ?? NO_INSETS;
}

/** iPhone: how far the area's top sits below the window's (the band's height while it shows, else 0). Android: 0. */
export function useScreenAreaKeyboardOffset(): number {
  const frame = useNearestFrame();
  return Platform.OS === 'ios' ? Math.max(0, frame?.y ?? 0) : 0;
}
