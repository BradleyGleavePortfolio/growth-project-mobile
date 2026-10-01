/**
 * SafetyMenu — the Report / Block control attached to every piece of community
 * user-generated content (posts, comments, cohort/challenge comments, DM
 * messages). Apple App Review 1.2 requires users to be able to report
 * objectionable content and block abusive users from the content itself.
 *
 * A 44pt "More" button opens a sheet:
 *   - Report…  -> reason list (backend report reasons) -> POST /community/moderation/reports
 *   - Block <name> (only for other people's content) -> confirm -> POST /community/blocks
 * Blocking hides the person's content and closes DMs both ways; the blocked
 * person is not told. Members cannot block their own coach (server 403), in
 * which case the calm server-specific copy is shown and they can still report.
 */
import React, { useState } from 'react';
import { Alert, Modal, View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import HapticPressable from '../HapticPressable';
import { useTheme } from '../../theme/useTheme';
import { spacing, radius, semantic } from '../../theme/tokens';
import {
  communitySafetyApi,
  blockErrorMessage,
  COMMUNITY_REPORT_REASONS,
  type CommunityReportTargetType,
} from '../../api/communitySafetyApi';

export interface SafetyMenuProps {
  targetType: CommunityReportTargetType;
  targetId: string;
  /** Author of the content. Omit (or pass the viewer's id) to hide Block. */
  authorUserId?: string | null;
  authorName?: string | null;
  /** Viewer's own user id; their own content gets no Report/Block. */
  viewerUserId?: string | null;
  /** Called after a successful block (screens refetch / navigate away). */
  onBlocked?: (userId: string) => void;
  testID?: string;
}

type Step = 'menu' | 'reasons';

export default function SafetyMenu({
  targetType,
  targetId,
  authorUserId,
  authorName,
  viewerUserId,
  onBlocked,
  testID = 'safety-menu',
}: SafetyMenuProps): React.ReactElement | null {
  const { semanticColors } = useTheme();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>('menu');
  const [busy, setBusy] = useState(false);

  const isOwn = !!viewerUserId && !!authorUserId && viewerUserId === authorUserId;
  if (isOwn || !targetId) return null;
  const canBlock = !!authorUserId;
  const who = authorName?.trim() || 'this member';

  const close = () => {
    setOpen(false);
    setStep('menu');
  };

  const submitReport = async (reason: string) => {
    setBusy(true);
    try {
      await communitySafetyApi.report({ target_type: targetType, target_id: targetId, reason });
      close();
      Alert.alert(
        'Report sent',
        'Thank you. Your coach and the team review reports and remove content that breaks the community guidelines.',
      );
    } catch {
      Alert.alert('Could not send report', 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const confirmBlock = () => {
    if (!authorUserId) return;
    Alert.alert(
      `Block ${who}?`,
      'You will no longer see their posts, comments, messages or voice notes, and neither of you can message the other. They are not notified. You can unblock them from Community safety.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              await communitySafetyApi.block(authorUserId);
              close();
              // Refetch every community surface so the blocked person's content
              // disappears everywhere at once.
              await qc.invalidateQueries({ queryKey: ['community'] });
              onBlocked?.(authorUserId);
            } catch (err) {
              Alert.alert('Could not block', blockErrorMessage(err));
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  return (
    <>
      <HapticPressable
        intent="light"
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`Report or block ${who}`}
        hitSlop={8}
        style={styles.trigger}
        testID={testID}
      >
        <Ionicons name="ellipsis-horizontal" size={18} color={semanticColors.textMuted} />
      </HapticPressable>
      <Modal visible={open} transparent animationType="slide" onRequestClose={close}>
        <View style={[styles.backdrop, { backgroundColor: semanticColors.overlay }]}>
          <View
            style={[
              styles.sheet,
              { backgroundColor: semanticColors.bgSurface, borderColor: semanticColors.border },
            ]}
            testID={`${testID}-sheet`}
          >
            {busy ? (
              <ActivityIndicator color={semanticColors.accent} style={styles.busy} />
            ) : step === 'menu' ? (
              <>
                <HapticPressable
                  intent="light"
                  onPress={() => setStep('reasons')}
                  accessibilityRole="button"
                  accessibilityLabel="Report this content"
                  style={styles.row}
                  testID={`${testID}-report`}
                >
                  <Ionicons name="flag-outline" size={18} color={semanticColors.textPrimary} />
                  <Text style={[styles.rowText, { color: semanticColors.textPrimary }]}>Report</Text>
                </HapticPressable>
                {canBlock ? (
                  <HapticPressable
                    intent="warning"
                    onPress={confirmBlock}
                    accessibilityRole="button"
                    accessibilityLabel={`Block ${who}`}
                    style={styles.row}
                    testID={`${testID}-block`}
                  >
                    <Ionicons name="remove-circle-outline" size={18} color={semantic.danger.fg} />
                    <Text style={[styles.rowText, { color: semantic.danger.fg }]}>Block {who}</Text>
                  </HapticPressable>
                ) : null}
              </>
            ) : (
              <>
                <Text style={[styles.heading, { color: semanticColors.textPrimary }]}>
                  Why are you reporting this?
                </Text>
                {COMMUNITY_REPORT_REASONS.map((r) => (
                  <HapticPressable
                    key={r.code}
                    intent="light"
                    onPress={() => submitReport(r.code)}
                    accessibilityRole="button"
                    accessibilityLabel={r.label}
                    style={styles.row}
                    testID={`${testID}-reason-${r.code}`}
                  >
                    <Text style={[styles.rowText, { color: semanticColors.textPrimary }]}>
                      {r.label}
                    </Text>
                  </HapticPressable>
                ))}
              </>
            )}
            <HapticPressable
              intent="light"
              onPress={close}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={styles.row}
              testID={`${testID}-close`}
            >
              <Text style={[styles.rowText, { color: semanticColors.textMuted }]}>Cancel</Text>
            </HapticPressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },
  heading: {
    fontSize: 15,
    fontWeight: '600',
    paddingVertical: spacing.sm,
  },
  row: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  rowText: {
    fontSize: 16,
  },
  busy: {
    paddingVertical: spacing.xl,
  },
});
