/**
 * Screen: the one page wrapper for client screens (DS-PRIMITIVES-133, B13,
 * B28, B39). Insets come from react-native-safe-area-context (Android
 * edge-to-edge included) plus breathing room under the status bar; the
 * footer is pinned above the gesture bar and rises with the keyboard.
 */
import React, { useContext } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type RefreshControlProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/ThemeProvider';
import { layout } from '../../theme/tokens';

export type ScreenEdge = 'top' | 'bottom';

const NO_INSETS = { top: 0, bottom: 0, left: 0, right: 0 };

/** Insets without requiring a provider (tests and previews render without one). */
export function useScreenInsets() {
  return useContext(SafeAreaInsetsContext) ?? NO_INSETS;
}

/** Bottom padding for a pinned footer: never flush with a device edge. */
export function footerBottomPadding(insetBottom: number): number {
  return Math.max(insetBottom, layout.footerBottomMin) + layout.footerBottomGap;
}

export interface ScreenProps {
  children?: React.ReactNode;
  /** Which device insets this screen owns. Tab roots: ['top']. Under a stack header: ['bottom'] or []. */
  edges?: readonly ScreenEdge[];
  scroll?: boolean; // default true; false renders a fixed column
  header?: React.ReactNode; // above the scroll area (ScreenTopBar)
  footer?: React.ReactNode; // pinned: one PrimaryButton and at most one TextLink
  keyboardAware?: boolean; // footer rises with the keyboard (default true)
  centerContent?: boolean; // vertically centred content (prototype 00, 03)
  refreshControl?: React.ReactElement<RefreshControlProps>;
  contentStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Screen({
  children,
  edges = ['top', 'bottom'],
  scroll = true,
  header,
  footer,
  keyboardAware = true,
  centerContent = false,
  refreshControl,
  contentStyle,
  style,
  testID,
}: ScreenProps): React.ReactElement {
  const { semanticColors: sc } = useTheme();
  const insets = useScreenInsets();
  const top = edges.includes('top') ? insets.top + layout.statusBarGap : 0;
  const ownsBottom = edges.includes('bottom');
  // Without a footer the content itself clears the gesture bar.
  const contentBottom = !footer && ownsBottom ? footerBottomPadding(insets.bottom) : layout.gutter;

  const content = [styles.content, centerContent && styles.centered, { paddingBottom: contentBottom }, contentStyle];

  const body = scroll ? (
    <ScrollView
      testID={testID ? `${testID}-scroll` : undefined}
      style={styles.fill}
      contentContainerStyle={content}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      showsVerticalScrollIndicator={false}
      refreshControl={refreshControl}
    >
      {children}
    </ScrollView>
  ) : (
    <View testID={testID ? `${testID}-scroll` : undefined} style={[styles.fill, content]}>
      {children}
    </View>
  );

  const footerBottom = ownsBottom ? footerBottomPadding(insets.bottom) : layout.gutter;
  const footerView = footer ? (
    <View testID={testID ? `${testID}-footer` : undefined} style={[styles.footer, { paddingBottom: footerBottom }]}>
      {footer}
    </View>
  ) : null;

  const inner = (<>{header}{body}{footerView}</>);

  return (
    <View
      testID={testID}
      style={[
        styles.root,
        { backgroundColor: sc.bgPrimary, paddingTop: top, paddingLeft: insets.left, paddingRight: insets.right },
        style,
      ]}
    >
      {keyboardAware && footer ? (
        <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          {inner}
        </KeyboardAvoidingView>
      ) : (
        inner
      )}
    </View>
  );
}

export interface ScreenTopBarProps {
  onBack?: () => void;
  backLabel?: string;
  /** Right-hand slot, e.g. <TextLink label="Finish later" size="small" />. */
  trailing?: React.ReactNode;
  testID?: string;
}

/** Back chevron (44 pt) and an optional trailing text action, on the page gutter. */
export function ScreenTopBar({ onBack, backLabel = 'Back', trailing, testID }: ScreenTopBarProps): React.ReactElement {
  const { semanticColors: sc } = useTheme();
  return (
    <View style={styles.topBar} testID={testID}>
      {onBack ? (
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel={backLabel}
          hitSlop={8}
          testID={testID ? `${testID}-back` : undefined}
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}
        >
          <Ionicons name="chevron-back" size={22} color={sc.textPrimary} />
        </Pressable>
      ) : (
        <View style={styles.back} />
      )}
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  fill: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: layout.gutter },
  centered: { justifyContent: 'center' },
  footer: {
    paddingHorizontal: layout.gutter,
    paddingTop: layout.footerTopGap,
    gap: layout.footerItemGap,
  },
  topBar: {
    minHeight: layout.touchMin,
    paddingHorizontal: layout.gutter - 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  // The chevron glyph sits about 2 pt inside its box, so 16 + 6 + 2 lands on the 24 pt gutter.
  back: { width: layout.touchMin, height: layout.touchMin, justifyContent: 'center', paddingLeft: 6 },
  trailing: { flexShrink: 1, alignItems: 'flex-end', paddingRight: 8 },
  pressed: { opacity: 0.6 },
});
