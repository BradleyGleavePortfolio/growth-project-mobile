/**
 * LEAVE-MUTE-M (agent 203; owner D2e; LEAVE-MUTE-MOCK Style 1, frames s1_L5 and s1_L5d): a row of "Spaces you left" in
 * the tree, on Home and in the drawer. The space's name in the quiet n700 (onDeepMuted in the drawer) opens the left
 * space, readable with Join again; Join (outline pill, .join) joins it again: one call at a time, the row moves under
 * Spaces only once the server answers, and a failure says so under the row. No count: a left space adds none.
 */
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import HapticPressable from '../HapticPressable';
import { useJoinSpace } from './space-chat/useSpaceLeaveMute';
import { colors, forestPop as fp, layout, neutral, typography } from '../../theme/tokens';

export const joinLabel = (space: string) => `Join ${space}`;

export function LeftSpaceRow({ id, label, deep, onOpen }: { id: string; label: string; deep: boolean; onOpen: () => void }): React.ReactElement {
  const { join, busy, failed } = useJoinSpace();
  const working = busy.has(id);
  const failure = failed[id];
  const tone = deep ? fp.onDeepMuted : fp.n700;
  return (
    <View>
      <View style={s.row}>
        <HapticPressable intent="light" onPress={onOpen} accessibilityRole="button" accessibilityLabel={label} style={s.open} containerStyle={s.openBox} testID={`space-row-${id}`}>
          <View style={s.icon} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Text style={[s.hash, { color: tone }]}>#</Text>
          </View>
          <Text style={[s.label, { color: tone }]}>{label}</Text>
        </HapticPressable>
        <TouchableOpacity
          onPress={working ? undefined : () => join(id)} disabled={working} accessibilityRole="button" accessibilityLabel={joinLabel(label)}
          accessibilityState={{ busy: working, disabled: working }} style={[s.join, deep && s.joinDeep]} testID={`space-row-${id}-join`}
        >
          {working ? <ActivityIndicator color={deep ? fp.onDeep : fp.forest} /> : <Text style={[s.joinText, deep && s.joinTextDeep]}>Join</Text>}
        </TouchableOpacity>
      </View>
      {failure ? (
        <View style={s.failed} testID={`space-row-${id}-failed`} accessibilityLiveRegion="polite">
          <Text style={[s.failedText, { color: deep ? fp.onDeep : colors.graphite }]}>{failure}</Text>
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  // SpaceTree's row (minHeight 48, 16 pt sides, a 4 pt clear edge), with Join at the end.
  row: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, paddingRight: 16, borderLeftWidth: 4, borderLeftColor: 'transparent' },
  // HapticPressable draws `style` inside its own container: the container takes the free width, so Join sits at the
  // row's end and a long name wraps before it (s1_L5, s1_L5d).
  openBox: { flex: 1, minWidth: 0 },
  open: { flex: 1, minHeight: layout.touchMin, flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 16, paddingVertical: 8 },
  icon: { width: 24, alignItems: 'center' },
  hash: { fontFamily: 'Inter_400Regular', fontSize: 22, lineHeight: 26 },
  label: { ...typography.h4, fontFamily: 'Inter_400Regular', flex: 1 },
  join: { minHeight: 44, minWidth: 64, paddingHorizontal: 16, borderRadius: 999, borderWidth: 1.5, borderColor: fp.forest, backgroundColor: neutral[0], alignItems: 'center', justifyContent: 'center' },
  joinDeep: { backgroundColor: 'transparent', borderColor: fp.onDeepMuted },
  joinText: { fontFamily: 'Inter_600SemiBold', fontWeight: '600', fontSize: 14, lineHeight: 18, color: fp.forest },
  joinTextDeep: { color: fp.onDeep },
  failed: { paddingLeft: 56, paddingRight: 16, paddingBottom: 8 },
  failedText: { ...typography.bodySmall },
});
