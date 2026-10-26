/**
 * SafetyMenu — the Report / Block control attached to every piece of community
 * user-generated content (posts, comments, cohort/challenge comments, DM
 * messages, voice notes, member wins). Apple App Review 1.2 requires users to
 * be able to report objectionable content and block abusive users from the
 * content itself. On the viewer's own content it offers Delete instead (when
 * the screen passes onDelete).
 *
 * A 44pt "More" button opens a sheet:
 *   - Report…  -> reason list (backend report reasons) -> POST /community/moderation/reports
 *   - Block <name> (only for other members' content) -> confirm -> POST /community/blocks
 * Blocking is two-way: neither person sees the other's posts, comments,
 * messages or voice notes, and DMs close both ways; the blocked person is not
 * told. Members cannot block their own coach, so Block is not offered on the
 * coach's content (no dead button); Report always is. "Report sent" after
 * "Self-harm or suicide" leads with 911 and the 988 Lifeline.
 * The sheet is the GOAL B-06a sheet for every host (white, 24 top corners, grab, reason rows with a
 * chevron, the approved emergency line, a centred Cancel); a voice note adds the note card on top.
 * A host that lets a coach remove other members' content passes onDelete for it: the menu then offers
 * Report, Block and Delete (GOAL B-06c), with the same "Delete this …?" confirm.
 * Owner #174-4 (voice notes): a host passes `reported` once the viewer reported the item, so the menu keeps
 * Block and shows Report as done ("Reported", RB-W7); and passes onRemove for the space's coach or the
 * platform owner on someone else's item: "Remove for everyone" (RB-W1) asks in this same sheet (RB-W2,
 * RB-W3), so the menu rows are gone before the question shows and no alert is raised over, or while
 * closing, the menu (iOS can drop an Alert raised while a Modal is closing).
 * Failures use describeCommunityFailure: specific copy per server code and
 * status, a support reference (and a Sentry report) for anything unexpected.
 * Opus R5-B4: an Alert that follows the sheet (the Delete and Block confirms, "Report sent") is raised
 * only once the sheet has gone: from the Modal's onDismiss on iOS (an Alert raised while a Modal is
 * up or closing can be dropped there), right after closing elsewhere.
 * Sol R5-B2: the sheet is at most 90% of the screen and its steps scroll above a fixed Cancel, so the
 * note card and the first reasons stay reachable on a 360-wide phone at 130% text.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Modal, Platform, ScrollView, View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import HapticPressable from '../HapticPressable';
import { useTheme } from '../../theme/useTheme';
import { brand, forestPop as fp, neutral, spacing, semantic, voiceFaces, voiceShades } from '../../theme/tokens';
import { describeCommunityFailure } from '../../api/communityErrors';
import {
  communitySafetyApi,
  COMMUNITY_REPORT_REASONS,
  COMMUNITY_REPORT_SENT_TITLE,
  communityReportSentMessage,
  COMMUNITY_GUIDELINES,
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
  /**
   * The viewer's coach (owner of the community workspace). Members cannot
   * block their coach, so Block is not offered on the coach's content.
   */
  viewerCoachId?: string | null;
  /** Called after a successful block (screens refetch / navigate away). */
  onBlocked?: (userId: string) => void;
  /**
   * Delete, confirmed first. Hosts pass it for the viewer's own content (own content then gets a
   * menu with Delete only) and, on voice notes, for the workspace coach on anyone's note (GOAL
   * B-06c: Report, Block and Delete). Without it own content gets no menu.
   */
  onDelete?: () => Promise<void>;
  /** Called once a report is sent (the voice feed folds the reported note away, GOAL B-06b). */
  onReported?: () => void;
  /** The viewer already reported this: Report shows as done ("Reported"); Block and Remove stay. */
  reported?: boolean;
  /**
   * Remove for everyone (owner #174-4): the space's coach or the platform owner on someone else's
   * content. Confirmed in this sheet; everyone then sees that it was removed.
   */
  onRemove?: () => Promise<void>;
  /** The item the report is about, drawn as a card above the reasons (GOAL B-06a). */
  context?: { name: string; detail: string };
  /** What is being deleted, for the confirm copy, e.g. "win" or "voice note". */
  contentNoun?: string;
  testID?: string;
}

type Step = 'menu' | 'reasons' | 'confirm-remove';

export default function SafetyMenu({
  targetType,
  targetId,
  authorUserId,
  authorName,
  viewerUserId,
  viewerCoachId,
  onBlocked,
  onDelete,
  onReported,
  reported = false,
  onRemove,
  context,
  contentNoun = 'post',
  testID = 'safety-menu',
}: SafetyMenuProps): React.ReactElement | null {
  const { semanticColors, colorScheme } = useTheme();
  // GOAL B-06a draws the light sheet; dark mode keeps the theme's surface and lines.
  const light = colorScheme !== 'dark';
  const sheetBg = light ? neutral[0] : semanticColors.bgSurface;
  const lineColor = light ? voiceShades.hairline : semanticColors.border;
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>('menu');
  const [busy, setBusy] = useState(false);
  // Opus R5-B4: what to run once the sheet has finished closing (see afterClose).
  const afterCloseRef = useRef<(() => void) | null>(null);
  const runAfterClose = () => {
    const next = afterCloseRef.current;
    afterCloseRef.current = null;
    next?.();
  };
  // If the host unmounts the menu mid-close (a refetch drops the row), still show what was waiting.
  useEffect(
    () => () => {
      const next = afterCloseRef.current;
      afterCloseRef.current = null;
      next?.();
    },
    [],
  );

  const isOwn = !!viewerUserId && !!authorUserId && viewerUserId === authorUserId;
  if (!targetId || (isOwn && !onDelete)) return null;
  const isCoach = !!viewerCoachId && !!authorUserId && viewerCoachId === authorUserId;
  const canBlock = !!authorUserId && !isCoach;
  const who = authorName?.trim() || 'this member';

  const close = () => {
    setOpen(false);
    setStep('menu');
  };

  /** Close the sheet, then run `next` once it is gone (iOS: the Modal's onDismiss). */
  const afterClose = (next: () => void) => {
    close();
    if (Platform.OS === 'ios') afterCloseRef.current = next;
    else next();
  };

  const submitReport = async (reason: string) => {
    setBusy(true);
    try {
      await communitySafetyApi.report({ target_type: targetType, target_id: targetId, reason });
      // "Report sent" carries the 911 / 988 line after Self-harm: raise it once the sheet is gone, then
      // fold the note (a host may unmount this menu when it folds).
      afterClose(() => {
        Alert.alert(COMMUNITY_REPORT_SENT_TITLE, communityReportSentMessage(reason));
        onReported?.();
      });
    } catch (err) {
      const failure = describeCommunityFailure(err, 'report');
      Alert.alert(failure.title, failure.message);
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = () => {
    if (!onDelete) return;
    afterClose(() => Alert.alert(
      `Delete this ${contentNoun}?`,
      `It will be removed for everyone in your community. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await onDelete();
            } catch (err) {
              const failure = describeCommunityFailure(err, 'delete');
              Alert.alert(failure.title, failure.message);
            }
          },
        },
      ],
    ));
  };

  const submitRemove = async () => {
    if (!onRemove) return;
    setBusy(true);
    try {
      await onRemove();
      close();
    } catch (err) {
      const failure = describeCommunityFailure(err, 'delete');
      Alert.alert(failure.title, failure.message);
    } finally {
      setBusy(false);
    }
  };

  const confirmBlock = () => {
    if (!authorUserId) return;
    afterClose(() => Alert.alert(
      `Block ${who}?`,
      `You and ${who} will no longer see each other's posts, comments, messages or voice notes, and neither of you can message the other. They are not told. You can unblock them from Community safety.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: async () => {
            try {
              await communitySafetyApi.block(authorUserId);
              // Refetch every community surface so the blocked person's content
              // disappears everywhere at once.
              await qc.invalidateQueries({ queryKey: ['community'] });
              onBlocked?.(authorUserId);
            } catch (err) {
              const failure = describeCommunityFailure(err, 'block');
              Alert.alert(failure.title, failure.message);
            }
          },
        },
      ],
    ));
  };

  return (
    <>
      <HapticPressable
        intent="light"
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        // #175-W: a viewer who can also remove this (the coach) hears all three actions.
        accessibilityLabel={
          isOwn ? `Options for your ${contentNoun}` : onDelete ? 'Report, block or remove' : `Report or block ${who}`
        }
        hitSlop={8}
        style={styles.trigger}
        testID={testID}
      >
        <Ionicons name="ellipsis-horizontal" size={18} color={semanticColors.textMuted} />
      </HapticPressable>
      <Modal visible={open} transparent animationType="slide" onRequestClose={close} onDismiss={runAfterClose}>
        <View style={[styles.backdrop, { backgroundColor: semanticColors.overlay }]}>
          <View
            style={[styles.sheet, { backgroundColor: sheetBg }]}
            testID={`${testID}-sheet`}
          >
            <View style={[styles.grab, { backgroundColor: light ? voiceShades.track : semanticColors.border }]} />
            <ScrollView style={styles.body} bounces={false} testID={`${testID}-scroll`}>
            {busy ? (
              <ActivityIndicator color={semanticColors.accent} style={styles.busy} />
            ) : step === 'menu' ? (
              <>
                {!isOwn && reported ? (
                  // Done, not a button: the report is in; Block (and Remove) stay below.
                  <View
                    accessible
                    accessibilityLabel="Reported"
                    accessibilityState={{ disabled: true }}
                    style={styles.row}
                    testID={`${testID}-reported`}
                  >
                    <Ionicons name="checkmark" size={18} color={light ? fp.n700 : semanticColors.textMuted} />
                    <Text style={[styles.rowText, { color: light ? fp.n700 : semanticColors.textMuted }]}>Reported</Text>
                  </View>
                ) : !isOwn ? (
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
                ) : null}
                {!isOwn && canBlock ? (
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
                {!isOwn && onRemove ? (
                  <HapticPressable
                    intent="warning"
                    onPress={() => setStep('confirm-remove')}
                    accessibilityRole="button"
                    accessibilityLabel="Remove for everyone"
                    style={styles.row}
                    testID={`${testID}-remove`}
                  >
                    <Ionicons name="trash-outline" size={18} color={semantic.danger.fg} />
                    <Text style={[styles.rowText, { color: semantic.danger.fg }]}>Remove for everyone</Text>
                  </HapticPressable>
                ) : null}
                {onDelete ? (
                  <HapticPressable
                    intent="warning"
                    onPress={confirmDelete}
                    accessibilityRole="button"
                    accessibilityLabel={`Delete this ${contentNoun}`}
                    style={styles.row}
                    testID={`${testID}-delete`}
                  >
                    <Ionicons name="trash-outline" size={18} color={semantic.danger.fg} />
                    <Text style={[styles.rowText, { color: semantic.danger.fg }]}>
                      Delete {contentNoun}
                    </Text>
                  </HapticPressable>
                ) : null}
              </>
            ) : step === 'confirm-remove' ? (
              <View style={styles.confirm} testID={`${testID}-confirm-remove`}>
                <Text style={[styles.heading, { color: semanticColors.textPrimary }]} accessibilityRole="header">
                  {`Remove this ${contentNoun} for everyone?`}
                </Text>
                <Text style={[styles.confirmBody, { color: light ? fp.n700 : semanticColors.textMuted }]}>
                  Everyone in this space will see that you removed it.
                </Text>
                <HapticPressable
                  intent="warning"
                  onPress={() => void submitRemove()}
                  accessibilityRole="button"
                  accessibilityLabel="Remove for everyone"
                  style={styles.removeBtn}
                  testID={`${testID}-remove-confirm`}
                >
                  <Text style={styles.removeBtnText}>Remove for everyone</Text>
                </HapticPressable>
              </View>
            ) : (
              <>
                {context ? (
                  <View
                    style={[styles.context, { backgroundColor: sheetBg, borderColor: lineColor }]}
                    testID={`${testID}-context`}
                  >
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>{context.name.trim().charAt(0).toUpperCase()}</Text>
                    </View>
                    <Text style={[styles.contextText, { color: semanticColors.textPrimary }]} numberOfLines={2}>
                      <Text style={styles.contextName}>{context.name}</Text>
                      {'\n'}
                      {context.detail}
                    </Text>
                  </View>
                ) : null}
                <Text style={[styles.heading, { color: semanticColors.textPrimary }]} accessibilityRole="header">
                  Why are you reporting this?
                </Text>
                {COMMUNITY_REPORT_REASONS.map((r, i) => (
                  <HapticPressable
                    key={r.code}
                    intent="light"
                    onPress={() => submitReport(r.code)}
                    accessibilityRole="button"
                    accessibilityLabel={r.label}
                    style={[
                      styles.reason,
                      i < COMMUNITY_REPORT_REASONS.length - 1
                        ? { borderBottomWidth: 1, borderBottomColor: lineColor }
                        : null,
                    ]}
                    testID={`${testID}-reason-${r.code}`}
                  >
                    <Text style={[styles.reasonText, { color: semanticColors.textPrimary }]}>
                      {r.label}
                    </Text>
                    <Ionicons
                      name="chevron-forward"
                      size={20}
                      color={light ? brand[400] : semanticColors.textMuted}
                    />
                  </HapticPressable>
                ))}
                <Text
                  style={[
                    styles.emergency,
                    light
                      ? { backgroundColor: voiceShades.leafWash, borderColor: voiceShades.washEdge, color: fp.ink }
                      : { borderColor: semanticColors.border, color: semanticColors.textPrimary },
                  ]}
                  testID={`${testID}-emergency`}
                >
                  {EMERGENCY_LINE}
                </Text>
              </>
            )}
            </ScrollView>
            <HapticPressable
              intent="light"
              onPress={close}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={styles.cancel}
              testID={`${testID}-close`}
            >
              <Text style={[styles.cancelText, { color: light ? fp.forest : semanticColors.accentText }]}>
                Cancel
              </Text>
            </HapticPressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

/** The approved emergency line (COMMUNITY_GUIDELINES, owner-approved 2026-10-01), GOAL B-06a .safety. */
const EMERGENCY_LINE = COMMUNITY_GUIDELINES[COMMUNITY_GUIDELINES.length - 1];

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
  // GOAL .sheet: white, 24 top corners, padding 8 20 0, shadow 0 -4px 12px at 8%.
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: spacing.xl, // clears the home indicator under Cancel
    maxHeight: '90%', // Sol R5-B2: never taller than the screen; the steps scroll inside
    shadowColor: fp.ink,
    shadowOffset: { width: 0, height: -4 },
    shadowRadius: 6,
    shadowOpacity: 0.08,
    elevation: 8,
  },
  // The steps shrink and scroll inside the capped sheet; Cancel stays put below them.
  body: { flexGrow: 0, flexShrink: 1 },
  // GOAL .grab 36 x 5, radius 3, 10 below.
  grab: { width: 36, height: 5, borderRadius: 3, alignSelf: 'center', marginBottom: 10 },
  // GOAL .bquote: the note card above the reasons.
  context: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: brand[500],
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: voiceFaces.semibold, fontSize: 14, fontWeight: '600', color: fp.onDeep },
  contextText: { flex: 1, fontFamily: voiceFaces.regular, fontSize: 14, lineHeight: 18 },
  contextName: { fontFamily: voiceFaces.semibold, fontWeight: '600' },
  // GOAL .shead 600 18/1.3, margin 4 0 6.
  heading: {
    fontFamily: voiceFaces.semibold,
    fontSize: 18,
    lineHeight: 23,
    fontWeight: '600',
    marginTop: 4,
    marginBottom: 6,
  },
  row: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  rowText: {
    fontFamily: voiceFaces.regular,
    fontSize: 16,
  },
  // GOAL .srow: 48 high, 16/1.3, a 1 px line between rows, chevron at the end.
  reason: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 6,
  },
  reasonText: { flex: 1, fontFamily: voiceFaces.regular, fontSize: 16, lineHeight: 21 },
  // GOAL .safety: leaf wash, 1 px edge, 16 corners, 14/1.45.
  emergency: {
    overflow: 'hidden',
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginTop: 10,
    marginBottom: 4,
    fontFamily: voiceFaces.regular,
    fontSize: 14,
    lineHeight: 20,
  },
  // GOAL .btn.t: a centred text button, 600 16, 44 high.
  cancel: { minHeight: 44, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontFamily: voiceFaces.semibold, fontSize: 16, lineHeight: 20, fontWeight: '600' },
  busy: {
    paddingVertical: spacing.xl,
  },
  // The remove question (RB-W2, RB-W3) in the GOAL sheet: .shead, a 16/1.4 line, one GOAL .btn (54 high,
  // 12 corners, 600 16) in the error red, then the sheet's Cancel.
  confirm: { gap: 6, paddingBottom: 4 },
  confirmBody: { fontFamily: voiceFaces.regular, fontSize: 16, lineHeight: 22, marginBottom: 10 },
  removeBtn: {
    minHeight: 54,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: fp.error,
  },
  removeBtnText: { fontFamily: voiceFaces.semibold, fontSize: 16, lineHeight: 20, fontWeight: '600', color: fp.onDeep },
});
