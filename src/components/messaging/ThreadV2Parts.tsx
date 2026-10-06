/**
 * ThreadV2Parts — the messaging v2 thread UI shared by the client and coach
 * thread screens: message and mute menus, edit sheet, pinned bar, mute bell.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import ActionMenu, { type ActionMenuOption } from './ActionMenu';
import { messageActionOptions, type ThreadV2Fields } from './threadV2';
import type { useThreadV2 } from '../../hooks/useThreadV2';
import { MESSAGE_BODY_MAX, MUTE_LABELS, type MuteDuration, type ThreadMessage } from '../../api/messagingV2Api';

export interface ThreadV2Target {
  id: string;
  body: string;
  created_at: string;
  pending?: boolean;
  v2?: ThreadV2Fields;
}

export interface ThreadV2MenusProps {
  thread: ReturnType<typeof useThreadV2>;
  target: ThreadV2Target | null;
  isMine: boolean;
  onClose: () => void;
  onReply: () => void;
  onCopy: () => void;
  onReport: () => void;
  onRetry?: (target: ThreadV2Target) => void;
  muteOpen: boolean;
  onMuteClose: () => void;
}

/** Long-press menu (rules in messageActionOptions), thread mute menu, edit sheet. */
export function ThreadV2Menus(p: ThreadV2MenusProps): React.ReactElement {
  const t = p.target;
  const { thread } = p;
  const options = t
    ? messageActionOptions({
        isMine: p.isMine,
        pending: !!t.pending,
        deleted: !!t.v2?.deleted,
        hasText: !!t.body,
        pinned: !!t.v2?.pinned_at,
        createdAt: t.created_at,
      })
    : [];
  const onSelect = (key: string) => {
    if (!t) return;
    if (key === 'reply') p.onReply();
    else if (key === 'copy') p.onCopy();
    else if (key === 'report') p.onReport();
    else if (key === 'edit') thread.startEdit({ id: t.id, body: t.body });
    else if (key === 'pin' || key === 'unpin') void thread.pin(t.id, key === 'pin');
    else if (key === 'delete') thread.confirmDelete(t.id);
    else if (key === 'retry') p.onRetry?.(t);
  };
  return (
    <>
      <ActionMenu visible={!!t} title={t && !t.v2?.deleted ? t.body : undefined} options={options} onSelect={onSelect} onClose={p.onClose} />
      <ActionMenu
        visible={p.muteOpen}
        title="Notifications for this conversation"
        options={muteOptions(thread.muted)}
        onSelect={(key) => void thread.setMute(key as MuteDuration)}
        onClose={p.onMuteClose}
      />
      <EditMessageSheet draft={thread.editing} busy={thread.busy} onSave={(b) => void thread.saveEdit(b)} onCancel={thread.cancelEdit} />
    </>
  );
}

export function MuteBell({ muted, onPress }: { muted: boolean | null; onPress: () => void }): React.ReactElement {
  const { colors } = useTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      accessibilityRole="button"
      accessibilityLabel={muted ? 'Conversation muted. Change notifications' : 'Mute or unmute this conversation'}
      testID="thread-mute-button"
    >
      <Ionicons name={muted ? 'notifications-off-outline' : 'notifications-outline'} size={22} color={colors.textPrimary} />
    </TouchableOpacity>
  );
}

type IndexScroller = { scrollToIndex: (p: { index: number; animated?: boolean; viewPosition?: number }) => void };

/** Pinned-bar tap: scroll to the message if loaded, else say how to reach it. */
export function jumpToMessage(list: IndexScroller | null, items: Array<{ id: string }>, id: string): void {
  const index = items.findIndex((m) => m.id === id);
  if (index >= 0) list?.scrollToIndex({ index, animated: true, viewPosition: 0.3 });
  else Alert.alert('Pinned message', 'That pinned message is older than the messages loaded here. Tap Load older to reach it.');
}

export function muteOptions(muted: boolean | null): ActionMenuOption[] {
  const out: ActionMenuOption[] = [];
  if (muted !== false) out.push({ key: 'off', label: MUTE_LABELS.off, icon: 'notifications-outline' });
  (['1h', '8h', '1d', '7d', 'forever'] as const).forEach((d) =>
    out.push({ key: d, label: MUTE_LABELS[d], icon: 'notifications-off-outline' }),
  );
  return out;
}

export function pinPreview(m: ThreadMessage): string {
  const text = (m.body ?? '').replace(/\s+/g, ' ').trim();
  if (text) return text;
  return m.voice_url ? 'Voice note' : 'Message';
}

/** The thread's pins (newest first); each tap jumps to the next one in turn. */
export function PinnedBar({ pins, onOpen }: { pins: ThreadMessage[]; onOpen: (id: string) => void }): React.ReactElement | null {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (index >= pins.length) setIndex(0);
  }, [pins.length, index]);
  if (pins.length === 0) return null;
  const current = pins[Math.min(index, pins.length - 1)];
  const label = pins.length > 1 ? `Pinned ${Math.min(index, pins.length - 1) + 1} of ${pins.length}` : 'Pinned';
  return (
    <Pressable
      style={styles.bar}
      onPress={() => {
        onOpen(current.id);
        setIndex((i) => (i + 1) % pins.length);
      }}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${pinPreview(current)}. Tap to show it in the conversation.`}
      testID="thread-pinned-bar"
    >
      <Ionicons name="pin" size={14} color={colors.primary} />
      <View style={styles.barText}>
        <Text style={styles.barLabel}>{label}</Text>
        <Text style={styles.barPreview} numberOfLines={1}>
          {pinPreview(current)}
        </Text>
      </View>
    </Pressable>
  );
}

type EditSheetProps = { draft: { id: string; body: string } | null; busy: boolean; onSave: (b: string) => void; onCancel: () => void };

/** Edit a sent message (author, 48 hours, text only). */
function EditMessageSheet({ draft, busy, onSave, onCancel }: EditSheetProps): React.ReactElement | null {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [text, setText] = useState(draft?.body ?? '');
  useEffect(() => setText(draft?.body ?? ''), [draft?.id, draft?.body]);
  if (!draft) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel} accessibilityRole="button" accessibilityLabel="Cancel editing">
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <Text style={styles.sheetTitle}>Edit message</Text>
          <Text style={styles.sheetHint}>Both people see that the message was edited.</Text>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            multiline
            autoFocus
            maxLength={MESSAGE_BODY_MAX}
            accessibilityLabel="Edited message text"
          />
          <View style={styles.actions}>
            <Pressable onPress={onCancel} style={styles.cancel} accessibilityRole="button" accessibilityLabel="Cancel">
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={() => onSave(text)}
              disabled={busy || !text.trim()}
              style={[styles.save, (busy || !text.trim()) && styles.saveOff]}
              accessibilityRole="button"
              accessibilityLabel="Save edit"
              accessibilityState={{ disabled: busy || !text.trim() }}
            >
              {busy ? <ActivityIndicator size="small" color={colors.textOnPrimary} /> : <Text style={styles.saveText}>Save</Text>}
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    bar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
    barText: { flex: 1 },
    barLabel: { fontSize: 11, fontWeight: '600', color: colors.primary },
    barPreview: { fontSize: 13, color: colors.textPrimary },
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
    sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, paddingBottom: 36, gap: 10 },
    sheetTitle: { fontSize: 16, fontWeight: '600', color: colors.textPrimary },
    sheetHint: { fontSize: 12, color: colors.textMuted },
    input: { minHeight: 80, maxHeight: 200, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, fontSize: 15, color: colors.textPrimary, textAlignVertical: 'top' },
    actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12 },
    cancel: { paddingHorizontal: 16, paddingVertical: 10 },
    cancelText: { fontSize: 15, color: colors.textPrimary },
    save: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 4, backgroundColor: colors.primary, minWidth: 72, alignItems: 'center' },
    saveOff: { opacity: 0.5 },
    saveText: { fontSize: 15, fontWeight: '600', color: colors.textOnPrimary },
  });
