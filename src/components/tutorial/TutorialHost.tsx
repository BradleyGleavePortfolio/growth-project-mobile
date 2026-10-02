/**
 * TutorialHost — mounts the client tutorial around ClientNavigator's tabs.
 *
 * Responsibilities (all no-ops when featureFlags.clientTutorial is off, in
 * which case it renders its children only):
 *   - hydrate the per-user tour state once the signed-in user resolves;
 *   - subscribe the step machine to real-world signals (tutorialEvents);
 *   - feed live `/me/macros/current` numbers to the macro card and step;
 *   - fall back to `GET /me/onboarding` for the payload when the tour was
 *     started without one (reinstall, or a caller that passed nothing);
 *   - start a tour that never started after a consultation the server has
 *     completed (Sol B-310-4): the app closed between the complete 200 and
 *     "Show me around", the 200 was lost, or the client signed in again on
 *     a fresh install. Only from `not_started`, so a finished or paused tour
 *     on this device never restarts by itself;
 *   - treat an already-connected wearable (connections list) as the
 *     wearable gate's real action;
 *   - render the overlay.
 *
 * Route focus is reported by ClientNavigator through `setTutorialRoute`.
 */
import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { featureFlags } from '../../config/featureFlags';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useCurrentMacrosForSelf } from '../../hooks/useMacros';
import { useWearableConnections } from '../../hooks/useWearableConnections';
import api from '../../services/api';
import {
  attachTutorialSignals,
  dispatchTutorial,
  hydrateTutorial,
  setTutorialLiveMacros,
  setTutorialPayload,
  startClientTutorial,
  useTutorialStore,
} from '../../tutorial/tutorialStore';
import { currentGate } from '../../tutorial/tutorialMachine';
import { macrosFromTarget, parseOnboardingPayload } from '../../tutorial/onboardingPayload';
import type { TutorialNavTarget } from '../../tutorial/tutorialSteps';
import TutorialOverlay from './TutorialOverlay';
import { reportMacroDisplay } from '../../macros/macroDisplayStore';

export function hasConnectedWearable(list: unknown): boolean {
  return (
    Array.isArray(list) &&
    list.some((c) => !!c && typeof c === 'object' && (c as { status?: unknown }).status === 'connected')
  );
}

function TutorialEffects(): null {
  const user = useCurrentUser();
  const hydrated = useTutorialStore((s) => s.hydrated);
  const tourUserId = useTutorialStore((s) => s.userId);
  const status = useTutorialStore((s) => s.tutorial.status);
  const hasPayload = useTutorialStore((s) => !!s.payload);
  const onWearableGate = useTutorialStore((s) => {
    const g = currentGate(s.tutorial);
    return s.tutorial.status === 'active' && g?.kind === 'signal' && g.signal === 'wearable_connected';
  });
  const macrosQuery = useCurrentMacrosForSelf();
  const connections = useWearableConnections();

  const firstName = user?.firstName ?? user?.name?.split(' ')[0] ?? null;
  useEffect(() => {
    if (user?.id) void hydrateTutorial(user.id, firstName);
  }, [user?.id, firstName]);

  useEffect(() => attachTutorialSignals(), []);

  useEffect(() => {
    if (macrosQuery.data === undefined) return;
    reportMacroDisplay(macrosQuery.data);
    setTutorialLiveMacros(macrosFromTarget(macrosQuery.data));
  }, [macrosQuery.data]);

  useEffect(() => {
    if (!hydrated || hasPayload || status === 'not_started') return;
    let cancelled = false;
    api
      .get('/me/onboarding')
      .then((res) => {
        if (!cancelled) reportMacroDisplay(res?.data);
        const parsed = parseOnboardingPayload(res?.data);
        if (!cancelled && parsed) setTutorialPayload(parsed);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [hydrated, hasPayload, status]);

  // Sol B-310-4: the hand-off from the consultation is recoverable. The
  // server is the truth for completion (backend #607 `completed` comes from
  // the intake, so clients who never did the consultation are not touched).
  useEffect(() => {
    if (!featureFlags.consultationOnboarding || !hydrated || status !== 'not_started' || !tourUserId) return;
    let cancelled = false;
    api
      .get('/me/onboarding')
      .then((res) => {
        if (cancelled) return;
        const now = useTutorialStore.getState();
        if (now.userId !== tourUserId || now.tutorial.status !== 'not_started') return;
        const data = res?.data as { completed?: unknown; result?: unknown } | null | undefined;
        if (!data || data.completed !== true) return;
        startClientTutorial(data.result ?? undefined);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [hydrated, status, tourUserId]);

  useEffect(() => {
    if (onWearableGate && hasConnectedWearable(connections.data)) {
      dispatchTutorial({ type: 'SIGNAL', signal: 'wearable_connected' });
    }
  }, [onWearableGate, connections.data]);

  return null;
}

interface Props {
  children: React.ReactNode;
  /** Mounted tab route names, in tab-bar order. */
  tabs: string[];
  onNavigate: (target: TutorialNavTarget) => void;
}

export default function TutorialHost({ children, tabs, onNavigate }: Props): React.ReactElement {
  if (!featureFlags.clientTutorial) return <>{children}</>;
  return (
    <View style={styles.fill}>
      {children}
      <TutorialEffects />
      <TutorialOverlay tabs={tabs} onNavigate={onNavigate} />
    </View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
