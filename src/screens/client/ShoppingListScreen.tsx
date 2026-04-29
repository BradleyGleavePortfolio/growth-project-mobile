import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  Alert,
  RefreshControl,
  ActivityIndicator,
  Keyboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, NavigationProp, ParamListBase } from '@react-navigation/native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { listsApi } from '../../services/api';

import FadeInView from '../../components/FadeInView';
import EmptyState from '../../components/EmptyState';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';

// ─── Types ────────────────────────────────────────────────────────────────────
interface ListItem {
  id: string;
  name: string;
  quantity: number;
  unit?: string;
  is_checked: boolean;
  added_at: string;
}

const LIST_TYPE = 'shopping' as const;
const QUERY_KEY = ['lists', LIST_TYPE];

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function ShoppingListScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const queryClient = useQueryClient();

  const [newItemName, setNewItemName] = useState('');
  const [newItemQty, setNewItemQty] = useState('1');
  const [newItemUnit, setNewItemUnit] = useState('');

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => listsApi.getList(LIST_TYPE).then((r) => r.data as ListItem[]),
    staleTime: 60 * 1000,
  });

  const items = data ?? [];
  const unchecked = items.filter((i) => !i.is_checked);
  const checked = items.filter((i) => i.is_checked);

  const addMutation = useMutation({
    mutationFn: (name: string) =>
      listsApi.addItem(LIST_TYPE, {
        name: name.trim(),
        quantity: parseFloat(newItemQty) || 1,
        unit: newItemUnit.trim() || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      setNewItemName('');
      setNewItemQty('1');
      setNewItemUnit('');
      Keyboard.dismiss();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
    onError: () => Alert.alert('Error', 'Could not add item. Please try again.'),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, is_checked }: { id: string; is_checked: boolean }) =>
      listsApi.updateItem(id, { is_checked }),
    onMutate: async ({ id, is_checked }) => {
      await queryClient.cancelQueries({ queryKey: QUERY_KEY });
      const prev = queryClient.getQueryData<ListItem[]>(QUERY_KEY);
      queryClient.setQueryData<ListItem[]>(QUERY_KEY, (old) =>
        (old ?? []).map((i) => (i.id === id ? { ...i, is_checked } : i)),
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(QUERY_KEY, ctx.prev);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => listsApi.deleteItem(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: QUERY_KEY });
      const prev = queryClient.getQueryData<ListItem[]>(QUERY_KEY);
      queryClient.setQueryData<ListItem[]>(QUERY_KEY, (old) =>
        (old ?? []).filter((i) => i.id !== id),
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(QUERY_KEY, ctx.prev);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });

  const clearCheckedMutation = useMutation({
    mutationFn: () => listsApi.clearChecked(LIST_TYPE),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: () => Alert.alert('Error', 'Could not clear checked items.'),
  });

  const handleAdd = useCallback(() => {
    if (!newItemName.trim()) return;
    addMutation.mutate(newItemName.trim());
  }, [newItemName, addMutation]);

  const handleToggle = useCallback(
    (item: ListItem) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      toggleMutation.mutate({ id: item.id, is_checked: !item.is_checked });
    },
    [toggleMutation],
  );

  const handleDelete = useCallback(
    (item: ListItem) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      deleteMutation.mutate(item.id);
    },
    [deleteMutation],
  );

  const handleClearChecked = useCallback(() => {
    if (checked.length === 0) return;
    Alert.alert(
      'Clear checked items?',
      `Remove ${checked.length} checked item${checked.length > 1 ? 's' : ''}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear', style: 'destructive', onPress: () => clearCheckedMutation.mutate() },
      ],
    );
  }, [checked.length, clearCheckedMutation]);

  const renderItem = ({ item }: { item: ListItem }) => (
    <View style={[styles.itemRow, item.is_checked && styles.itemRowChecked]}>
      <TouchableOpacity
        style={styles.checkbox}
        onPress={() => handleToggle(item)}
        activeOpacity={0.7}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Ionicons
          name={item.is_checked ? 'checkmark-circle' : 'ellipse-outline'}
          size={24}
          color={item.is_checked ? colors.success : colors.textMuted}
        />
      </TouchableOpacity>
      <View style={styles.itemContent}>
        <Text style={[styles.itemName, item.is_checked && styles.itemNameChecked]}>
          {item.name}
        </Text>
        {(item.quantity !== 1 || item.unit) ? (
          <Text style={styles.itemMeta}>
            {item.quantity} {item.unit || 'unit'}
          </Text>
        ) : null}
      </View>
      <TouchableOpacity
        style={styles.deleteBtn}
        onPress={() => handleDelete(item)}
        activeOpacity={0.7}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Ionicons name="close-circle-outline" size={20} color={colors.textMuted} />
      </TouchableOpacity>
    </View>
  );

  const listData: Array<ListItem | { type: 'header'; label: string; count: number }> = [
    ...unchecked,
    ...(checked.length > 0 ? [{ type: 'header' as const, label: 'Checked', count: checked.length }] : []),
    ...checked,
  ];

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Shopping List</Text>
        {checked.length > 0 ? (
          <TouchableOpacity
            style={styles.clearBtn}
            onPress={handleClearChecked}
            activeOpacity={0.7}
            disabled={clearCheckedMutation.isPending}
          >
            <Text style={styles.clearBtnText}>Clear checked</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Add item input */}
      <View style={styles.addRow}>
        <View style={styles.addInputs}>
          <TextInput
            style={styles.nameInput}
            placeholder="Add item…"
            placeholderTextColor={colors.textMuted}
            value={newItemName}
            onChangeText={setNewItemName}
            returnKeyType="done"
            onSubmitEditing={handleAdd}
          />
          <TextInput
            style={styles.qtyInput}
            placeholder="Qty"
            placeholderTextColor={colors.textMuted}
            value={newItemQty}
            onChangeText={setNewItemQty}
            keyboardType="numeric"
            returnKeyType="done"
          />
          <TextInput
            style={styles.unitInput}
            placeholder="Unit"
            placeholderTextColor={colors.textMuted}
            value={newItemUnit}
            onChangeText={setNewItemUnit}
            returnKeyType="done"
          />
        </View>
        <TouchableOpacity
          style={[styles.addBtn, !newItemName.trim() && styles.addBtnDisabled]}
          onPress={handleAdd}
          disabled={!newItemName.trim() || addMutation.isPending}
          activeOpacity={0.8}
        >
          {addMutation.isPending ? (
            <ActivityIndicator size="small" color={colors.textOnPrimary} />
          ) : (
            <Ionicons name="add" size={22} color={colors.textOnPrimary} />
          )}
        </TouchableOpacity>
      </View>

      {/* List */}
      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading shopping list…</Text>
        </View>
      ) : isError ? (
        <EmptyState
          icon="alert-circle-outline"
          title="Couldn't load list"
          subtitle="Pull down to try again."
        />
      ) : items.length === 0 ? (
        <FadeInView>
          <EmptyState
            icon="bag-outline"
            title="Your shopping list is empty"
            subtitle="Add items using the field above."
          />
        </FadeInView>
      ) : (
        <FlatList
          data={listData}
          keyExtractor={(item) =>
            'type' in item ? `header-${item.label}` : item.id
          }
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={colors.primary}
            />
          }
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => {
            if ('type' in item) {
              return (
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionHeaderText}>
                    {item.label} ({item.count})
                  </Text>
                </View>
              );
            }
            return renderItem({ item });
          }}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 60,
    marginBottom: 16,
    gap: 12,
  },
  backBtn: { width: 40, height: 40, justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '500', color: colors.textPrimary, flex: 1 },
  clearBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: colors.error + '15',
    borderRadius: 0, // radius.sm
  },
  clearBtnText: { fontSize: 13, fontWeight: '500', color: colors.error },

  addRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginBottom: 12,
    gap: 8,
    alignItems: 'center',
  },
  addInputs: { flex: 1, flexDirection: 'row', gap: 6 },
  nameInput: {
    flex: 3,
    height: 44,
    backgroundColor: colors.surface,
    borderRadius: 4, // radius.lg
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    fontSize: 14,
    color: colors.textPrimary,
  },
  qtyInput: {
    flex: 1,
    height: 44,
    backgroundColor: colors.surface,
    borderRadius: 4, // radius.lg
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 8,
    fontSize: 14,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  unitInput: {
    flex: 1,
    height: 44,
    backgroundColor: colors.surface,
    borderRadius: 4, // radius.lg
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 8,
    fontSize: 14,
    color: colors.textPrimary,
  },
  addBtn: {
    width: 44,
    height: 44,
    backgroundColor: colors.primary,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnDisabled: { opacity: 0.5 },

  loadingContainer: { alignItems: 'center', paddingTop: 60, gap: 12 },
  loadingText: { fontSize: 15, color: colors.textMuted },

  listContent: { paddingHorizontal: 16, paddingBottom: 40 },

  sectionHeader: {
    paddingVertical: 8,
    paddingHorizontal: 4,
    marginTop: 8,
  },
  sectionHeaderText: { fontSize: 13, fontWeight: '500', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },

  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 2, // radius.md
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 10,
  },
  itemRowChecked: { opacity: 0.6 },
  checkbox: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  itemContent: { flex: 1 },
  itemName: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  itemNameChecked: { textDecorationLine: 'line-through', color: colors.textMuted },
  itemMeta: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
  deleteBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },

  });
