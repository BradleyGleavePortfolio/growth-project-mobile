import { useEffect, useMemo, useReducer } from 'react';
import type { NavigationAction, NavigationProp, ParamListBase } from '@react-navigation/native';
import { featureFlags } from '../config/featureFlags';
import { useChatDraft } from '../lib/chatDrafts';
import type { ChatSendKey, SetChatText } from '../lib/chatDrafts';

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
 * whatever is open there, so it sits right on the same inbox (Sol B1). One RESET through the router: the broadcast
 * composer still asks first ("Discard this message?"; kept, Messages opens on it, and Discard re-runs the reset); a chat
 * never asks, its unsent text stays with that chat (useUnsentReply).
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

/** A message notification's client on the Messages list's route, with the list screen's own navigation. */
export interface InboxTap {
  clientId: string;
  screen: { setParams(params: { clientId: undefined }): void; isFocused(): boolean; addListener(type: 'blur', cb: () => void): () => void };
}

/**
 * COACH-ROW-CHAT-PUSH-M (owner 203-D4, #203-E22 "open the clients chat"): a coach's message notification (the lock
 * screen, a cold start, the in-app slip) opens Messages with its client's id and no name (pushTapRouter; b#1242's
 * actionParams.clientId). The list then opens that client's chat as her own tap on the row does, by the row's own call
 * and name; with no row (a block either way, a client who moved or is not hers, a failed read) she stays on the list.
 * At most one read of the list per tap (`reread`, joining one already out). A chat opens only while the list is in
 * front, only for the id on the route now (the newest tap), and never after she moved on. The id is spent (cleared from
 * the route) when the list leaves the front, the chat's own opening included, or at once when the tap gives up, so
 * Back, a refresh and the slip never see it again. The open is made in the commit after the row is found, and the id
 * is spent after the open: React Navigation 7 drops a nested navigate that lands in the same update as a change to that
 * stack's own state (useNavigationBuilder's paramsUsedForInitialization), such as the router's own update of this stack.
 */
export function useInboxTap(tap: InboxTap | undefined, list: {
  ready: boolean; // may decide now
  rowName(clientId: string): string | undefined; // that client's row before search, or undefined
  reread(): Promise<unknown>;
  open(clientId: string, name: string): void; // the row's own press
}): void {
  const id = tap?.clientId;
  const run = useMemo(() => ({ asked: false, answered: false, found: false, decided: false }), [id]); // one per tap
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!tap) return undefined;
    return tap.screen.addListener('blur', () => {
      run.decided = true;
      tap.screen.setParams({ clientId: undefined });
    });
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!tap || run.decided || !list.ready) return;
    const name = list.rowName(tap.clientId);
    if (name !== undefined && !run.found) {
      run.found = true;
      rerender();
      return;
    }
    if (name === undefined && !run.found && !run.asked) {
      run.asked = true;
      void list.reread().finally(() => { run.answered = true; rerender(); });
      return;
    }
    if (name === undefined && !run.found && !run.answered) return;
    run.decided = true;
    if (name !== undefined && tap.screen.isFocused()) list.open(tap.clientId, name); // its blur spends the id
    else tap.screen.setParams({ clientId: undefined });
  });
}

/**
 * COACH-CHAT-KEEP and CHAT-DISCARD (owner 10-21): nothing asks before a chat closes (the "Discard this message?" prompt
 * on a chat is gone). A reply typed in a client's chat and not sent stays with that client's chat on this device when the
 * chat closes (Back, a push or banner opening another chat, the tab press, the app closing) and is back in the box when
 * it opens again; a passed draft (Send check-in) goes under it, never over it (Opus C1). A send that failed keeps its key
 * with its text (Sol B1, m#841). Sending it or signing out removes it; kept text is filed under the signed-in account,
 * so another account never sees it (src/lib/chatDrafts.ts).
 */
export function useUnsentReply(clientId: string, initialDraft?: string): [string, SetChatText, ChatSendKey] {
  return useChatDraft(`coach:${clientId}`, initialDraft);
}

/** The Messages header's Broadcasts and Community reports follow the same rule as a chat. */
export function openInboxScreen(navigation: NavigationProp<ParamListBase>, screen: 'CoachBroadcasts' | 'CoachCommunityModeration'): void {
  if (featureFlags.coachTabsV2) navigation.navigate(screen);
  else navigation.navigate('ClientsStack', { screen, initial: false }); // off: client list beneath (B-332-7)
}
