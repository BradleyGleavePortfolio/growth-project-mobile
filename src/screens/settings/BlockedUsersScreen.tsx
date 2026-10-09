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
import { useNavigation, NavigationProp, ParamListBase } from '@react-navigation/native';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { layout, radius, typography } from '../../theme/tokens';
import { Headline, Lede, Screen, ScreenTopBar } from '../../ui';
import { useBlockedUsersStore, BlockedUser } from '../../store/blockedUsersStore';
import { messagesModerationApi } from '../../api/messagesApi';
import { useCurrentUser } from '../../hooks/useCurrentUser';

// The error states offer a Retry button; there is no pull-to-refresh.
const LOAD_FAILED = 'The latest block list could not be loaded. Check your connection, then tap Retry.';
const LIST_STALE = 'This list may be out of date. Check your connection, then tap Retry.';

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
          setFetchError(LOAD_FAILED);
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
              Alert.alert('Could not unblock', 'Check your connection, then tap Unblock again.');
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
    <Screen
      edges={['top']}
      scroll={false}
      contentStyle={styles.frame}
      header={<ScreenTopBar onBack={() => navigation.goBack()} backLabel="Go back" />}
    >
      <View style={styles.titleBlock}>
        <Headline level="h1">Blocked users</Headline>
        <Lede>People you have blocked in messages are listed here.</Lede>
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      ) : fetchError && store.blocked.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Couldn't load your block list</Text>
          <Text style={styles.emptyBody}>{fetchError}</Text>
          <Pressable
            onPress={handleRetry}
            style={({ pressed }) => [
              styles.unblockBtn,
              pressed && styles.unblockBtnPressed,
              { marginTop: 8 },
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
          ItemSeparatorComponent={() => <View style={styles.hairline} />}
          ListHeaderComponent={
            fetchError ? (
              <View style={styles.stale} accessibilityLiveRegion="polite">
                <Text style={styles.emptyBody}>{LIST_STALE}</Text>
                <Pressable onPress={handleRetry} style={styles.unblockBtn} accessibilityRole="button" accessibilityLabel="Retry loading block list">
                  <Text style={styles.unblockText}>Retry</Text>
                </Pressable>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.empty}>
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
    </Screen>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    frame: { paddingHorizontal: 0 },
    titleBlock: { paddingHorizontal: layout.gutter, paddingTop: 8, paddingBottom: 20, gap: 8 },
    list: { paddingHorizontal: layout.gutter, paddingBottom: 48, flexGrow: 1,
      borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    hairline: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
    stale: { paddingVertical: 12, gap: 8, alignItems: 'flex-start' },
    loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    empty: { paddingTop: 40, gap: 8 },
    emptyTitle: { ...typography.h3, color: colors.textPrimary },
    emptyBody: { ...typography.bodySmall, fontSize: 15, color: colors.textSecondary },

    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 14,
      gap: 12,
    },
    rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 14, flex: 1 },
    avatar: {
      width: 40,
      height: 40,
      borderRadius: radius.chip,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      justifyContent: 'center',
      alignItems: 'center',
    },
    avatarText: { color: colors.textSecondary, fontSize: 14, fontWeight: '500' },
    rowName: { fontSize: 16, color: colors.textPrimary, fontWeight: '500' },
    rowMeta: { fontSize: 13, color: colors.textMuted, marginTop: 2, fontVariant: ['tabular-nums'] },

    unblockBtn: {
      minHeight: 44,
      minWidth: 88,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 16,
      borderRadius: radius.button,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.primary,
    },
    unblockBtnPressed: { opacity: 0.7 },
    unblockBtnDisabled: { opacity: 0.5 },
    unblockText: { fontSize: 15, color: colors.primary, fontWeight: '500' },
  });
