/**
 * CrossPillarAssignmentsScreen — combined assignments view.
 *
 * The fitness backend's coach surface does not expose a generic
 * "all assignments across roster" query (assignments are scoped to
 * individual clients). The finance backend ships a coach-OS
 * `/api/coach/clients/:id/assignments` endpoint added in Stage 2 of
 * the finance side, but again it's per-client.
 *
 * Stage 3 surface here: render the cross-pillar roster and let the
 * coach drill into per-client assignments on either side. A truly
 * combined feed (sortable, filterable across BOTH backends) requires
 * an aggregate endpoint on each side; that work lands in Stage 3.5
 * (documented in `STAGE-3-COMPLETE.md`).
 *
 * This screen is intentionally honest about what's federated and what
 * isn't, in line with the same doctrine that drives the Messages
 * screen — no fake combined feeds.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { crossPillarApi } from '../../../services/api';
import { useTheme, ThemeColors } from '../../../theme/ThemeProvider';
import { Typography } from '../../../theme';
import type { CrossPillarRosterRow } from '../../../types/crossPillar';
import type { CrossPillarStackParamList } from './CrossPillarNavigator';

type Nav = NativeStackNavigationProp<CrossPillarStackParamList, 'CrossPillarAssignments'>;

export default function CrossPillarAssignmentsScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation<Nav>();

  const [rows, setRows] = useState<CrossPillarRosterRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (mode: 'initial' | 'refresh') => {
    if (mode === 'initial') setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const { data } = await crossPillarApi.getClients();
      setRows(data.results);
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
    <View style={styles.safe}>
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
        <Text style={styles.headerTitle}>ASSIGNMENTS</Text>
        <View style={{ width: 32 }} />
      </View>

      <View style={styles.heroBlock}>
        <Text style={styles.eyebrow}>ASSIGNMENTS</Text>
        <Text style={styles.headline}>Pick a client to view both pillars.</Text>
        <Text style={styles.lede}>
          Tap any roster row to drill into their unified profile. Per-pillar
          assignment lists live on each backend; a sortable cross-pillar feed
          ships in Stage 3.5.
        </Text>
      </View>

      {loading ? (
        <View style={styles.loadingBlock}>
          <ActivityIndicator color={colors.textSecondary} />
        </View>
      ) : error ? (
        <View style={styles.errorBlock}>
          <Text style={styles.errorTitle}>Couldn't load roster</Text>
          <Text style={styles.errorBody}>{error}</Text>
          <Pressable onPress={() => load('initial')} accessibilityRole="button">
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : !rows || rows.length === 0 ? (
        <View style={styles.emptyBlock}>
          <Text style={styles.emptyTitle}>No clients yet</Text>
          <Text style={styles.emptyBody}>
            Once clients sign up under your invite codes, you'll see them here.
          </Text>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => `assign-${r.email}`}
          renderItem={({ item }) => (
            <Pressable
              onPress={() =>
                navigation.navigate('CrossPillarClientDetail', {
                  email: item.email,
                  name: item.name ?? item.email,
                })
              }
              style={({ pressed }) => [
                styles.row,
                pressed && { backgroundColor: colors.surfaceElevated },
              ]}
              accessibilityRole="button"
              accessibilityLabel={`Open ${item.name ?? item.email}`}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{item.name ?? item.email}</Text>
                <Text style={styles.rowSubtitle}>
                  {item.pillars.includes('finance') ? 'Body + Wealth' : 'Body only'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </Pressable>
          )}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load('refresh')}
              tintColor={colors.textSecondary}
            />
          }
          contentContainerStyle={{ paddingBottom: 32 }}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
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
    headerBar: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingTop: 8,
      paddingBottom: 8,
    },
    backBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
    headerTitle: { flex: 1, textAlign: 'center', ...Typography.label, color: colors.textSecondary },
    heroBlock: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 16 },
    eyebrow: { ...Typography.label, color: colors.textSecondary },
    headline: {
      fontFamily: 'CormorantGaramond_400Regular',
      fontSize: 24,
      color: colors.textPrimary,
      marginTop: 4,
    },
    lede: { ...Typography.caption, color: colors.textMuted, marginTop: 8, lineHeight: 18 },
    loadingBlock: { paddingVertical: 48, alignItems: 'center' },
    errorBlock: {
      margin: 16,
      backgroundColor: colors.surface,
      borderWidth: 0.5,
      borderColor: colors.border,
      padding: 16,
      gap: 8,
    },
    errorTitle: { fontFamily: 'Inter_500Medium', fontSize: 16, color: colors.textPrimary },
    errorBody: { ...Typography.caption, color: colors.textMuted },
    retryText: { fontFamily: 'Inter_500Medium', fontSize: 14, color: colors.primary },
    emptyBlock: { padding: 48, alignItems: 'center', gap: 8 },
    emptyTitle: { fontFamily: 'Inter_500Medium', fontSize: 16, color: colors.textPrimary },
    emptyBody: { ...Typography.caption, color: colors.textMuted, textAlign: 'center' },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 14,
      gap: 12,
      borderBottomWidth: 0.5,
      borderBottomColor: colors.border,
      backgroundColor: colors.surface,
    },
    rowTitle: { fontFamily: 'Inter_500Medium', fontSize: 16, color: colors.textPrimary },
    rowSubtitle: { ...Typography.caption, color: colors.textMuted, marginTop: 2 },
  });
