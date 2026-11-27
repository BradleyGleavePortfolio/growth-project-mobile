/**
 * SC-M4 (agent 203): the "+" in the space chat box's left slot and the sheet it opens. The "+" is GOAL VOICE-B 05b's
 * (.cbtn: 44 x 44, a 24 pt forest plus drawn as two strokes, no disc), built as the mic beside it is (SpaceChatMic:
 * the keyboard goes first, LO-944R2 B1; the sheet mounts on the first tap). The sheet is GOAL C6CHAT-S-V2 c05 "Add to
 * your message" cut to its one photo row by the owner's 10-23 words ("photos only for v1"; c05's camera, workout, meal
 * and win rows are not built), in the build of its sibling SpaceMessageSheet (copied, never imported): the scrim's
 * "Close", a white sheet with 24 pt top corners and the grab, the title (a header, which takes the screen reader's
 * focus as it opens, c05 notes), 48 pt icon rows and the centred Cancel. Only the bottom inset is read. As in that
 * sheet, on iOS the row's step runs once the sheet has gone (the Modal's onDismiss): the photo grid never comes up over
 * a closing sheet. Close, Cancel, the scrim, the escape gesture and Android back start nothing.
 */
import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, findNodeHandle, Keyboard, Modal, Platform, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HapticService } from '../../../ui/haptics/haptics.service';
import { colors, forestPop as fp, neutral, radius, spacing, withAlpha } from '../../../theme/tokens';
import { spacePhotoBusy } from './spaceChatPhotos';

export interface SpaceChatPlusProps {
  /** Photo library: the pick (spaceChatPhotos), started once the sheet has gone. */
  onPick: () => void;
}

/** The sheet's rows: a second one is one more line (R2: v1 has the photo library only). */
const ROWS = [{ id: 'library', icon: 'image-outline', label: 'Photo library' }] as const;

export default function SpaceChatPlus({ onPick }: SpaceChatPlusProps): React.ReactElement {
  const [used, setUsed] = useState(false);
  const [open, setOpen] = useState(false);
  const openSheet = () => {
    if (open || spacePhotoBusy()) return;
    Keyboard.dismiss();
    setUsed(true);
    setOpen(true);
  };
  return (
    <>
      <TouchableOpacity style={s.plus} onPress={openSheet} accessibilityRole="button" accessibilityLabel="Add a photo" testID="space-chat-plus">
        <View style={s.glyph} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <View style={[s.stroke, s.across]} />
          <View style={[s.stroke, s.down]} />
        </View>
      </TouchableOpacity>
      {used ? <AddSheet open={open} onClose={() => setOpen(false)} onPick={onPick} /> : null}
    </>
  );
}

function AddSheet({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: () => void }): React.ReactElement {
  const insets = useSafeAreaInsets();
  const title = useRef<Text>(null);
  const after = useRef<(() => void) | null>(null);
  // Once a way out is taken, a second one (a tap on the scrim as the sheet slides away) changes nothing.
  const closing = useRef(false);
  useEffect(() => { if (open) closing.current = false; }, [open]);
  const gone = () => {
    const next = after.current;
    after.current = null;
    next?.();
  };
  // Unmounted mid-close (the page left): the grid does not come up over another page.
  useEffect(() => () => { after.current = null; }, []);
  const close = (next?: () => void) => {
    if (closing.current) return;
    closing.current = true;
    after.current = next ?? null;
    onClose();
    if (Platform.OS !== 'ios') gone();
  };
  const focusTitle = () => {
    const tag = title.current && findNodeHandle(title.current);
    if (tag) AccessibilityInfo.setAccessibilityFocus(tag);
  };
  return (
    <Modal transparent visible={open} animationType="slide" statusBarTranslucent onRequestClose={() => close()} onDismiss={gone} onShow={focusTitle}>
      <View style={s.scrim}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => close()} accessibilityRole="button" accessibilityLabel="Close" testID="space-chat-add-scrim" />
        <View style={[s.sheet, { paddingBottom: insets.bottom + spacing.sm }]} accessibilityViewIsModal onAccessibilityEscape={() => close()} testID="space-chat-add-sheet">
          <View style={s.grab} />
          <Text ref={title} style={s.title} accessibilityRole="header" testID="space-chat-add-title">Add to your message</Text>
          {ROWS.map((r) => (
            <TouchableOpacity
              key={r.id}
              onPress={() => { void HapticService.selection(); close(onPick); }}
              accessibilityRole="button" accessibilityLabel={r.label} style={s.row} testID={`space-chat-add-${r.id}`}
            >
              <Ionicons name={r.icon} size={22} color={fp.forest} />
              <Text style={s.rowText}>{r.label}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity onPress={() => close()} accessibilityRole="button" accessibilityLabel="Cancel" style={s.cancel} testID="space-chat-add-cancel">
            <Text style={s.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  // 05b .cbtn: a 44 pt target; its 24 pt plus is two 2 pt strokes, 14 long with round caps (path M12 5v14M5 12h14).
  plus: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  glyph: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  stroke: { position: 'absolute', borderRadius: 1, backgroundColor: fp.forest },
  across: { width: 16, height: 2 },
  down: { width: 2, height: 16 },
  // SpaceMessageSheet's build: the scrim, the white sheet, its 24 pt corners and the grab.
  scrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: withAlpha(colors.ink, 0.4) },
  sheet: { backgroundColor: neutral[0], borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, paddingHorizontal: 20, paddingTop: 8 },
  grab: { width: 36, height: 5, borderRadius: 3, alignSelf: 'center', marginBottom: 10, backgroundColor: fp.sageLine },
  // c05 .stitle: 18 pt, padding 4 20 2 (20 is the sheet's own); the app's heaviest loaded face is 600 (no 700 is loaded).
  title: { fontFamily: 'Inter_600SemiBold', fontWeight: '600', fontSize: 18, lineHeight: 24, color: fp.ink, paddingTop: 4, paddingBottom: 2 },
  // c05's sheetrow: a 22 pt forest icon and 16 pt words, at the sibling's 48 pt row; then its centred Cancel.
  row: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  rowText: { fontFamily: 'Inter_400Regular', fontSize: 16, lineHeight: 21, color: fp.ink, flexShrink: 1 },
  cancel: { minHeight: 44, marginTop: spacing.xs, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontFamily: 'Inter_600SemiBold', fontWeight: '600', fontSize: 16, lineHeight: 20, color: fp.forest },
});
