/**
 * SpaceListButton + drawer (C6-M1S; C6CHAT-S-V2 x1): "Open space list" on a
 * space page opens a deep forest drawer with the same tree as Community Home;
 * the open space has a leaf edge. "Jump to a space or person" filters the rows
 * by name on the phone. It slides in 250 ms (decel); with Reduce Motion it
 * fades. A tap on the scrim or the system Back closes it. The open state lives
 * here, so the space page under it never re-renders.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import HapticPressable from '../HapticPressable';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { forestPop as fp, layout, lightTokens, motion, typography } from '../../theme/tokens';
import { Monogram, SpaceTree, useOpenSpaceTarget, useSpaceTree, type SpaceTarget } from './SpaceTree';

/** `color`: the icon's tint (forest on light headers; the space chat's deep header passes onDeep, FX-871). */
export function SpaceListButton({ color = fp.forest }: { color?: string } = {}): React.ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <>
      <HapticPressable
        intent="light"
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Open space list"
        style={s.trigger}
        testID="space-list-open"
      >
        <Ionicons name="menu-outline" size={24} color={color} />
      </HapticPressable>
      {open ? <SpaceDrawer onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function SpaceDrawer({ onClose }: { onClose: () => void }): React.ReactElement {
  const activeId = (useRoute().params as { cohortId?: string } | undefined)?.cohortId;
  const tree = useSpaceTree();
  const openTarget = useOpenSpaceTarget(true);
  const reduce = useReducedMotion();
  const insets = useSafeAreaInsets();
  const width = Math.min(useWindowDimensions().width * 0.86, 360);
  const shown = useRef(new Animated.Value(0)).current;
  const [query, setQuery] = useState('');

  const run = (to: 0 | 1, done?: () => void) =>
    Animated.timing(shown, {
      toValue: to,
      duration: reduce ? 150 : to ? 250 : 200,
      easing: Easing.bezier(...motion.easing.decel),
      useNativeDriver: true,
    }).start(done);
  useEffect(() => run(1), []); // eslint-disable-line react-hooks/exhaustive-deps
  const close = () => run(0, onClose);
  const pick = (t: SpaceTarget) => {
    close();
    openTarget(t);
  };

  const q = query.trim().toLowerCase();
  const sections = q
    ? tree.sections.map((sec) => ({ ...sec, rows: sec.rows.filter((r) => r.label.toLowerCase().includes(q)) })).filter((sec) => sec.rows.length > 0)
    : tree.sections;
  const slide = reduce ? 0 : shown.interpolate({ inputRange: [0, 1], outputRange: [-width, 0] });

  return (
    <Modal transparent visible animationType="none" statusBarTranslucent onRequestClose={close}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: lightTokens.overlay, opacity: shown }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityRole="button" accessibilityLabel="Close" testID="space-list-scrim" />
      </Animated.View>
      <Animated.View
        accessibilityViewIsModal
        onAccessibilityEscape={close}
        style={[s.panel, { width, paddingTop: insets.top + 12, opacity: reduce ? shown : 1, transform: [{ translateX: slide }] }]}
        testID="space-list"
      >
        <View style={s.head}>
          <Monogram name={tree.name} size={40} />
          <Text accessibilityRole="header" numberOfLines={1} style={s.name} maxFontSizeMultiplier={1.3}>{tree.name}</Text>
        </View>
        <View style={s.jump}>
          <Ionicons name="search" size={20} color={fp.onDeepMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Jump to a space or person"
            placeholderTextColor={fp.onDeepMuted}
            accessibilityLabel="Jump to a space or person"
            style={s.input}
            autoCorrect={false}
            returnKeyType="search"
            testID="space-list-jump"
          />
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24 }} keyboardShouldPersistTaps="handled">
          <SpaceTree deep sections={sections} activeId={activeId} onOpen={pick} />
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

const s = StyleSheet.create({
  trigger: { width: layout.touchMin, height: layout.touchMin, alignItems: 'center', justifyContent: 'center' },
  panel: { position: 'absolute', top: 0, bottom: 0, left: 0, backgroundColor: fp.deep },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, marginBottom: 16 },
  name: { ...typography.h2, color: fp.onDeep, flex: 1 },
  jump: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, marginHorizontal: 16, marginBottom: 8, paddingHorizontal: 14, borderRadius: 12, backgroundColor: fp.forest },
  input: { ...typography.body, flex: 1, color: fp.onDeep, paddingVertical: 10 },
});
