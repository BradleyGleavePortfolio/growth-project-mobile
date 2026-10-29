/**
 * An erased Roman chat leaves Copilot's history at once (#852 round 1, B1). Past questions and past answers
 * are read from Roman chats, so when Settings erases a chat (Delete on its row, Delete all) or the transcript
 * says one is gone, the phone drops what it holds from it: the cached answers of that chat (all of them on
 * Delete all) and the loaded question pages, which read again from the server (it leaves out deleted chats).
 * Installed once at import, so it runs whether or not a Copilot screen is open. Neither read is saved to the
 * phone (`meta: { persist: false }`), so nothing from an erased chat outlives the app either.
 */
import type { Query, QueryClient } from '@tanstack/react-query';
import { queryClient } from '../../../services/queryClient';
import { romanChatsEvents } from '../../settings/romanChatsEvents';
import { COPILOT_QUESTIONS_KEY } from './PastQuestions';

/** One past answer: `['copilot', 'answer', sessionId, messageId]`, so a chat's answers can be found by its id. */
export const COPILOT_ANSWER_KEY = ['copilot', 'answer'] as const;
export const copilotAnswerKey = (sessionId: string, messageId: string) => [...COPILOT_ANSWER_KEY, sessionId, messageId] as const;

/** Drop what the phone holds from an erased chat (`sessionId`), or from every chat (`null`). */
export function dropErasedCopilot(qc: QueryClient, sessionId: string | null): void {
  const answers = { queryKey: COPILOT_ANSWER_KEY, predicate: (q: Query) => sessionId === null || q.queryKey[2] === sessionId };
  void qc.cancelQueries(answers);
  qc.removeQueries(answers);
  // A reset empties every loaded page now and reads the list again where it is on screen.
  void qc.resetQueries({ queryKey: COPILOT_QUESTIONS_KEY });
}

let installed = false;
/** Idempotent. The app's client by default; a test may pass its own. */
export function installCopilotErasure(qc: QueryClient = queryClient): () => void {
  if (installed) return () => undefined;
  installed = true;
  const offErased = romanChatsEvents.onErased((e) => dropErasedCopilot(qc, e.id));
  const offGone = romanChatsEvents.onGone((e) => dropErasedCopilot(qc, e.id));
  return () => {
    offErased();
    offGone();
    installed = false;
  };
}

installCopilotErasure();
