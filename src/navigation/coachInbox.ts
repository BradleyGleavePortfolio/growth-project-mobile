import type { NavigationProp, ParamListBase } from '@react-navigation/native';
import { featureFlags } from '../config/featureFlags';

/**
 * COACH-CHAT-BACK (owner op 1): where a client's chat opens from the inbox,
 * Overview, Money or the daily brief. With the six tabs it opens in Messages
 * over the inbox (`initial: false`); a chat already open there is reused and
 * its contact page closed (`pop: true`), so the bar shows Messages and Back
 * returns to the inbox, like any inbox. Off, in Clients over the client list,
 * as today. A chat opened from a Clients screen (a client's file) stays there.
 */
export const chatTarget = (clientId: string, clientName: string) => {
  const chat = { screen: 'ClientMessages', params: { clientId, clientName }, initial: false } as const;
  return featureFlags.coachTabsV2
    ? ({ tab: 'Messages', params: { ...chat, pop: true } } as const)
    : ({ tab: 'ClientsStack', params: chat } as const);
};

/** Any screen's navigation (a structural subset, as in useOpenSupport); a nested navigator passes the jump up to the tabs. */
interface TabJump {
  navigate(name: string, params?: object, options?: object): void;
}

export function openInboxChat(navigation: TabJump, clientId: string, clientName: string): void {
  const { tab, params } = chatTarget(clientId, clientName);
  navigation.navigate(tab, params);
}

/** The Messages header's Broadcasts and Community reports follow the same rule as a chat. */
export function openInboxScreen(navigation: NavigationProp<ParamListBase>, screen: 'CoachBroadcasts' | 'CoachCommunityModeration'): void {
  if (featureFlags.coachTabsV2) navigation.navigate(screen);
  else navigation.navigate('ClientsStack', { screen, initial: false }); // off: client list beneath (B-332-7)
}
