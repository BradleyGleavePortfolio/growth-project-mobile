import type { NavigationProp, ParamListBase } from '@react-navigation/native';
import { featureFlags } from '../config/featureFlags';

/**
 * COACH-CHAT-BACK (owner op 1): open a client's chat from the coach inbox. With
 * the six tabs it opens in the Messages stack, so Back returns to Messages, like
 * any inbox; off, it opens in Clients as today.
 */
export function openInboxChat(navigation: NavigationProp<ParamListBase>, clientId: string, clientName: string): void {
  if (featureFlags.coachTabsV2) navigation.navigate('ClientMessages', { clientId, clientName });
  else navigation.navigate('ClientsStack', { screen: 'ClientMessages', params: { clientId, clientName } });
}

/** The Messages header's Broadcasts and Community reports follow the same rule as a chat. */
export function openInboxScreen(navigation: NavigationProp<ParamListBase>, screen: 'CoachBroadcasts' | 'CoachCommunityModeration'): void {
  if (featureFlags.coachTabsV2) navigation.navigate(screen);
  else navigation.navigate('ClientsStack', { screen, initial: false }); // off: client list beneath (B-332-7)
}
