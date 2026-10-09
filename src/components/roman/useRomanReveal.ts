/**
 * useRomanReveal — which Roman reply should fade in (B30, "streaming that
 * feels like reading"). Only the reply that arrives after a send in this
 * visit reveals; the first load and older pages never animate. The id is
 * computed during render, so the fresh reply mounts already hidden.
 */
import { useEffect, useRef, useState } from 'react';
import type { RomanMessage } from '../../api/romanApi';

function newestAssistantId(messages: readonly RomanMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'assistant') return messages[i].id;
  }
  return null;
}

export function useRomanReveal(messages: readonly RomanMessage[], sending: boolean): string | null {
  const newest = newestAssistantId(messages);
  // The newest reply when the current send started; undefined when idle.
  const baseline = useRef<string | null | undefined>(undefined);
  const [revealed, setRevealed] = useState<string | null>(null);
  const fresh = baseline.current !== undefined && newest != null && newest !== baseline.current ? newest : revealed;

  useEffect(() => {
    if (sending && baseline.current === undefined) baseline.current = newest;
    // A send that ended without a new reply leaves nothing to reveal.
    else if (!sending && baseline.current !== undefined && newest === baseline.current) baseline.current = undefined;
    // newest is read when a send starts or ends only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sending]);

  useEffect(() => {
    if (fresh !== revealed) {
      baseline.current = undefined;
      setRevealed(fresh);
    }
  }, [fresh, revealed]);

  return fresh;
}
