/**
 * CrossPillarMessagesScreen — combined inbox across both pillars.
 *
 * Stage-3 design choice: this screen does NOT fan out to a finance
 * messaging endpoint. Both products keep their own message stores
 * (the finance backend has its own coach-messaging surface added in
 * Stage 2 of the finance side; the fitness backend has the existing
 * `/coach/messages/unread-count`). The cross-pillar federation handshake
 * does not yet expose a unified message wire format — that is Stage 4
 * work documented as Deferred in `STAGE-3-COMPLETE.md`.
 *
 * Until the unified message wire lands, this screen renders:
 *   - The existing fitness inbox unread totals.
 *   - A clearly labeled section that links the coach to the Wealth
 *     coach app for finance threads.
 *
 * Honest UX, not a fake combined feed. Once the wire spec lands, the
 * Wealth section turns into a live thread list without changing this
 * file's outer scaffolding.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { coachApi } from '../../../services/api';
import { useTheme, ThemeColors } from '../../../theme/ThemeProvider';
import { Typography } from '../../../theme';

interface UnreadShape {
  total?: number;
}

export default function CrossPillarMessagesScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation();

  const [bodyUnread, setBodyUnread] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (mode: 'initial' | 'refresh') => {
    if (mode === 'initial') setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const { data } = await coachApi.getUnreadCounts();
      const total =
        typeof (data as UnreadShape)?.total === 'number'
          ? (data as UnreadShape).total!
          : 0;
      setBodyUnread(total);
    } catch (err: unknown) {
      setError(toMessage(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load('initial');
  }, [load]);

  return (
    <ScrollView
      style={styles.safe}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => load('refresh')}
          tintColor={colors.textSecondary}
        />
      }
    >
      <View style={styles.headerBar}>
        <Pressable
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>COMBINED INBOX</Text>
        <View style={{ width: 32 }} />
      </View>

      <Text style={styles.eyebrow}>MESSAGES</Text>
      <Text style={styles.headline}>One feed. Both pillars.</Text>
      <Text style={styles.lede}>
        Body threads live here. Wealth threads will land here when the unified
        message wire ships — until then, jump into the Wealth coach app for
        those conversations.
      </Text>

      {loading ? (
        <View style={styles.loadingBlock}>
          <ActivityIndicator color={colors.textSecondary} />
        </View>
      ) : error ? (
        <View style={styles.errorBlock}>
          <Text style={styles.errorTitle}>Couldn't load Body inbox</Text>
          <Text style={styles.errorBody}>{error}</Text>
          <Pressable onPress={() => load('initial')} accessibilityRole="button">
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <Text style={styles.sectionLabel}>BODY</Text>
          <Pressable
            style={styles.actionRow}
            onPress={() =>
              (navigation as { navigate?: (n: string) => void }).navigate?.('Messages')
            }
            accessibilityRole="button"
            accessibilityLabel="Open Body messages"
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.actionTitle}>
                {bodyUnread === null
                  ? 'Body inbox'
                  : bodyUnread === 0
                    ? 'No unread Body messages'
                    : `${bodyUnread} unread Body message${bodyUnread === 1 ? '' : 's'}`}
              </Text>
              <Text style={styles.actionSubtitle}>Tap to open the Body inbox</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
          </Pressable>

          <Text style={styles.sectionLabel}>WEALTH</Text>
          <Pressable
            style={styles.actionRow}
            onPress={() =>
              Linking.openURL('tgp-finance://coach/messages').catch(() => {})
            }
            accessibilityRole="button"
            accessibilityLabel="Open Wealth coach app messages"
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.actionTitle}>Open in Wealth coach app</Text>
              <Text style={styles.actionSubtitle}>
                Unified thread feed lands when the cross-pillar message wire
                ships (see Stage 3.5).
              </Text>
            </View>
            <Ionicons name="open-outline" size={18} color={colors.textMuted} />
          </Pressable>

          <Text style={styles.footnote}>
            Identity join key: email. The Wealth thread for the same client
            uses the same email, so cross-pillar context is consistent even
            while the inbox lives in two places.
          </Text>
        </>
      )}
    </ScrollView>
  );
}

function toMessage(err: unknown): string {
  if (!err) return 'Something went wrong.';
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message?: unknown }).message ?? 'Something went wrong.');
  }
  return 'Something went wrong.';
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.background },
    content: { padding: 24, paddingBottom: 80 },
    headerBar: { flexDirection: 'row', alignItems: 'center', paddingBottom: 16 },
    backBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
    headerTitle: { flex: 1, textAlign: 'center', ...Typography.label, color: colors.textSecondary },
    eyebrow: { ...Typography.label, color: colors.textSecondary },
    headline: {
      fontFamily: 'CormorantGaramond_400Regular',
      fontSize: 28,
      color: colors.textPrimary,
      marginTop: 4,
    },
    lede: {
      fontFamily: 'Inter_400Regular',
      fontSize: 15,
      lineHeight: 22,
      color: colors.textSecondary,
      marginTop: 8,
      marginBottom: 24,
    },
    sectionLabel: {
      ...Typography.label,
      color: colors.textMuted,
      letterSpacing: 1.5,
      marginTop: 8,
      marginBottom: 8,
    },
    actionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderWidth: 0.5,
      borderColor: colors.border,
      paddingHorizontal: 16,
      paddingVertical: 14,
      marginBottom: 12,
    },
    actionTitle: { fontFamily: 'Inter_500Medium', fontSize: 15, color: colors.textPrimary },
    actionSubtitle: { ...Typography.caption, color: colors.textMuted, marginTop: 2 },
    footnote: {
      ...Typography.caption,
      color: colors.textMuted,
      fontStyle: 'italic',
      marginTop: 24,
    },
    loadingBlock: { paddingVertical: 48, alignItems: 'center' },
    errorBlock: {
      backgroundColor: colors.surface,
      borderWidth: 0.5,
      borderColor: colors.border,
      padding: 16,
      gap: 8,
    },
    errorTitle: { fontFamily: 'Inter_500Medium', fontSize: 16, color: colors.textPrimary },
    errorBody: { ...Typography.caption, color: colors.textMuted },
    retryText: { fontFamily: 'Inter_500Medium', fontSize: 14, color: colors.primary },
  });
