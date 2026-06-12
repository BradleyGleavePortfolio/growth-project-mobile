/**
 * CoachBriefScreen — Wave 11.
 *
 * Daily morning brief for coaches. Shows AI-drafted summary, signoff queue,
 * and a per-client cards strip. STUB: backend not live yet; the adapter
 * returns an empty, stale payload.
 *
 * Doctrine: every AI block requires the coach to approve before posting
 * (e.g. as an announcement). The `approveDraft` toggle below is local-state
 * only until the live endpoint exists.
 */
import React, { useCallback, useEffect, useState } from 'react';
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
import { colors as tokens, typography, spacing } from '../../theme/tokens';
import { fetchCoachBrief } from '../../services/wave11Adapters';
import type { CoachBriefPayload, CoachBriefClientCard } from '../../types/wave11';
import AINote from '../../components/trust/AINote';
import VerifiedProgressRow from '../../components/trust/VerifiedProgressRow';
import EmptyState from '../../components/EmptyState';
import { featureFlags } from '../../config/featureFlags';
// §2.3 Coach Brief — Roman delivers the morning brief in his voice, beside his
// face. FACE+VOICE: RomanBriefCard co-locates <RomanAvatar /> with the §2.3
// copy module (src/lib/roman/copy.ts) in one tree.
import RomanBriefCard from '../../components/roman/RomanBriefCard';
// §2.4 check-in received + §2.5 new client onboarded — both Roman coach
// surfaces (each co-locates <RomanAvatar /> for FACE+VOICE). Gated behind
// featureFlags.romanChat (default OFF), the dedicated Roman flag.
import RomanCheckInNotice from '../../components/roman/RomanCheckInNotice';
import RomanNewClientNotice from '../../components/roman/RomanNewClientNotice';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { logger } from '../../utils/logger';

/**
 * §2.4 submitted-check-in selector. Returns the first client whose latest
 * verified-progress item is a check-in submission (`kind ===
 * 'check_in_consistency'`) still in the `pending` signoff state — which the
 * SignoffStatus enum defines as "submitted, awaiting coach review" (see
 * types/wave11.ts). That is a REAL submitted check-in, exactly what the §2.4
 * default line states. A `check_in_overdue` todo does NOT qualify (an overdue
 * check-in is a missing one, not a submitted one). Exported for direct
 * true/false behaviour testing.
 */
export function selectCheckInClient(
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
 * §2.5 newly-onboarded-client selector. The CoachBriefPayload carries NO
 * first-party "new client" event/flag and NO join/created timestamp on the
 * client card, so there is no truthful onboarding signal to render. This
 * selector therefore returns undefined for every roster: the §2.5 surface is
 * gated OFF rather than inventing an onboarding event (the R4-flagged
 * heuristic). It is kept as a typed seam so the host wiring stays compiled and
 * flag-gated, and so it can be replaced the moment the payload carries a real
 * joined-timestamp/onboarding event — at which point it returns the joined
 * client and the existing render path re-activates with no further wiring.
 */
export function selectNewlyOnboardedClient(
  _clients: CoachBriefClientCard[] | undefined,
): CoachBriefClientCard | undefined {
  // No truthful signal exists in the contract today. Always undefined.
  return undefined;
}

export default function CoachBriefScreen() {
  const currentUser = useCurrentUser();
  const [payload, setPayload] = useState<CoachBriefPayload | null>(null);
  // True when the brief payload could not be assembled (a source was slow) —
  // selects Roman's §2.3 error variant.
  const [briefError, setBriefError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [draftApproved, setDraftApproved] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await fetchCoachBrief();
      setPayload(next);
      setDraftApproved(next.morningSummary.approvedByCoach);
      setBriefError(false);
    } catch (err) {
      // Bradley Law #36: surface the failure (Roman's §2.3 error variant
      // renders below) rather than swallowing it. Logged for diagnostics.
      setBriefError(true);
      logger.warn('CoachBriefScreen', 'failed to load brief', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // §2.4 Check-in received — derived from a REAL submitted-check-in signal in
  // the brief payload: a client whose latest verified-progress item is a
  // check-in submission (`kind === 'check_in_consistency'`) that is still
  // `pending` (the SignoffStatus enum defines `pending` as "submitted, awaiting
  // coach review"; see types/wave11.ts). That proves the client SUBMITTED a
  // check-in and it is queued for the coach — exactly what the §2.4 default
  // line states. First such client only, to keep one Roman line in the brief.
  const checkInClient = selectCheckInClient(payload?.clients);
  // §2.5 New client onboarded — the CoachBriefPayload carries NO first-party
  // "new client" event/flag and NO join/created timestamp on the client card
  // (the only `createdAt` in this domain is on CopilotSuggestion, not on the
  // roster — see types/wave11.ts CoachBriefClientCard). The prior R3 build
  // invented an onboarding event from a roster shape (single quiet client),
  // which the R4 audit correctly flagged as event-theater. With no truthful
  // signal available, the §2.5 surface is gated OFF rather than asserting an
  // onboarding that the data cannot prove. The component + host wiring remain
  // compiled and flag-gated so they re-activate the moment the payload carries
  // a real joined-timestamp/onboarding event. Documented in
  // FIXER_241_R5_REPORT.md (Roman must only assert what the data proves).
  const clientList = payload?.clients ?? [];
  const newClient = selectNewlyOnboardedClient(clientList);

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
          subtitle="The morning brief is in development. We'll enable it for your account once the live data feed ships."
        />
      </View>
    );
  }

  if (loading && !payload) {
    return (
      <View
        style={styles.center}
        accessibilityLabel="Loading today's brief"
        accessibilityRole="none"
      >
        <ActivityIndicator color={tokens.forest} />
      </View>
    );
  }

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

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
      <Text style={styles.subtitle}>
        AI drafts the summary. You approve before anything is sent.
      </Text>

      {/* §2.3 Coach Brief — Roman's voiced delivery + face. Celebration on a
          record morning (all clients on track, none needing attention);
          error if the brief could not be assembled; otherwise default. */}
      <RomanBriefCard
        coachName={(currentUser?.firstName ?? '').trim() || 'Coach'}
        clientCount={payload?.clients.length ?? 0}
        mode={
          briefError
            ? 'error'
            : payload != null && payload.clients.length === 0 && !payload.isStale
              ? 'celebration'
              : 'default'
        }
        testID="roman-brief-card"
      />

      {payload?.isStale ? (
        <View
          style={styles.stale}
          accessibilityLabel="Brief data is not yet live"
          accessibilityRole="none"
        >
          <Ionicons name="time-outline" size={14} color={tokens.charcoal} />
          <Text style={styles.staleText}>Brief data isn&apos;t live yet.</Text>
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.sectionTitle} accessibilityRole="header">Morning summary</Text>
        {payload?.morningSummary.aiDraft ? (
          <>
            <AINote variant="draft">{payload.morningSummary.aiDraft}</AINote>
            <Pressable
              onPress={() => setDraftApproved((v) => !v)}
              style={[styles.approveBtn, draftApproved && styles.approveBtnOn]}
              accessibilityRole="button"
              accessibilityLabel={draftApproved ? 'Draft approved — tap to revoke' : 'Approve draft to send'}
              accessibilityState={{ checked: draftApproved }}
            >
              <Ionicons
                name={draftApproved ? 'checkmark-circle' : 'ellipse-outline'}
                size={18}
                color={draftApproved ? tokens.bone : tokens.forest}
              />
              <Text
                style={[
                  styles.approveLabel,
                  draftApproved && styles.approveLabelOn,
                ]}
              >
                {draftApproved ? 'Approved by you' : 'Approve to send'}
              </Text>
            </Pressable>
          </>
        ) : (
          <EmptyState
            icon="sunny-outline"
            title="No brief yet"
            subtitle="Once your clients log activity, the AI will draft a summary you can review and approve."
          />
        )}
      </View>

      {/* §2.4 Roman check-in notice — voiced beside his face when a real client
          card flags a check-in needing attention. Only when the Roman flag is
          on. */}
      {featureFlags.romanChat && checkInClient ? (
        <RomanCheckInNotice
          clientName={checkInClient.clientDisplayName}
          mode="default"
          testID="roman-checkin-card"
        />
      ) : null}

      {/* §2.5 Roman new-client notice — voiced beside his face when the roster
          reads as a freshly added single client. Only when the Roman flag is
          on. clientCount and clientName are both real. */}
      {featureFlags.romanChat && newClient ? (
        <RomanNewClientNotice
          clientName={newClient.clientDisplayName}
          clientCount={clientList.length}
          mode="default"
          testID="roman-newclient-card"
        />
      ) : null}

      <View style={styles.section}>
        <Text style={styles.sectionTitle} accessibilityRole="header">Clients</Text>
        {payload && payload.clients.length > 0 ? (
          payload.clients.map((c) => <ClientCard key={c.clientId} card={c} />)
        ) : (
          <EmptyState
            icon="people-outline"
            title="No client activity to surface"
            subtitle="Clients will appear here when they log a check-in, hit a streak, or submit a verified-progress claim."
          />
        )}
      </View>
    </ScrollView>
  );
}

function ClientCard({ card }: { card: CoachBriefClientCard }) {
  return (
    <View
      style={styles.card}
      accessibilityRole="none"
      accessibilityLabel={`Client: ${card.clientDisplayName}`}
    >
      <Text style={styles.cardHeadline}>{card.clientDisplayName}</Text>
      <AINote variant="summary">{card.aiSummary}</AINote>
      {card.aiFlags.length > 0 ? (
        <View
          style={styles.flagsBlock}
          accessibilityLabel={`AI flagged ${card.aiFlags.length} items for your review`}
          accessibilityRole="none"
        >
          <Text style={styles.flagsLabel}>AI flagged for your review:</Text>
          {card.aiFlags.map((f, i) => (
            <Text key={i} style={styles.flagText}>
              · {f}
            </Text>
          ))}
        </View>
      ) : null}
      {card.todos.length > 0 ? (
        <View
          style={styles.todos}
          accessibilityLabel={`${card.todos.length} action items`}
          accessibilityRole="none"
        >
          {card.todos.map((t) => (
            <View key={t.id} style={styles.todoRow}>
              <Ionicons name="square-outline" size={14} color={tokens.charcoal} />
              <Text style={styles.todoText}>{t.label}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {card.latestVerifiedProgress ? (
        <VerifiedProgressRow item={card.latestVerifiedProgress} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: tokens.bone },
  content: { padding: spacing.lg, paddingBottom: spacing['3xl'] },
  flagOff: { flex: 1, backgroundColor: tokens.bone, justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: tokens.bone },
  title: { ...typography.h1, color: tokens.ink, marginBottom: spacing.sm },
  subtitle: { ...typography.body, color: tokens.charcoal, marginBottom: spacing.lg },
  stale: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: spacing.md,
  },
  staleText: { ...typography.bodySmall, color: tokens.charcoal },
  section: { marginTop: spacing.lg, gap: spacing.md },
  sectionTitle: { ...typography.h3, color: tokens.ink, marginBottom: spacing.xs },
  card: {
    backgroundColor: tokens.cream,
    borderRadius: 4,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  cardHeadline: { ...typography.h4, color: tokens.ink },
  flagsBlock: { gap: 4 },
  flagsLabel: {
    ...typography.bodySmall,
    color: tokens.charcoal,
    fontWeight: '600',
  },
  flagText: { ...typography.bodySmall, color: tokens.charcoal },
  todos: { gap: 6 },
  todoRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  todoText: { ...typography.bodySmall, color: tokens.ink },
  approveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: tokens.forest,
    alignSelf: 'flex-start',
  },
  approveBtnOn: { backgroundColor: tokens.forest, borderColor: tokens.forest },
  approveLabel: {
    ...typography.bodyMd,
    fontSize: 14,
    color: tokens.forest,
    fontWeight: '600',
  },
  approveLabelOn: { color: tokens.bone },
});
