/**
 * useOpenSupport: open the in-app Support screen from any signed-in screen.
 *
 * `SupportInbox` is registered in the client "More" stack (tab `MoreTab`)
 * and the coach settings stack (tab `SettingsStack`), so a screen in another
 * tab cannot reach it by name alone. This walks up the navigator tree and
 * navigates through the first navigator that knows the route or the tab that
 * holds it. Returns null outside a navigator (for example in a test render),
 * so callers can show the support address in words instead.
 */
import { useContext, useMemo } from 'react';
import { NavigationContext } from '@react-navigation/native';

/** The navigator surface this needs (a structural subset of NavigationProp). */
export interface SupportNav {
  navigate(name: string, params?: { screen: string }): void;
  getState?(): { routeNames: readonly string[] } | undefined;
  getParent?(): SupportNav | undefined;
}
type Nav = SupportNav;

/** Navigate to SupportInbox from `navigation`; false when no navigator holds it. */
export function openSupportFrom(navigation: Nav | undefined): boolean {
  let nav: Nav | undefined = navigation;
  for (let depth = 0; nav && depth < 8; depth += 1) {
    const names: readonly string[] = nav.getState?.()?.routeNames ?? [];
    if (names.includes('SupportInbox')) {
      nav.navigate('SupportInbox');
      return true;
    }
    if (names.includes('MoreTab')) {
      nav.navigate('MoreTab', { screen: 'SupportInbox' });
      return true;
    }
    if (names.includes('SettingsStack')) {
      nav.navigate('SettingsStack', { screen: 'SupportInbox' });
      return true;
    }
    nav = nav.getParent?.();
  }
  return false;
}

export function useOpenSupport(): (() => boolean) | null {
  const navigation = useContext(NavigationContext);
  return useMemo(() => (navigation ? () => openSupportFrom(navigation) : null), [navigation]);
}
