import type { NavigationAction, NavigationProp, ParamListBase } from '@react-navigation/native';
import { featureFlags } from '../config/featureFlags';

/**
 * COACH-CHAT-BACK (owner op 1): where a client's chat opens from the inbox,
 * Overview, Money or the daily brief. With the six tabs it opens in Messages
 * over the inbox (`initial: false`), so the bar shows Messages and Back returns
 * to the inbox, like any inbox; off, in Clients over the client list, as today.
 * A chat opened from a Clients screen (a client's file) stays there.
 */
export const chatTarget = (clientId: string, clientName: string) => ({
  tab: featureFlags.coachTabsV2 ? 'Messages' : 'ClientsStack',
  params: { screen: 'ClientMessages', params: { clientId, clientName }, initial: false },
} as const);

type Routes = { routes: readonly { name: string; state?: { key?: string; routes: readonly unknown[] } }[] };
/** Any screen's navigation (a structural subset, as in useOpenSupport); a nested navigator passes the jump up to the tabs. */
interface TabJump {
  navigate(name: string, params?: object, options?: object): void;
  dispatch?(action: NavigationAction): void;
  getState?(): Routes | undefined;
  getParent?(): TabJump | undefined;
}

/** The Messages stack, found from any screen by walking up to the tabs; undefined until Messages has opened. */
function messagesStack(navigation: TabJump) {
  for (let n: TabJump | undefined = navigation; n; n = n.getParent?.()) {
    const messages = n.getState?.()?.routes.find((route) => route.name === 'Messages');
    if (messages) return messages.state;
  }
  return undefined;
}

/**
 * Opens a { tab, params } target (chatTarget, the brief's actionTarget). A chat into Messages from anywhere replaces
 * whatever is open there, so it sits right on the same inbox (Sol B1). One RESET through the router: a screen guarding
 * unsent text asks first (the broadcast composer's "Discard this message?"); kept, Messages opens on it, and Discard
 * re-runs the reset.
 */
export function openTarget(navigation: TabJump, { tab, params }: { tab: string; params?: object }): void {
  const nested = params as { screen?: string; params?: object } | undefined;
  const stack = tab === 'Messages' && nested?.screen === 'ClientMessages' ? messagesStack(navigation) : undefined;
  if (!stack?.key || stack.routes.length < 2) {
    navigation.navigate(tab, params);
    return;
  }
  const routes = [stack.routes[0], { name: 'ClientMessages', params: nested?.params }];
  navigation.dispatch?.({ type: 'RESET', payload: { ...stack, index: 1, routes }, target: stack.key }); // CommonActions.reset
  navigation.navigate(tab);
}

export const openInboxChat = (navigation: TabJump, clientId: string, clientName: string): void =>
  openTarget(navigation, chatTarget(clientId, clientName));

/** The Messages header's Broadcasts and Community reports follow the same rule as a chat. */
export function openInboxScreen(navigation: NavigationProp<ParamListBase>, screen: 'CoachBroadcasts' | 'CoachCommunityModeration'): void {
  if (featureFlags.coachTabsV2) navigation.navigate(screen);
  else navigation.navigate('ClientsStack', { screen, initial: false }); // off: client list beneath (B-332-7)
}
