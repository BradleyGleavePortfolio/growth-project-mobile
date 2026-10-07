/**
 * AIB-6 — Ask AI visibility for entry points outside the workout builder (same rule as AIB-5): the entry hides ONLY when the
 * status route is absent (404 on an older backend). Paused, no credits or an unreadable status keep it visible; the sheet
 * then shows the specific state.
 */
import { useEffect, useState } from 'react';
import { aiBuilderApi, type AiBuilderStatus } from '../../../api/aiBuilderApi';

export function useAiEntryStatus(): { visible: boolean; status: AiBuilderStatus | null } {
  const [s, setS] = useState<{ loaded: boolean; value?: AiBuilderStatus | null }>({ loaded: false });
  useEffect(() => {
    let live = true;
    Promise.resolve()
      .then(() => aiBuilderApi.getStatus())
      .then(
        (value) => live && setS({ loaded: true, value }),
        () => live && setS({ loaded: true }),
      );
    return () => {
      live = false;
    };
  }, []);
  return { visible: s.loaded && s.value !== null, status: s.value ?? null };
}
