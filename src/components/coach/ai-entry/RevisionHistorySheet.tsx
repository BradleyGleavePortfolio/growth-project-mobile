/**
 * AIB-6 — workout revision history (b#808 route), newest first: author chip, time, one-line summary. Read-only; the header
 * Undo steps back through recent changes. A 404 (route not deployed) says so plainly instead of showing an empty list.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import HapticPressable from '../../HapticPressable';
import { layout, radius, spacing, typography, type SemanticTokens } from '../../../theme/tokens';
import { footerBottomPadding, useScreenInsets } from '../../../ui';
import { listWorkoutRevisions, type WorkoutRevision } from '../../../api/workoutRevisionsApi';
import { AI_LABEL } from '../ai-builder/aiBuilderCopy';
import { useReduceMotion } from '../../../screens/client/wearables/components/useReduceMotion';

export const HISTORY_COPY = {
  unavailable: 'History is not available for this workout yet. Undo still steps back through recent changes.',
  empty: 'No saved versions yet. Each change appears here once it saves.',
  failed: 'History did not load. Check your connection and try again.',
  footer: 'Use Undo in the header to step back through recent changes.',
} as const;

export function authorChip(kind: string): string {
  if (kind === 'ai') return AI_LABEL;
  if (kind === 'sub_coach') return 'Team coach';
  return kind === 'coach' || kind === 'owner' ? 'Coach' : 'System';
}

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

type Props = { planId: string; onClose: () => void; sc: SemanticTokens };

export default function RevisionHistorySheet({ planId, onClose, sc }: Props) {
  const reduceMotion = useReduceMotion();
  const insets = useScreenInsets();
  const [state, setState] = useState<{ items?: WorkoutRevision[] | null; failed?: boolean }>({});
  const load = useCallback(() => {
    let live = true;
    setState({});
    listWorkoutRevisions(planId).then(
      (items) => live && setState({ items }),
      () => live && setState({ failed: true }),
    );
    return () => {
      live = false;
    };
  }, [planId]);
  useEffect(load, [load]);

  const text = (body: string, testID?: string) => (
    <Text testID={testID} style={[typography.body, { color: sc.textMuted, marginVertical: spacing.sm }]}>{body}</Text>
  );
  return (
    <Modal visible transparent animationType={reduceMotion ? 'fade' : 'slide'} onRequestClose={onClose}>
      <View style={[styles.backdrop, { backgroundColor: sc.overlay }]}>
        <View testID="revision-history-sheet" style={[styles.sheet, { backgroundColor: sc.bgPrimary, borderColor: sc.border, paddingBottom: footerBottomPadding(insets.bottom) }]}>
          <View style={[styles.handle, { backgroundColor: sc.border }]} accessible={false} />
          <View style={styles.row}>
            <Text accessibilityRole="header" style={[typography.h2, styles.grow, { color: sc.textPrimary }]}>History</Text>
            <HapticPressable accessibilityRole="button" accessibilityLabel="Close history" onPress={onClose} hitSlop={12} style={styles.close}>
              <Text style={[typography.bodyMd, { color: sc.accentText }]}>Close</Text>
            </HapticPressable>
          </View>
          <ScrollView contentContainerStyle={{ paddingBottom: spacing.lg }}>
            {state.failed ? (
              <>
                {text(HISTORY_COPY.failed, 'revision-history-failed')}
                <HapticPressable accessibilityRole="button" accessibilityLabel="Try loading history again" onPress={load}
                  style={[styles.retry, { borderColor: sc.border }]}>
                  <Text style={[typography.bodyMd, { color: sc.textPrimary }]}>Try again</Text>
                </HapticPressable>
              </>
            ) : state.items === undefined ? (
              <ActivityIndicator color={sc.accentText} accessibilityLabel="Loading history" />
            ) : state.items === null ? (
              text(HISTORY_COPY.unavailable, 'revision-history-unavailable')
            ) : state.items.length === 0 ? (
              text(HISTORY_COPY.empty, 'revision-history-empty')
            ) : (
              state.items.map((r) => (
                <View key={r.revision_index} testID={`revision-${r.revision_index}`} style={[styles.item, { borderColor: sc.border }]}
                  accessible accessibilityLabel={`${authorChip(r.author_kind)}, ${when(r.created_at)}. ${r.summary}`}>
                  <View style={styles.row}>
                    <Text style={[typography.caption, styles.chip, { color: sc.textPrimary, borderColor: r.author_kind === 'ai' ? sc.accentText : sc.border }]}>
                      {authorChip(r.author_kind)}
                    </Text>
                    <Text style={[typography.caption, { color: sc.textMuted }]}>{when(r.created_at)}</Text>
                  </View>
                  <Text style={[typography.body, { color: sc.textPrimary }]}>{r.summary}</Text>
                </View>
              ))
            )}
            {state.items?.length ? text(HISTORY_COPY.footer) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: { maxHeight: '85%', minHeight: '45%', borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, borderWidth: StyleSheet.hairlineWidth, borderBottomWidth: 0, paddingHorizontal: layout.gutter, paddingTop: spacing.sm },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: radius.chip, marginBottom: spacing.md },
  pressed: { opacity: 0.7 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  grow: { flex: 1 },
  item: { borderBottomWidth: 1, paddingVertical: spacing.sm },
  close: { minHeight: 44, justifyContent: 'center' },
  chip: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.control, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  retry: { borderWidth: 1, borderRadius: radius.button, minHeight: 48, justifyContent: 'center', paddingVertical: spacing.sm, alignItems: 'center' },
});
