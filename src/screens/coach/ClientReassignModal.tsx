/**
 * ClientReassignModal
 *
 * Allows a head coach to pick a destination sub-coach for a specific client,
 * confirm the reassignment, and fire the mutation. Rendered as a full-screen
 * modal-style stack screen (no bottom tabs visible).
 *
 * Route params: { clientId, clientName, fromSubCoachId }
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp, RouteProp } from '@react-navigation/native-stack';
import { Colors } from '../../constants/colors';
import { subCoachApi, SubCoachSummary } from '../../api/subCoachApi';
import type { TeamStackParamList } from '../../navigation/CoachNavigator';

export default function ClientReassignModal() {
  const navigation =
    useNavigation<NativeStackNavigationProp<TeamStackParamList>>();
  const route = useRoute<RouteProp<TeamStackParamList, 'ClientReassign'>>();
  const { clientId, clientName, fromSubCoachId } = route.params;

  const [subCoaches, setSubCoaches] = useState<SubCoachSummary[]>([]);
  const [selected, setSelected] = useState<SubCoachSummary | null>(null);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    subCoachApi
      .listSubCoaches()
      .then((res) => {
        // Exclude the current coach from the destination list.
        const others = (res.data ?? []).filter(
          (sc) => sc.id !== fromSubCoachId,
        );
        setSubCoaches(others);
      })
      .catch(() => setError('Could not load team.'))
      .finally(() => setLoading(false));
  }, [fromSubCoachId]);

  const handleConfirm = useCallback(async () => {
    if (!selected) return;
    setSubmitting(true);
    try {
      await subCoachApi.reassignClient(selected.id, {
        clientId,
        reason: reason.trim() || undefined,
      });
      navigation.pop(2); // dismiss modal and detail screen
    } catch {
      Alert.alert(
        'Reassignment failed',
        'The client could not be reassigned. The destination coach may be at capacity.',
      );
    } finally {
      setSubmitting(false);
    }
  }, [selected, clientId, reason, navigation]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Reassign {clientName}</Text>
      <Text style={styles.subtitle}>Choose a destination coach</Text>

      {error != null && <Text style={styles.errorText}>{error}</Text>}

      {loading ? (
        <ActivityIndicator size="large" color={Colors.primary} style={styles.loader} />
      ) : (
        <FlatList
          data={subCoaches}
          keyExtractor={(item) => item.id}
          style={styles.list}
          renderItem={({ item }) => {
            const isSelected = selected?.id === item.id;
            const atCapacity = !item.capacity.hasCapacity;
            return (
              <Pressable
                style={[styles.option, isSelected && styles.optionSelected, atCapacity && styles.optionDisabled]}
                onPress={() => !atCapacity && setSelected(item)}
                accessibilityRole="radio"
                accessibilityState={{ checked: isSelected, disabled: atCapacity }}
                accessibilityLabel={`${item.name}${atCapacity ? ', at capacity' : ''}`}
                disabled={atCapacity}
              >
                <View style={styles.optionInfo}>
                  <Text style={[styles.optionName, atCapacity && styles.optionNameMuted]}>
                    {item.name}
                  </Text>
                  <Text style={styles.optionCapacity}>
                    {item.capacity.assignedClients} / {item.capacity.maxClients} clients
                    {atCapacity ? ' (full)' : ''}
                  </Text>
                </View>
                {isSelected && (
                  <View style={styles.checkmark} accessibilityLabel="Selected">
                    <Text style={styles.checkmarkText}>OK</Text>
                  </View>
                )}
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <Text style={styles.emptyText}>No other coaches available.</Text>
          }
        />
      )}

      <TextInput
        style={styles.reasonInput}
        placeholder="Reason (optional)"
        placeholderTextColor={Colors.textMuted}
        value={reason}
        onChangeText={setReason}
        multiline
        maxLength={280}
        accessibilityLabel="Reason for reassignment"
      />

      <View style={styles.actions}>
        <Pressable
          style={styles.cancelBtn}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Cancel reassignment"
          disabled={submitting}
        >
          <Text style={styles.cancelBtnText}>Cancel</Text>
        </Pressable>
        <Pressable
          style={[styles.confirmBtn, (!selected || submitting) && styles.confirmBtnDisabled]}
          onPress={handleConfirm}
          accessibilityRole="button"
          accessibilityLabel={selected ? `Confirm reassign to ${selected.name}` : 'Select a coach first'}
          disabled={!selected || submitting}
        >
          {submitting ? (
            <ActivityIndicator size="small" color={Colors.textOnPrimary} />
          ) : (
            <Text style={styles.confirmBtnText}>Confirm</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    paddingTop: 56,
    paddingHorizontal: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 15,
    color: Colors.textSecondary,
    marginBottom: 20,
  },
  loader: {
    marginTop: 40,
  },
  list: {
    flexGrow: 0,
    maxHeight: 320,
    marginBottom: 16,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 4,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  optionSelected: {
    borderColor: Colors.primary,
  },
  optionDisabled: {
    opacity: 0.45,
  },
  optionInfo: {
    flex: 1,
  },
  optionName: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  optionNameMuted: {
    color: Colors.textMuted,
  },
  optionCapacity: {
    fontSize: 13,
    color: Colors.textMuted,
    marginTop: 2,
  },
  checkmark: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkmarkText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textOnPrimary,
  },
  reasonInput: {
    backgroundColor: Colors.surface,
    borderRadius: 4,
    padding: 12,
    fontSize: 15,
    color: Colors.textPrimary,
    minHeight: 72,
    textAlignVertical: 'top',
    marginBottom: 20,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    paddingBottom: 32,
  },
  cancelBtn: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 4,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cancelBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  confirmBtn: {
    flex: 1,
    backgroundColor: Colors.primary,
    borderRadius: 4,
    paddingVertical: 14,
    alignItems: 'center',
  },
  confirmBtnDisabled: {
    opacity: 0.45,
  },
  confirmBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.textOnPrimary,
  },
  errorText: {
    color: Colors.error,
    fontSize: 14,
    marginBottom: 12,
  },
  emptyText: {
    fontSize: 15,
    color: Colors.textMuted,
    textAlign: 'center',
    paddingVertical: 24,
  },
});
