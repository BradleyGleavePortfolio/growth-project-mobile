/**
 * In-memory signal from the transcript screen to the list: "this chat is
 * gone" (erased there, or the server said it no longer exists). Carries the
 * account and the sign-in (auth epoch) it belongs to, so a list loaded for
 * another account or another sign-in ignores it.
 * Nothing is stored; no message text ever passes through here.
 */
export interface RomanChatGone {
  ownerId: string;
  /** Auth epoch of the sign-in the chat was erased under. */
  epoch: number;
  id: string;
  /** What the list should say about it. */
  notice?: string;
}

type Listener = (e: RomanChatGone) => void;
const listeners = new Set<Listener>();

export const romanChatsEvents = {
  emitGone(e: RomanChatGone): void {
    listeners.forEach((fn) => fn(e));
  },
  onGone(fn: Listener): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};
