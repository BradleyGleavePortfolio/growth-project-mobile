/**
 * BloodworkReviewQueueScreen — coach-facing review queue (scaffold).
 *
 * v1 contract:
 *   - feature-flagged OFF by default; renders bland fail-closed when off
 *   - lists `BloodworkReviewQueueItem`s (server-supplied) so the coach
 *     can pick the next panel to review
 *   - copy in the queue is purely descriptive — no AI text leaks here
 *   - actions on a panel (`mark reviewed`, `request source`, `refer to
 *     clinician`, `hide from client`, `flag disputed`, `approve / reject
 *     AI draft`) are stubbed; backend is tracked in
 *     docs/BLOODWORK_HANDOFF.md
 */

import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import HapticPressable from '../../components/HapticPressable';
import EmptyState from '../../components/EmptyState';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { isFeatureEnabled } from '../../config/featureFlags';
import {
  BLOODWORK_DISCLAIMER_SHORT,
  BLOODWORK_COACH_EMPTY_TITLE,
  BLOODWORK_COACH_EMPTY_BODY,
  BLOODWORK_FEATURE_OFF_TITLE,
  BLOODWORK_FEATURE_OFF_BODY,
  BLOODWORK_COACH_ACTIONS,
} from '../../constants/bloodworkCopy';
import {
  BloodworkReviewQueueItem,
  BloodworkReviewState,
} from '../../types/bloodwork';
import { canTransition } from '../../lib/bloodworkSignoff';

// Server-shaped list. Empty in v1 — backend hookup tracked separately.
const QUEUE_PLACEHOLDER: BloodworkReviewQueueItem[] = [];

export default function BloodworkReviewQueueScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const enabled = isFeatureEnabled('bloodwork');

  const [items] = useState<BloodworkReviewQueueItem[]>(QUEUE_PLACEHOLDER);

  if (!enabled) {
    return (
      <SafeAreaView style={styles.safe}>
        <EmptyState
          icon="flask-outline"
          title={BLOODWORK_FEATURE_OFF_TITLE}
          subtitle={BLOODWORK_FEATURE_OFF_BODY}
        />
      </SafeAreaView>
    );
  }

  const handleAction = (
    panelId: string,
    from: BloodworkReviewState,
    to: BloodworkReviewState,
    label: string,
  ) => {
    if (!canTransition(from, to)) {
      Alert.alert('Action not available', `Cannot move panel from ${from} to ${to}.`);
      return;
    }
    Alert.alert('Recorded locally', `${label} for panel ${panelId}. Wired to backend in a follow-up.`);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.h1}>Lab review queue</Text>
        <Text style={styles.shortDisclaimer}>{BLOODWORK_DISCLAIMER_SHORT}</Text>

        {items.length === 0 ? (
          <EmptyState
            icon="document-text-outline"
            title={BLOODWORK_COACH_EMPTY_TITLE}
            subtitle={BLOODWORK_COACH_EMPTY_BODY}
          />
        ) : (
          items.map((item) => (
            <View key={item.panelId} style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.clientName}>{item.clientDisplayName}</Text>
                <Text style={styles.submittedAt}>{formatSubmittedAt(item.submittedAt)}</Text>
              </View>
              <View style={styles.metaRow}>
                <Pill label={prettyState(item.reviewState)} colors={colors} />
                {item.flaggedMarkerCount > 0 ? (
                  <Pill label={`${item.flaggedMarkerCount} flagged`} colors={colors} tone="warn" />
                ) : null}
                {item.hasUnreviewedAIDraft ? (
                  <Pill label="AI draft pending" colors={colors} tone="info" />
                ) : null}
              </View>

              <View style={styles.actionsRow}>
                <ActionBtn
                  icon="checkmark-circle-outline"
                  label={BLOODWORK_COACH_ACTIONS.markReviewed}
                  onPress={() =>
                    handleAction(
                      item.panelId,
                      item.reviewState,
                      'coach_reviewed',
                      BLOODWORK_COACH_ACTIONS.markReviewed,
                    )
                  }
                  colors={colors}
                />
                <ActionBtn
                  icon="help-circle-outline"
                  label={BLOODWORK_COACH_ACTIONS.requestSource}
                  onPress={() =>
                    handleAction(
                      item.panelId,
                      item.reviewState,
                      'needs_source',
                      BLOODWORK_COACH_ACTIONS.requestSource,
                    )
                  }
                  colors={colors}
                />
                <ActionBtn
                  icon="medkit-outline"
                  label={BLOODWORK_COACH_ACTIONS.referToClinician}
                  onPress={() =>
                    handleAction(
                      item.panelId,
                      item.reviewState,
                      'needs_clinician_context',
                      BLOODWORK_COACH_ACTIONS.referToClinician,
                    )
                  }
                  colors={colors}
                />
                <ActionBtn
                  icon="eye-off-outline"
                  label={BLOODWORK_COACH_ACTIONS.hideFromClient}
                  onPress={() =>
                    handleAction(
                      item.panelId,
                      item.reviewState,
                      'hidden_from_client',
                      BLOODWORK_COACH_ACTIONS.hideFromClient,
                    )
                  }
                  colors={colors}
                />
                <ActionBtn
                  icon="flag-outline"
                  label={BLOODWORK_COACH_ACTIONS.flagDisputed}
                  onPress={() =>
                    handleAction(
                      item.panelId,
                      item.reviewState,
                      'disputed_flagged',
                      BLOODWORK_COACH_ACTIONS.flagDisputed,
                    )
                  }
                  colors={colors}
                />
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function prettyState(state: BloodworkReviewState): string {
  switch (state) {
    case 'draft_client_entered': return 'Draft';
    case 'submitted': return 'Submitted';
    case 'needs_source': return 'Needs source';
    case 'needs_clinician_context': return 'Clinician referral';
    case 'coach_reviewed': return 'Reviewed';
    case 'hidden_from_client': return 'Hidden';
    case 'disputed_flagged': return 'Disputed';
  }
}

function formatSubmittedAt(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
  } catch {
    return '';
  }
}

interface PillProps {
  label: string;
  colors: ThemeColors;
  tone?: 'neutral' | 'warn' | 'info';
}
function Pill({ label, colors, tone = 'neutral' }: PillProps) {
  const styles = makeStyles(colors);
  const toneStyle =
    tone === 'warn'
      ? styles.pillWarn
      : tone === 'info'
        ? styles.pillInfo
        : styles.pillNeutral;
  return (
    <View style={[styles.pill, toneStyle]}>
      <Text style={styles.pillText}>{label}</Text>
    </View>
  );
}

interface ActionBtnProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  colors: ThemeColors;
}
function ActionBtn({ icon, label, onPress, colors }: ActionBtnProps) {
  const styles = makeStyles(colors);
  return (
    <HapticPressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={styles.actionBtn}
    >
      <Ionicons name={icon} size={14} color={colors.textSecondary} />
      <Text style={styles.actionBtnText}>{label}</Text>
    </HapticPressable>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.background },
    scroll: { padding: 16, paddingBottom: 48 },
    h1: {
      fontSize: 24,
      fontWeight: '500',
      color: colors.textPrimary,
    },
    shortDisclaimer: {
      fontSize: 12,
      color: colors.textMuted,
      marginTop: 4,
      marginBottom: 16,
    },
    card: {
      padding: 14,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      marginBottom: 12,
    },
    cardHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'baseline',
    },
    clientName: {
      fontSize: 15,
      fontWeight: '500',
      color: colors.textPrimary,
    },
    submittedAt: { fontSize: 12, color: colors.textMuted },
    metaRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      marginTop: 8,
    },
    pill: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 999,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.divider,
    },
    pillNeutral: { backgroundColor: colors.background },
    pillWarn: { backgroundColor: colors.noticeWarningBg },
    pillInfo: { backgroundColor: colors.macroCarbsChipBg },
    pillText: { fontSize: 11, color: colors.textSecondary },
    actionsRow: {
      marginTop: 10,
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
    },
    actionBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.divider,
      backgroundColor: colors.background,
    },
    actionBtnText: { fontSize: 12, color: colors.textSecondary },
  });
}
