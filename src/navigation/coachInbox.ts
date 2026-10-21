import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { useNavigation, usePreventRemove } from '@react-navigation/native';
import type { NavigationAction, NavigationProp, ParamListBase } from '@react-navigation/native';
import { featureFlags } from '../config/featureFlags';
import { authEvents } from '../utils/authEvents';

/**
 * COACH-CHAT-BACK (owner op 1): where a client's chat opens from the inbox,
 * Overview, Money or the daily brief. With the six tabs it opens in Messages
 * over the inbox (`initial: false`), so the bar shows Messages and Back returns
 * to the inbox, like any inbox; off, in Clients over the client list, as today.
 * With the six tabs, every chat button in a client's file (both Message {first}
 * buttons, Summary's Messages, Logs' Send feedback) opens it the inbox way
 * (SAFETY-CARD, #CARD-MESSAGE-DEST, #CARD-MESSAGE-ALL op 1), and so do Message
 * {first} on a safety alert and Send check-in on a weekly insight, which keeps
 * its drafted text (SAFETY-CHAT-ROUTE); off, those open over the screen.
 */
export const chatTarget = (clientId: string, clientName: string, initialDraft?: string) => ({
  tab: featureFlags.coachTabsV2 ? 'Messages' : 'ClientsStack',
  params: { screen: 'ClientMessages', params: { clientId, clientName, initialDraft }, initial: false },
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

export const openInboxChat = (navigation: TabJump, clientId: string, clientName: string, initialDraft?: string): void =>
  openTarget(navigation, chatTarget(clientId, clientName, initialDraft));

/**
 * Sol B1 (round 3): a chat left open in Messages with unsent text asks before openTarget's reset closes it, with the
 * broadcast composer's prompt (BroadcastComposerScreen.tsx:88). Keep editing keeps the chat and its text, and Messages
 * opens on it; Discard removes the text and runs the reset. Any other removal (Back, the tab press) goes straight
 * through and the text stays with that client's chat (COACH-CHAT-KEEP, below).
 */
export function useKeepUnsentChat(unsent: boolean, onDiscard?: () => void): void {
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  usePreventRemove(featureFlags.coachTabsV2 === true && unsent, ({ data: { action } }) => {
    if (action.type !== 'RESET' || action.target !== navigation.getState()?.key) {
      navigation.dispatch(action);
      return;
    }
    Alert.alert('Discard this message?', 'Leaving removes the text from this message.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => { onDiscard?.(); navigation.dispatch(action); } },
    ]);
  });
}

/**
 * COACH-CHAT-KEEP: with the six tabs, a reply typed in a client's chat and not sent stays with that client's chat when
 * the chat closes (Back, a message push opening the inbox, the tab press) and is back in the box when it opens again.
 * One reply per client, in memory only; sending it, Discard on the prompt above, or any sign-in or sign-out removes it.
 */
const unsentReplies = new Map<string, string>();
let unsentWired = false;
function wireUnsentReset(): void {
  if (unsentWired) return;
  unsentWired = true;
  const reset = () => unsentReplies.clear();
  authEvents.on('logout', reset);
  authEvents.on('login', reset);
}

function keepUnsent(clientId: string, text: string): void {
  if (featureFlags.coachTabsV2 === true && text.trim() !== '') unsentReplies.set(clientId, text);
  else unsentReplies.delete(clientId);
}

/** The chat's reply box: the client's kept reply (a passed draft wins), saved on every change, guarded as above. */
export function useUnsentReply(clientId: string, initialDraft?: string): [string, (text: string) => void] {
  wireUnsentReset();
  const [box, setBox] = useState(() => {
    const text = initialDraft ?? (featureFlags.coachTabsV2 === true ? unsentReplies.get(clientId) : undefined) ?? '';
    keepUnsent(clientId, text);
    return { clientId, text };
  });
  const text = box.clientId === clientId ? box.text : (featureFlags.coachTabsV2 === true ? unsentReplies.get(clientId) : undefined) ?? '';
  const setText = useCallback((next: string) => {
    keepUnsent(clientId, next);
    setBox({ clientId, text: next });
  }, [clientId]);
  useKeepUnsentChat(text.trim() !== '', () => unsentReplies.delete(clientId));
  return [text, setText];
}

/** The Messages header's Broadcasts and Community reports follow the same rule as a chat. */
export function openInboxScreen(navigation: NavigationProp<ParamListBase>, screen: 'CoachBroadcasts' | 'CoachCommunityModeration'): void {
  if (featureFlags.coachTabsV2) navigation.navigate(screen);
  else navigation.navigate('ClientsStack', { screen, initial: false }); // off: client list beneath (B-332-7)
}
