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
