/**
 * BlockedUsersScreen — Settings entry for managing the local block list.
 *
 * Apple 1.2 / Series D+ requirement: users must be able to view and undo their
 * block actions. Renders the local zustand store; each row offers an Unblock
 * button that calls DELETE /users/:id/block + removes the row from the store.
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
import { useCurrentUser } from '../../hooks/useCurrentUser';

export default function BlockedUsersScreen(): React.ReactElement {
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const store = useBlockedUsersStore();
  const currentUser = useCurrentUser();
  const [working, setWorking] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string>('');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const uid = currentUser?.id;
      if (!uid) {
        if (!cancelled) setLoading(false);
        return;
      }
      setFetchError('');
      const s = useBlockedUsersStore.getState();
      if (!s.hydrated || s.userId !== uid) {
        await s.hydrate(uid);
      }
      try {
        const res = await messagesModerationApi.listBlocked();
        if (cancelled) return;
        // Preserve the server-provided blockedAt instead of stamping new Date().
        await useBlockedUsersStore.getState().addFromServer(res.blocked);
      } catch {
        if (!cancelled) {
          setFetchError("Couldn't load the latest block list. Pull to retry.");
        }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [currentUser?.id, refreshKey]);

  const handleRetry = useCallback(() => {
    setLoading(true);
    setRefreshKey((k) => k + 1);
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
      ) : fetchError && store.blocked.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="cloud-offline-outline" size={36} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>Couldn't load your block list</Text>
          <Text style={styles.emptyBody}>{fetchError}</Text>
          <Pressable
            onPress={handleRetry}
            style={({ pressed }) => [
              styles.unblockBtn,
              pressed && styles.unblockBtnPressed,
              { marginTop: 12 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Retry loading block list"
          >
            <Text style={styles.unblockText}>Retry</Text>
          </Pressable>
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
