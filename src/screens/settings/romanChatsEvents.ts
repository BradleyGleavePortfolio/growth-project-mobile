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

/**
 * Signal from the list to the live Roman chat: the server confirmed a chat
 * erased (Delete on its row: `id`) or every chat erased (Delete all: `id`
 * null). The live chat screen stays mounted under the history screens, so
 * when it holds an erased chat it drops it and opens a fresh one (B-376-1).
 */
export interface RomanChatErased {
  id: string | null;
}

type Listener = (e: RomanChatGone) => void;
const listeners = new Set<Listener>();
type ErasedListener = (e: RomanChatErased) => void;
const erasedListeners = new Set<ErasedListener>();

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
  emitErased(e: RomanChatErased): void {
    erasedListeners.forEach((fn) => fn(e));
  },
  onErased(fn: ErasedListener): () => void {
    erasedListeners.add(fn);
    return () => {
      erasedListeners.delete(fn);
    };
  },
};
