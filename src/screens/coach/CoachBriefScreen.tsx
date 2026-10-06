/**
 * CoachBriefScreen — the coach's daily brief, read from the live backend
 * route GET /coach/brief/today (src/api/coachBriefApi.ts).
 *
 * One read each morning: Roman's highlights paragraph (money, replies,
 * check-ins, approvals), then the items that need the coach, each opening the
 * screen that resolves it. The brief is prepared once a day server-side; the
 * daily push opens this screen (pushTapRouter `CoachBrief`).
 *
 * States: preparing (the first open of the day can take a few seconds; a
 * concurrent open polls), ready, could not load (retry), could not be prepared
 * (prepare again, server-throttled), flag off (preview lock).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ScrollView,
  View,
  Text,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { colors as tokens, typography, spacing } from '../../theme/tokens';
import type { CoachBriefClientCard } from '../../types/wave11';
import EmptyState from '../../components/EmptyState';
import { featureFlags } from '../../config/featureFlags';
import {
  coachBriefApi,
  CoachBriefApiError,
  type CoachBrief,
  type CoachBriefActionItem,
} from '../../api/coachBriefApi';
import type { CoachTabParamList } from '../../navigation/CoachNavigator';
// §2.3 Coach Brief — Roman delivers the morning brief beside his face.
// FACE+VOICE: RomanBriefCard co-locates <RomanAvatar /> with the brief text.
import RomanBriefCard from '../../components/roman/RomanBriefCard';
// §2.4 check-in received + §2.5 new client onboarded — Roman coach surfaces
// gated behind featureFlags.romanChat.
import RomanCheckInNotice from '../../components/roman/RomanCheckInNotice';
import RomanNewClientNotice from '../../components/roman/RomanNewClientNotice';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { logger } from '../../utils/logger';

/** A concurrent open sees 'generating'; poll until the brief is ready. */
export const BRIEF_POLL_INTERVAL_MS = 2_500;
export const BRIEF_POLL_MAX_ATTEMPTS = 12;

/**
 * §2.4 pending check-in-consistency-claim selector. Returns the first client
 * whose latest verified-progress item has `kind === 'check_in_consistency'`
 * and is still `pending` (submitted, awaiting coach review). A
 * `check_in_overdue` todo does NOT qualify. Exported for behaviour tests.
 */
export function selectPendingCheckInClaim(
  clients: CoachBriefClientCard[] | undefined,
): CoachBriefClientCard | undefined {
  return clients?.find(
    (c) =>
      c.latestVerifiedProgress != null &&
      c.latestVerifiedProgress.kind === 'check_in_consistency' &&
      c.latestVerifiedProgress.signoffStatus === 'pending',
  );
}

/**
 * §2.5 newly-onboarded-client selector. No truthful onboarding signal exists
 * in the brief contract, so this returns undefined for every roster and the
 * §2.5 surface stays off rather than inventing an onboarding event.
 */
export function selectNewlyOnboardedClient(
  _clients: CoachBriefClientCard[] | undefined,
): CoachBriefClientCard | undefined {
  return undefined;
}

// The live brief route returns action items, not Wave 11 verified-progress
// client cards, so the §2.4 / §2.5 notices have no signal and stay off.
const SURFACED_CLIENT_CARDS: CoachBriefClientCard[] = [];

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; brief: CoachBrief }
  | { kind: 'preparing' }
  | { kind: 'failed' }
  | { kind: 'error' }
  | { kind: 'throttled' };

type BriefNav = NavigationProp<CoachTabParamList>;
/** actionTarget builds nested params per tab; navigate's tuple overloads cannot take a union. */
type LooseNavigate = (name: keyof CoachTabParamList, params?: object) => void;

/** Where an action item opens. null = informational row (no tap). */
export function actionTarget(
  item: CoachBriefActionItem,
): { tab: keyof CoachTabParamList; params?: object } | null {
  const clientId = item.client_id;
  const clientName = item.client_name ?? 'Client';
  switch (item.type) {
    case 'message_unread':
      return clientId
        ? {
            tab: 'ClientsStack',
            params: { screen: 'ClientMessages', params: { clientId, clientName }, initial: false },
          }
        : null;
    case 'workout_approval':
    case 'weight_flag':
    case 'checkin_missing':
      return clientId
        ? {
            tab: 'ClientsStack',
            params: { screen: 'ClientDetail', params: { clientId, clientName }, initial: false },
          }
        : null;
    case 'dunning_queue':
    case 'team_revenue_review':
      return { tab: 'SettingsStack', params: { screen: 'CoachMoney', initial: false } };
    case 'sub_coach_operations':
    case 'team_performance':
      return { tab: 'TeamStack' };
    default:
      return null;
  }
}

const ACTION_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  message_unread: 'chatbubble-ellipses-outline',
  workout_approval: 'barbell-outline',
  weight_flag: 'trending-up-outline',
  checkin_missing: 'calendar-outline',
  dunning_queue: 'card-outline',
  team_revenue_review: 'cash-outline',
  sub_coach_operations: 'people-outline',
  team_performance: 'stats-chart-outline',
};

export default function CoachBriefScreen() {
  const currentUser = useCurrentUser();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  const [preparingAgain, setPreparingAgain] = useState(false);
  const mounted = useRef(true);
  const markedReadId = useRef<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const settle = useCallback((brief: CoachBrief) => {
    if (brief.status === 'generated' && brief.summary) {
      setState({ kind: 'ready', brief });
      if (markedReadId.current !== brief.id) {
        markedReadId.current = brief.id;
        coachBriefApi.markRead(brief.id).catch((err) => {
          logger.warn('CoachBriefScreen', 'failed to mark brief read', err);
        });
      }
      return true;
    }
    if (brief.status === 'failed') {
      setState({ kind: 'failed' });
      return true;
    }
    return false;
  }, []);

  const load = useCallback(async () => {
    try {
      for (let attempt = 0; attempt < BRIEF_POLL_MAX_ATTEMPTS; attempt += 1) {
        const brief = await coachBriefApi.today();
        if (!mounted.current) return;
        if (settle(brief)) return;
        setState((s) => (s.kind === 'ready' ? s : { kind: 'preparing' }));
        await new Promise((r) => setTimeout(r, BRIEF_POLL_INTERVAL_MS));
        if (!mounted.current) return;
      }
      setState({ kind: 'preparing' });
    } catch (err) {
      // Bradley Law #36: surfaced (error state below) and logged.
      logger.warn('CoachBriefScreen', 'failed to load brief', err);
      if (mounted.current) setState({ kind: 'error' });
    } finally {
      if (mounted.current) setRefreshing(false);
    }
  }, [settle]);

  useEffect(() => {
    if (featureFlags.coachBrief) void load();
  }, [load]);

  const prepareAgain = useCallback(async () => {
    setPreparingAgain(true);
    try {
      const brief = await coachBriefApi.regenerate();
      if (!mounted.current) return;
      if (!settle(brief)) await load();
    } catch (err) {
      logger.warn('CoachBriefScreen', 'failed to prepare brief again', err);
      if (mounted.current) {
        setState({
          kind:
            err instanceof CoachBriefApiError && err.kind === 'throttled'
              ? 'throttled'
              : 'error',
        });
      }
    } finally {
      if (mounted.current) setPreparingAgain(false);
    }
  }, [load, settle]);

  if (!featureFlags.coachBrief) {
    return (
      <View
        style={styles.flagOff}
        accessibilityLabel="Coach Brief is preview-only"
        accessibilityRole="none"
      >
        <EmptyState
          icon="lock-closed-outline"
          title="Coach Brief is preview-only"
          subtitle="The morning brief is in development. It turns on for your account once the live data feed ships."
        />
      </View>
    );
  }

  if (state.kind === 'loading') {
    return (
      <View
        style={styles.center}
        accessibilityLabel="Preparing today's brief"
        accessibilityRole="none"
      >
        <ActivityIndicator color={tokens.forest} />
        <Text style={styles.centerText}>Preparing today&apos;s brief</Text>
      </View>
    );
  }

  const onRefresh = () => {
    setRefreshing(true);
    void load();
  };

  // Roman's card falls back to its own greeting only without a narrative.
  const coachName = (currentUser?.firstName ?? '').trim() || 'Coach';
  const summary = state.kind === 'ready' ? state.brief.summary : null;
  const narrative = summary?.narrative;
  const items = summary?.action_items ?? [];
  const briefError = state.kind === 'error';

  // §2.4 / §2.5 — see SURFACED_CLIENT_CARDS.
  const checkInClient = selectPendingCheckInClaim(SURFACED_CLIENT_CARDS);
  const newClient = selectNewlyOnboardedClient(SURFACED_CLIENT_CARDS);

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      accessibilityLabel="Coach Brief screen"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          accessibilityLabel="Pull to refresh today's brief"
        />
      }
    >
      <Text style={styles.title} accessibilityRole="header">Today&apos;s brief</Text>

      {/* §2.3 header. P1-G-01: Roman (face + brief text) only behind
          featureFlags.romanChat; otherwise the same text with no avatar. */}
      {narrative ? (
        featureFlags.romanChat ? (
          <RomanBriefCard
            coachName={coachName}
            clientCount={items.length}
            narrative={narrative}
            mode="default"
            testID="roman-brief-card"
          />
        ) : (
          <CoachBriefHeaderFallback narrative={narrative} testID="coach-brief-header-fallback" />
        )
      ) : null}

      {state.kind === 'preparing' ? (
        <StatusCard
          icon="hourglass-outline"
          title="Today's brief is still being prepared."
          detail="It appears here in a moment. Pull down to check again."
          testID="coach-brief-preparing"
        />
      ) : null}

      {state.kind === 'failed' ? (
        <StatusCard
          icon="refresh-outline"
          title="Today's brief could not be prepared."
          detail="Tap Prepare again to build it from the latest activity."
          ctaLabel="Prepare again"
          onCta={prepareAgain}
          busy={preparingAgain}
          testID="coach-brief-failed"
        />
      ) : null}

      {state.kind === 'throttled' ? (
        <StatusCard
          icon="time-outline"
          title="Today's brief was prepared several times this hour."
          detail="It can be prepared again within the hour. Pull down to load the latest version."
          testID="coach-brief-throttled"
        />
      ) : null}

      {briefError ? (
        <StatusCard
          icon="cloud-offline-outline"
          title="Today's brief could not load."
          detail="Check the connection, then try again."
          ctaLabel="Try again"
          onCta={() => {
            setState({ kind: 'loading' });
            void load();
          }}
          testID="coach-brief-error"
        />
      ) : null}

      {/* §2.4 / §2.5 Roman notices — no signal from the live brief route yet
          (SURFACED_CLIENT_CARDS); kept wired behind their flags. */}
      {featureFlags.romanChat && featureFlags.romanCheckInBackendLive && checkInClient ? (
        <RomanCheckInNotice
          clientName={checkInClient.clientDisplayName}
          mode="default"
          testID="roman-checkin-card"
        />
      ) : null}
      {featureFlags.romanChat && newClient ? (
        <RomanNewClientNotice
          clientName={newClient.clientDisplayName}
          clientCount={SURFACED_CLIENT_CARDS.length}
          mode="default"
          testID="roman-newclient-card"
        />
      ) : null}

      {summary ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle} accessibilityRole="header">Needs you</Text>
          {items.length > 0 ? (
            items.map((item, i) => (
              <ActionRow key={`${item.type}-${item.client_id ?? 'team'}-${i}`} item={item} />
            ))
          ) : (
            <Text style={styles.allClear} testID="coach-brief-all-clear">
              Nothing needs you right now.
            </Text>
          )}
          <Text style={styles.footnote}>
            {summary.generated_by === 'ai'
              ? 'Prepared by Roman from today\u2019s activity.'
              : 'Prepared from today\u2019s activity.'}
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

/**
 * CoachBriefHeaderFallback — the non-Roman brief header shown when
 * featureFlags.romanChat is OFF (P1-G-01): the same brief text with no avatar
 * and no Roman voice. The narrative already opens with the greeting.
 */
export function CoachBriefHeaderFallback({
  narrative,
  testID,
}: {
  narrative: string;
  testID?: string;
}) {
  return (
    <View
      style={styles.fallbackCard}
      testID={testID}
      accessibilityRole="summary"
      accessibilityLabel={narrative}
    >
      <Text style={styles.fallbackNarrative}>{narrative}</Text>
    </View>
  );
}

function ActionRow({ item }: { item: CoachBriefActionItem }) {
  const navigation = useNavigation<BriefNav>();
  const target = actionTarget(item);
  const label = item.client_name ? `${item.client_name}: ${item.detail}` : item.detail;
  const body = (
    <>
      <Ionicons
        name={ACTION_ICON[item.type] ?? 'ellipse-outline'}
        size={18}
        color={tokens.forest}
      />
      <View style={styles.actionText}>
        {item.client_name ? <Text style={styles.actionName}>{item.client_name}</Text> : null}
        <Text style={styles.actionDetail}>{item.detail}</Text>
      </View>
      {target ? <Ionicons name="chevron-forward" size={16} color={tokens.charcoal} /> : null}
    </>
  );
  if (!target) {
    return (
      <View style={styles.actionRow} accessibilityLabel={label} testID={`brief-action-${item.type}`}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      style={({ pressed }) => [styles.actionRow, pressed && styles.actionRowPressed]}
      onPress={() => (navigation.navigate as LooseNavigate).call(navigation, target.tab, target.params)}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Opens the screen for this item"
      testID={`brief-action-${item.type}`}
    >
      {body}
    </Pressable>
  );
}

function StatusCard({
  icon,
  title,
  detail,
  ctaLabel,
  onCta,
  busy,
  testID,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  detail: string;
  ctaLabel?: string;
  onCta?: () => void;
  busy?: boolean;
  testID?: string;
}) {
  return (
    <View style={styles.statusCard} testID={testID} accessibilityRole="summary">
      <View style={styles.statusHead}>
        <Ionicons name={icon} size={18} color={tokens.charcoal} />
        <Text style={styles.statusTitle}>{title}</Text>
      </View>
      <Text style={styles.statusDetail}>{detail}</Text>
      {ctaLabel && onCta ? (
        <Pressable
          onPress={onCta}
          disabled={busy}
          style={styles.statusBtn}
          accessibilityRole="button"
          accessibilityLabel={ctaLabel}
          accessibilityState={{ busy: !!busy, disabled: !!busy }}
        >
          {busy ? (
            <ActivityIndicator color={tokens.bone} />
          ) : (
            <Text style={styles.statusBtnLabel}>{ctaLabel}</Text>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: tokens.bone },
  content: { padding: spacing.lg, paddingBottom: spacing['3xl'] },
  flagOff: { flex: 1, backgroundColor: tokens.bone, justifyContent: 'center' },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: tokens.bone,
  },
  centerText: { ...typography.bodySmall, color: tokens.charcoal },
  title: { ...typography.h1, color: tokens.ink, marginBottom: spacing.lg },
  fallbackCard: {
    padding: spacing.lg,
    backgroundColor: tokens.cream,
    borderRadius: 4,
    marginBottom: spacing.lg,
  },
  fallbackNarrative: { ...typography.body, color: tokens.ink },
  section: { marginTop: spacing.sm, gap: spacing.sm },
  sectionTitle: { ...typography.h3, color: tokens.ink, marginBottom: spacing.xs },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 48,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: tokens.cream,
    borderRadius: 4,
  },
  actionRowPressed: { opacity: 0.7 },
  actionText: { flex: 1, gap: 2 },
  actionName: { ...typography.bodyMd, fontSize: 15, fontWeight: '600', color: tokens.ink },
  actionDetail: { ...typography.bodySmall, color: tokens.charcoal },
  allClear: { ...typography.body, color: tokens.charcoal },
  footnote: { ...typography.bodySmall, color: tokens.charcoal, marginTop: spacing.md },
  statusCard: {
    gap: spacing.sm,
    padding: spacing.lg,
    backgroundColor: tokens.cream,
    borderRadius: 4,
    marginBottom: spacing.lg,
  },
  statusHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  statusTitle: { ...typography.h4, color: tokens.ink, flex: 1 },
  statusDetail: { ...typography.bodySmall, color: tokens.charcoal },
  statusBtn: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: 4,
    backgroundColor: tokens.forest,
    marginTop: spacing.xs,
  },
  statusBtnLabel: { ...typography.bodyMd, fontSize: 15, fontWeight: '600', color: tokens.bone },
});
