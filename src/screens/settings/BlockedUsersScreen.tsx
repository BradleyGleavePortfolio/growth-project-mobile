/**
 * BlockedUsersScreen — Settings entry for managing the local block list.
 *
 * Apple 1.2 / Series D+ requirement: users must be able to view and undo their
 * block actions. Renders the local zustand store; each row offers an Unblock
 * button that calls /users/{id}/unblock + removes the row from the store.
 */
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, NavigationProp, ParamListBase } from '@react-navigation/native';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { useBlockedUsersStore, BlockedUser } from '../../store/blockedUsersStore';
import { messagesModerationApi } from '../../api/messagesApi';

export default function BlockedUsersScreen(): React.ReactElement {
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const store = useBlockedUsersStore();
  const [working, setWorking] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!store.hydrated) await store.hydrate();
      try {
        const res = await messagesModerationApi.listBlocked();
        const localIds = new Set(store.blocked.map((b) => b.id));
        for (const id of res.blocked_user_ids) {
          if (!localIds.has(id)) {
            await store.block({ id, displayName: 'Blocked user', role: 'other' });
          }
        }
      } catch {
        // Non-fatal — local list still renders.
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleUnblock = useCallback(
    (user: BlockedUser) => {
      Alert.alert(`Unblock ${user.displayName}?`, "They'll be able to message you again.", [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unblock',
          onPress: async () => {
            setWorking(user.id);
            try {
              await messagesModerationApi.unblock(user.id);
              await store.unblock(user.id);
            } catch {
              Alert.alert(
                'Could not unblock',
                "Something went wrong. Please try again.",
              );
            } finally {
              setWorking(null);
            }
          },
        },
      ]);
    },
    [store],
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.title}>Blocked Users</Text>
        <View style={{ width: 26 }} />
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={store.blocked}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="shield-checkmark-outline" size={36} color={colors.textMuted} />
              <Text style={styles.emptyTitle}>No blocked users</Text>
              <Text style={styles.emptyBody}>
                When you block someone from a conversation, they'll appear here.
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.row}>
              <View style={styles.rowLeft}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>
                    {item.displayName
                      .split(/\s+/)
                      .filter(Boolean)
                      .slice(0, 2)
                      .map((s) => s[0]?.toUpperCase() ?? '')
                      .join('') || '?'}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowName}>{item.displayName}</Text>
                  <Text style={styles.rowMeta}>
                    Blocked {new Date(item.blockedAt).toLocaleDateString()}
                  </Text>
                </View>
              </View>
              <Pressable
                onPress={() => handleUnblock(item)}
                disabled={working === item.id}
                style={({ pressed }) => [
                  styles.unblockBtn,
                  pressed && styles.unblockBtnPressed,
                  working === item.id && styles.unblockBtnDisabled,
                ]}
                accessibilityRole="button"
                accessibilityLabel={`Unblock ${item.displayName}`}
              >
                {working === item.id ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Text style={styles.unblockText}>Unblock</Text>
                )}
              </Pressable>
            </View>
          )}
        />
      )}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingTop: 56,
      paddingBottom: 12,
      backgroundColor: colors.surface,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    title: { fontSize: 16, fontWeight: '600', color: colors.textPrimary },
    list: { padding: 16, gap: 8 },
    loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    empty: { alignItems: 'center', paddingTop: 80, gap: 8, paddingHorizontal: 32 },
    emptyTitle: { fontSize: 16, fontWeight: '600', color: colors.textPrimary },
    emptyBody: { fontSize: 13, color: colors.textSecondary, textAlign: 'center' },

    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: colors.surface,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 12,
    },
    rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
    avatar: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.primary,
      justifyContent: 'center',
      alignItems: 'center',
    },
    avatarText: { color: colors.textOnPrimary, fontSize: 14, fontWeight: '500' },
    rowName: { fontSize: 15, color: colors.textPrimary, fontWeight: '500' },
    rowMeta: { fontSize: 12, color: colors.textMuted },

    unblockBtn: {
      paddingVertical: 8,
      paddingHorizontal: 14,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.primary,
    },
    unblockBtnPressed: { opacity: 0.7 },
    unblockBtnDisabled: { opacity: 0.5 },
    unblockText: { fontSize: 13, color: colors.primary, fontWeight: '600' },
  });
