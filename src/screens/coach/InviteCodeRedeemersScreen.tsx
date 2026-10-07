/**
 * InviteCodeRedeemersScreen
 *
 * Drilldown from the Invite Codes list to see exactly who has signed up
 * with a specific invite code, when they redeemed it, and when they were
 * last active. This is part of the SaaS first-client onboarding loop —
 * the head coach can verify the redeemer is the right person before any
 * private data is exchanged.
 *
 * Backend contract: `coachApi.getInviteCodeRedeemers` →
 * GET /coach/invite-codes/:id/redeemers
 *
 * A missing code and a failed history request have separate states.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  FlatList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { RouteProp } from '@react-navigation/native';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { coachApi } from '../../services/api';
import { errorStatus } from '../../types/common';

interface Redeemer {
  user_id: string;
  name: string;
  email: string;
  redeemed_at: string;
  last_active_at: string | null;
}

interface Props {
  route: RouteProp<
    {
      InviteCodeRedeemers: { inviteCodeId: string; code: string };
    },
    'InviteCodeRedeemers'
  >;
  navigation: {
    goBack: () => void;
    navigate: (route: string, params?: Record<string, unknown>) => void;
  };
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ok'; redeemers: Redeemer[] }
  | { kind: 'missing' }
  | { kind: 'error' };

export default function InviteCodeRedeemersScreen({ route, navigation }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { inviteCodeId, code } = route.params;
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const res = await coachApi.getInviteCodeRedeemers(inviteCodeId);
      const redeemers = (res.data?.redeemers ?? []) as Redeemer[];
      setState({ kind: 'ok', redeemers });
    } catch (err) {
      setState({ kind: errorStatus(err) === 404 ? 'missing' : 'error' });
    }
  }, [inviteCodeId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={styles.backBtn}
        >
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.topTitle}>Who joined</Text>
          <Text style={styles.subTitle}>{code}</Text>
        </View>
        <View style={styles.backBtn} />
      </View>

      {state.kind === 'loading' && (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      )}

      {state.kind === 'error' && (
        <TouchableOpacity onPress={load} accessibilityRole="button" accessibilityLabel="Retry">
          <Text style={styles.errorText}>Could not load who joined. Check your connection, then tap to retry.</Text>
        </TouchableOpacity>
      )}

      {state.kind === 'missing' && (
        <View style={styles.empty}>
          <Ionicons name="link-outline" size={36} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>Invite code unavailable</Text>
          <Text style={styles.emptyBody}>
            This invite code could not be found. Go back to Codes and refresh the list.
          </Text>
        </View>
      )}

      {state.kind === 'ok' && state.redeemers.length === 0 && (
        <View style={styles.empty}>
          <Ionicons name="people-outline" size={36} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>No clients joined yet</Text>
          <Text style={styles.emptyBody}>
            Once a client signs up with this code they'll appear here.
          </Text>
        </View>
      )}

      {state.kind === 'ok' && state.redeemers.length > 0 && (
        <FlatList
          data={state.redeemers}
          keyExtractor={(r) => r.user_id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.row}
              accessibilityRole="button"
              accessibilityLabel={`Open ${item.name}`}
              onPress={() =>
                navigation.navigate('ClientDetail', {
                  clientId: item.user_id,
                  clientName: item.name,
                })
              }
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName}>{item.name}</Text>
                <Text style={styles.rowEmail}>{item.email}</Text>
                <Text style={styles.rowMeta}>
                  Redeemed {new Date(item.redeemed_at).toLocaleDateString()}
                  {item.last_active_at
                    ? ` · Last active ${new Date(item.last_active_at).toLocaleDateString()}`
                    : ' · Not yet active'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingTop: 56,
      paddingBottom: 12,
      gap: 8,
    },
    backBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
    topTitle: { fontSize: 18, fontWeight: '600', color: colors.textPrimary },
    subTitle: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    list: { paddingHorizontal: 20, paddingBottom: 40 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 14,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    rowName: { fontSize: 15, fontWeight: '500', color: colors.textPrimary },
    rowEmail: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
    rowMeta: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
    empty: { alignItems: 'center', padding: 32 },
    emptyTitle: { fontSize: 16, fontWeight: '600', color: colors.textPrimary, marginTop: 12 },
    emptyBody: { fontSize: 13, color: colors.textSecondary, textAlign: 'center', marginTop: 6, lineHeight: 18 },
    errorText: { color: colors.error, padding: 20, textAlign: 'center' },
  });
