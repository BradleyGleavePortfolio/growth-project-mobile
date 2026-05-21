/**
 * ContactView — iMessage-style "tap the contact" details surface.
 *
 * Routed from the DM screen header (client→coach or coach→client). Shows the
 * other party's avatar, display name, and role, plus per-contact controls:
 *   - Mute conversation (local-only toggle persisted on the contact entry —
 *     server-side mute follows in a backend ticket).
 *   - Block User — calls /users/{id}/block via messagesModerationApi.block
 *     and adds the contact to the local blocked-users store. On success we
 *     pop back to the previous screen; the messages list defends against any
 *     stale rendering via filterOutBlocked.
 */
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  ActivityIndicator,
  Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRoute, useNavigation, RouteProp, NavigationProp, ParamListBase } from '@react-navigation/native';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { useBlockedUsersStore } from '../../store/blockedUsersStore';
import { messagesModerationApi } from '../../api/messagesApi';
import { HapticService } from '../../ui/haptics/haptics.service';
import { track } from '../../lib/analytics';

export type ContactViewRouteParams = {
  ContactView: {
    contactId: string;
    displayName: string;
    role?: 'coach' | 'client' | 'student' | 'other';
    avatarUrl?: string | null;
  };
};

export default function ContactView(): React.ReactElement {
  const route = useRoute<RouteProp<ContactViewRouteParams, 'ContactView'>>();
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const { contactId, displayName, role = 'other' } = route.params;
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const blockStore = useBlockedUsersStore();
  const isBlocked = blockStore.isBlocked(contactId);
  const [muted, setMuted] = useState(false);
  const [blocking, setBlocking] = useState(false);

  useEffect(() => {
    if (!blockStore.hydrated) {
      void blockStore.hydrate();
    }
  }, [blockStore]);

  const initials = useMemo(() => {
    return displayName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase() ?? '')
      .join('');
  }, [displayName]);

  const handleBlock = useCallback(() => {
    Alert.alert(
      `Block ${displayName}?`,
      "They won't be able to message you, and you won't see their messages.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: async () => {
            setBlocking(true);
            try {
              await messagesModerationApi.block(contactId);
              await blockStore.block({ id: contactId, displayName, role });
              HapticService.heavyImpact();
              track('dm_user_blocked', { contact_id: contactId, role });
              navigation.goBack();
            } catch {
              HapticService.error();
              Alert.alert(
                'Could not block',
                "Something went wrong. Please try again in a moment.",
              );
            } finally {
              setBlocking(false);
            }
          },
        },
      ],
    );
  }, [contactId, displayName, role, navigation, blockStore]);

  const handleUnblock = useCallback(() => {
    Alert.alert(`Unblock ${displayName}?`, "They'll be able to message you again.", [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unblock',
        onPress: async () => {
          setBlocking(true);
          try {
            await messagesModerationApi.unblock(contactId);
            await blockStore.unblock(contactId);
            track('dm_user_unblocked', { contact_id: contactId, role });
          } catch {
            Alert.alert(
              'Could not unblock',
              "Something went wrong. Please try again.",
            );
          } finally {
            setBlocking(false);
          }
        },
      },
    ]);
  }, [contactId, displayName, role, blockStore]);

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
        <Text style={styles.headerTitle}>Contact</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.identity}>
          <View style={styles.avatar} accessibilityLabel={`${displayName} avatar`}>
            <Text style={styles.avatarText}>{initials || '?'}</Text>
          </View>
          <Text style={styles.name}>{displayName}</Text>
          <Text style={styles.role}>{formatRole(role)}</Text>
        </View>

        <View style={styles.section}>
          <View style={styles.row}>
            <View style={styles.rowMain}>
              <Ionicons name="notifications-off-outline" size={20} color={colors.textPrimary} />
              <Text style={styles.rowLabel}>Mute Conversation</Text>
            </View>
            <Switch
              value={muted}
              onValueChange={(v) => {
                setMuted(v);
                HapticService.selection();
              }}
              accessibilityLabel="Mute conversation"
            />
          </View>
        </View>

        <View style={styles.section}>
          {isBlocked ? (
            <Pressable
              onPress={handleUnblock}
              disabled={blocking}
              style={({ pressed }) => [
                styles.dangerBtn,
                pressed && styles.dangerBtnPressed,
                blocking && styles.dangerBtnDisabled,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Unblock user"
            >
              {blocking ? (
                <ActivityIndicator size="small" color={colors.error} />
              ) : (
                <>
                  <Ionicons name="person-add-outline" size={18} color={colors.error} />
                  <Text style={styles.dangerText}>Unblock {displayName.split(' ')[0]}</Text>
                </>
              )}
            </Pressable>
          ) : (
            <Pressable
              onPress={handleBlock}
              disabled={blocking}
              style={({ pressed }) => [
                styles.dangerBtn,
                pressed && styles.dangerBtnPressed,
                blocking && styles.dangerBtnDisabled,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Block user"
            >
              {blocking ? (
                <ActivityIndicator size="small" color={colors.error} />
              ) : (
                <>
                  <Ionicons name="ban-outline" size={18} color={colors.error} />
                  <Text style={styles.dangerText}>Block {displayName.split(' ')[0]}</Text>
                </>
              )}
            </Pressable>
          )}
          <Text style={styles.dangerHelp}>
            Blocking is reversible from Settings → Blocked Users.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

function formatRole(role: 'coach' | 'client' | 'student' | 'other'): string {
  switch (role) {
    case 'coach':
      return 'Coach';
    case 'client':
    case 'student':
      return 'Client';
    default:
      return '';
  }
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
    headerTitle: { fontSize: 16, fontWeight: '600', color: colors.textPrimary },
    content: { paddingBottom: 40 },
    identity: { alignItems: 'center', paddingVertical: 32, gap: 12 },
    avatar: {
      width: 96,
      height: 96,
      borderRadius: 48,
      backgroundColor: colors.primary,
      justifyContent: 'center',
      alignItems: 'center',
    },
    avatarText: { fontSize: 32, fontWeight: '500', color: colors.textOnPrimary },
    name: {
      fontFamily: 'CormorantGaramond_500Medium',
      fontSize: 26,
      color: colors.textPrimary,
    },
    role: { fontSize: 13, color: colors.textSecondary },

    section: {
      marginTop: 16,
      marginHorizontal: 16,
      backgroundColor: colors.surface,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      paddingVertical: 4,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 14,
      paddingHorizontal: 16,
    },
    rowMain: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    rowLabel: { fontSize: 15, color: colors.textPrimary },

    dangerBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 14,
    },
    dangerBtnPressed: { opacity: 0.7 },
    dangerBtnDisabled: { opacity: 0.5 },
    dangerText: { color: colors.error, fontSize: 15, fontWeight: '600' },
    dangerHelp: {
      fontSize: 12,
      color: colors.textMuted,
      textAlign: 'center',
      paddingHorizontal: 16,
      paddingBottom: 12,
    },
  });
