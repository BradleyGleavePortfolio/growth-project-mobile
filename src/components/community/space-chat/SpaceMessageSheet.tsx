/**
 * SC-M3 (agent 184): the sheet a press and hold on a space chat row opens (GOAL C6CHAT-S-V2 c04, without its reactions:
 * one white sheet, 24 top corners, a grab, icon rows). Reply and Copy carry MessageActionSheet's labels and icons; Copy is
 * on text rows only. The sheet's Cancel and its scrim's "Close" are the space info sheet's and SafetyMenu's.
 * Delete and the coach's Remove stay on the row's own ••• (SafetyMenu); Report and Block {name} are below (REPORT-ANY-M),
 * each run by the row's own SafetyMenu flow through its way in once this sheet has gone, so this sheet runs no flow.
 * As in SafetyMenu, on iOS what a row does runs once the sheet has gone (the Modal's onDismiss), so the keyboard Reply
 * brings up never meets a closing sheet.
 * REPORT-ANY-M (#200-S4, c04): Report and Block {name} after Copy, in c04's order. Each runs the row's own SafetyMenu
 * flow (the screen opens it through SafetyMenu's way in once this sheet has gone), so nothing here reports or blocks.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, forestPop as fp, neutral, radius, semantic, spacing, withAlpha } from '../../../theme/tokens';

export interface SpaceMessageSheetProps {
  onReply?: () => void;
  onCopy?: () => void;
  /** REPORT-ANY-M: SafetyMenu's Report (its words, icon and spoken label), for another person's message. */
  onReport?: () => void;
  /** REPORT-ANY-M: SafetyMenu's Block {name}, where the row's ••• offers Block. */
  onBlock?: () => void;
  blockName?: string;
  onClose: () => void;
}

export default function SpaceMessageSheet({ onReply, onCopy, onReport, onBlock, blockName, onClose }: SpaceMessageSheetProps): React.ReactElement {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(true);
  const after = useRef<(() => void) | null>(null);
  const gone = () => {
    const next = after.current;
    after.current = null;
    onClose();
    next?.();
  };
  // Unmounted mid-close (the page left): still do what was asked.
  useEffect(() => () => { after.current?.(); }, []);
  const close = (next?: () => void) => {
    after.current = next ?? null;
    if (Platform.OS === 'ios') setOpen(false);
    else gone();
  };
  const row = (icon: keyof typeof Ionicons.glyphMap, label: string, run: () => void, id: string, spoken = label, tint?: string) => (
    <TouchableOpacity onPress={() => close(run)} accessibilityRole="button" accessibilityLabel={spoken} style={s.row} testID={`space-chat-sheet-${id}`}>
      <Ionicons name={icon} size={22} color={tint ?? fp.forest} />
      <Text style={[s.rowText, tint ? { color: tint } : null]}>{label}</Text>
    </TouchableOpacity>
  );
  return (
    <Modal transparent visible={open} animationType="slide" statusBarTranslucent onRequestClose={() => close()} onDismiss={gone}>
      <View style={s.scrim}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => close()} accessibilityRole="button" accessibilityLabel="Close" testID="space-chat-sheet-scrim" />
        <View style={[s.sheet, { paddingBottom: insets.bottom + spacing.sm }]} accessibilityViewIsModal onAccessibilityEscape={() => close()} testID="space-chat-sheet">
          <View style={s.grab} />
          {onReply ? row('return-up-back-outline', 'Reply', onReply, 'reply') : null}
          {onCopy ? row('copy-outline', 'Copy', onCopy, 'copy') : null}
          {onReport ? row('flag-outline', 'Report', onReport, 'report', 'Report this content') : null}
          {onBlock && blockName ? row('remove-circle-outline', `Block ${blockName}`, onBlock, 'block', undefined, semantic.danger.fg) : null}
          <TouchableOpacity onPress={() => close()} accessibilityRole="button" accessibilityLabel="Cancel" style={s.cancel} testID="space-chat-sheet-cancel">
            <Text style={s.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  scrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: withAlpha(colors.ink, 0.4) },
  sheet: { backgroundColor: neutral[0], borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, paddingHorizontal: 20, paddingTop: 8 },
  grab: { width: 36, height: 5, borderRadius: 3, alignSelf: 'center', marginBottom: 10, backgroundColor: fp.sageLine },
  // c04's rows: a 22 pt forest icon, 16 pt words, 48 pt tall (c04 draws 41; 44 is the floor); SafetyMenu's centred Cancel
  // (600 16, 44 tall) under them.
  row: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  rowText: { fontFamily: 'Inter_400Regular', fontSize: 16, lineHeight: 21, color: fp.ink, flexShrink: 1 },
  cancel: { minHeight: 44, marginTop: spacing.xs, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontFamily: 'Inter_600SemiBold', fontWeight: '600', fontSize: 16, lineHeight: 20, color: fp.forest },
});
