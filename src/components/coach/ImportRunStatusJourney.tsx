/**
 * ImportRunStatusJourney — R1 (Roman status binding). Mounts the Roman P2
 * import-journey views (`ImportProgressView` / `ImportResultView`) for the
 * PAIRED intent, reading the same authoritative server hook the retired
 * `ImportRunVerdictCard` used (`useImportRunStatus`, S12-B3). Roman on and
 * Roman off both use these views — `romanEnabled` only turns the portrait and
 * first-person completion copy on/off (P2_README "neutral by default"); it
 * never changes which status is shown.
 *
 * This keeps exactly ONE status surface mounted where the verdict card showed
 * today (`ExtensionPairingPanel`'s `paired` state): `ImportRunVerdictCard`'s
 * mount there is retired in favour of this component (R1_GRANT.md scope #2).
 * `ImportRunVerdictCard.tsx` itself is untouched and still exported/tested —
 * only its production mount point moves.
 *
 * The server reading is turned into P2 props by the ONE pure adapter,
 * `mapImportRunStatusToJourneyView` (src/screens/coach/import-journey/
 * importRunStatusAdapter.ts) — this component supplies no status logic of its
 * own, only host wiring: `romanEnabled` from the existing `featureFlags.
 * romanChat` convention (same flag every other import-journey mount reads —
 * see ImportDataScreen.tsx) and a real `onReturnToCoaching` (navigates back
 * to the settings screen the pairing panel lives on; no fabricated no-op).
 *
 * No Start/retry/stop wiring beyond what already existed: `stop` is always
 * `notRequested` (P2 discards it when the adapter never supplies a stop
 * action) and no stop/check-result/details action objects are passed, so the
 * corresponding buttons render as absent (ImportStatusAction requires
 * `action.enabled === true`, never true here). No new polling or timers: the
 * only read is `useImportRunStatus`'s own (20s while non-terminal, foreground
 * refresh) — this component adds none.
 */
import React from 'react';
import { useNavigation, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import { featureFlags } from '../../config/featureFlags';
import { useImportRunStatus } from '../../hooks/useImportRunStatus';
import { mapImportRunStatusToJourneyView } from '../../screens/coach/import-journey/importRunStatusAdapter';
import { ImportProgressView } from '../../screens/coach/import-journey/ImportProgressView';
import { ImportResultView } from '../../screens/coach/import-journey/ImportResultView';

export default function ImportRunStatusJourney({ importIntentId }: { importIntentId: string }): React.ReactElement | null {
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const run = useImportRunStatus(importIntentId);
  const view = mapImportRunStatusToJourneyView(run);
  const onReturnToCoaching = () => navigation.goBack();

  if (view.kind === 'none') return null;
  if (view.kind === 'progress') {
    return <ImportProgressView romanEnabled={featureFlags.romanChat} onReturnToCoaching={onReturnToCoaching} {...view.props} />;
  }
  return <ImportResultView romanEnabled={featureFlags.romanChat} onReturnToCoaching={onReturnToCoaching} {...view.props} />;
}
