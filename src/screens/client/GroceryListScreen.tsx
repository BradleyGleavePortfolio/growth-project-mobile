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
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { typography, radius } from '../../theme/tokens';
import { PrimaryButton, TextLink } from '../../ui';
import { HapticService } from '../../ui/haptics/haptics.service';
import { StyleCCheck, StyleCLoadingLines, StyleCMasthead, StyleCNotice, StyleCPage } from '../../ui/layout/StyleCPage';

function EmptyState({ title, subtitle }: { icon: string; title: string; subtitle: string }) {
  const { semanticColors: sc } = useTheme();
  return <View style={{ padding: 24, gap: 12 }}><Text style={[typography.h2, { color: sc.textPrimary }]}>{title}</Text><Text style={[typography.bodySmall, { color: sc.textMuted }]}>{subtitle}</Text></View>;
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface ListItem {
  id: string;
  name: string;
  quantity: number;
  unit?: string;
  is_checked: boolean;
  added_at: string;
  source_recipe_id?: string;
  list_type?: 'grocery' | 'shopping';
}

const LIST_TYPE = 'grocery' as const;
const QUERY_KEY = ['lists', LIST_TYPE];

// One list (owner 10-07, CF-ONE-LIST-128): More no longer opens a Shopping list, so rows a client saved
// there are read here too and can be checked, removed and cleared like grocery rows. New rows go to grocery.
// The shopping read runs only after the grocery read succeeds, so a failed load costs one request.
async function fetchOneList(): Promise<ListItem[]> {
  const grocery = (await listsApi.getList(LIST_TYPE)).data as ListItem[];
  const shopping = (await listsApi.getList('shopping')).data as ListItem[];
  const groceryIds = new Set(grocery.map((item) => item.id));
  return [
    ...grocery,
    ...shopping.filter((item) => !groceryIds.has(item.id)).map((item) => ({ ...item, list_type: 'shopping' as const })),
  ];
}
const fromShopping = (item: ListItem) => item.list_type === 'shopping';

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function GroceryListScreen() {
  const { semanticColors: sc } = useTheme();
  const colors = useMemo(() => ({
    background: sc.bgPrimary, surface: sc.bgPrimary, primary: sc.accent,
    textPrimary: sc.textPrimary, textMuted: sc.textMuted, textOnPrimary: sc.textOnAccent,
    border: sc.border, success: sc.textMuted, error: sc.textMuted,
  }), [sc]);
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const queryClient = useQueryClient();

  const [newItemName, setNewItemName] = useState('');
  const [newItemQty, setNewItemQty] = useState('1');
  const [newItemUnit, setNewItemUnit] = useState('');

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchOneList,
    staleTime: 60 * 1000,
  });

  const items = data ?? [];
  const unchecked = items.filter((i) => !i.is_checked);
  const checked = items.filter((i) => i.is_checked);
  const hasShoppingItems = items.some(fromShopping);
  const clearsShopping = checked.some(fromShopping);

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
    onError: () => Alert.alert('Could not add grocery item', 'Your item is still in the form. Check your connection and tap Add again.'),
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
    mutationFn: (withShopping: boolean) => Promise.all([
      listsApi.clearChecked(LIST_TYPE),
      ...(withShopping ? [listsApi.clearChecked('shopping')] : []),
    ]),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: () => Alert.alert('Could not clear grocery items', 'Checked items could not be removed. Refresh the grocery list before clearing them again.'),
  });

  const handleAdd = useCallback(() => {
    if (!newItemName.trim()) return;
    addMutation.mutate(newItemName.trim());
  }, [newItemName, addMutation]);

  const handleToggle = useCallback(
    (item: ListItem) => {
      void HapticService.selection(); // C2 section 5: a check is a selection tick
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
        { text: 'Clear', style: 'destructive', onPress: () => clearCheckedMutation.mutate(clearsShopping) },
      ],
    );
  }, [checked.length, clearsShopping, clearCheckedMutation]);

  const renderItem = ({ item }: { item: ListItem }) => (
    <View style={[styles.itemRow, item.is_checked && styles.itemRowChecked]}>
      <TouchableOpacity
        accessibilityRole="checkbox" accessibilityLabel={`${item.is_checked ? 'Uncheck' : 'Check'} ${item.name}`} accessibilityState={{ checked: item.is_checked }}
        style={styles.checkbox}
        onPress={() => handleToggle(item)}
        activeOpacity={0.7}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <StyleCCheck checked={item.is_checked} />
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
        accessibilityRole="button" accessibilityLabel={`Remove ${item.name}`}
        style={styles.deleteBtn}
        onPress={() => handleDelete(item)}
        activeOpacity={0.7}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Ionicons name="close" size={20} color={colors.textMuted} />
      </TouchableOpacity>
    </View>
  );

  const listData: Array<ListItem | { type: 'header'; label: string; count: number }> = [
    ...(unchecked.length > 0 ? [{ type: 'header' as const, label: 'To get', count: unchecked.length }] : []),
    ...unchecked,
    ...(checked.length > 0 ? [{ type: 'header' as const, label: 'Checked', count: checked.length }] : []),
    ...checked,
  ];

  return (
    <StyleCPage testID="grocery-prep-screen" paperStyle={styles.paper} head={<StyleCMasthead title="Grocery list" onBack={() => navigation.goBack()} />}>
      {!isLoading && !isError && items.length > 0 ? <Text style={[styles.summary, hasShoppingItems && styles.summaryWithNote]}>{unchecked.length > 0 ? `${unchecked.length} to get.` : 'All items checked.'}</Text> : null}
      {!isLoading && !isError && hasShoppingItems ? <Text style={styles.note}>Includes items from your shopping list.</Text> : null}

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
          accessibilityRole="button" accessibilityLabel="Add item"
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
          <Text style={styles.loadingText}>Loading grocery list…</Text>
          <StyleCLoadingLines />
        </View>
      ) : isError ? (
        <View style={styles.loadingContainer}>
          <StyleCNotice>Couldn't load grocery list.</StyleCNotice>
          <PrimaryButton label="Try again" onPress={() => refetch()} disabled={isRefetching} haptic={false} />
        </View>
      ) : items.length === 0 ? (
        <FadeInView>
          <EmptyState
            icon="cart-outline"
            title="Your grocery list is empty"
            subtitle="Add items using the field above."
          />
        </FadeInView>
      ) : (
        <FlatList
          testID="list-scroll"
          data={listData}
          keyExtractor={(item) =>
            'type' in item ? `header-${item.label}` : item.id
          }
          refreshControl={
            <RefreshControl
              testID="list-refresh"
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={colors.primary}
            />
          }
          contentContainerStyle={styles.listContent}
          ListFooterComponent={checked.length > 0 ? (
            <TextLink label="Clear checked" tone="accent" align="start" onPress={handleClearChecked} disabled={clearCheckedMutation.isPending} style={styles.clearBtn} />
          ) : null}
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
    </StyleCPage>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const makeStyles = (colors: Pick<ThemeColors, 'background' | 'surface' | 'primary' | 'textPrimary' | 'textMuted' | 'textOnPrimary' | 'border' | 'error'>) =>
  StyleSheet.create({
  // StyleCPage owns the masthead, the inset top and the page colours; the paper holds the list.
  paper: { paddingTop: 24 },
  summary: { ...typography.h2, color: colors.textPrimary, paddingHorizontal: 24, marginBottom: 24, fontVariant: ['tabular-nums'] },
  summaryWithNote: { marginBottom: 4 },
  note: { ...typography.bodySmall, color: colors.textMuted, paddingHorizontal: 24, marginBottom: 24 },
  clearBtn: { marginTop: 12 },

  addRow: {
    flexDirection: 'row',
    paddingHorizontal: 24,
    marginBottom: 12,
    gap: 12,
    alignItems: 'flex-end',
  },
  // Underlined fields (C_grocery), not boxes; the name takes its own line so Qty and Unit fit at 130%.
  addInputs: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', columnGap: 12 },
  nameInput: {
    fontFamily: typography.body.fontFamily,
    flexBasis: '100%',
    height: 48,
    borderBottomWidth: 1,
    borderColor: colors.textPrimary,
    fontSize: 17,
    color: colors.textPrimary,
  },
  qtyInput: {
    fontFamily: typography.body.fontFamily, fontVariant: ['tabular-nums'],
    width: 72,
    height: 44,
    borderBottomWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 8,
    fontSize: 16,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  unitInput: {
    fontFamily: typography.body.fontFamily,
    flex: 1,
    minWidth: 0,
    height: 44,
    borderBottomWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 8,
    fontSize: 16,
    color: colors.textPrimary,
  },
  addBtn: {
    width: 44,
    height: 44,
    backgroundColor: colors.primary,
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnDisabled: { opacity: 0.5 },

  loadingContainer: { paddingHorizontal: 24, paddingTop: 24, gap: 16 },
  loadingText: { ...typography.bodySmall, color: colors.textMuted },

  listContent: { paddingHorizontal: 24, paddingBottom: 48 },

  sectionHeader: {
    paddingTop: 20,
    paddingBottom: 4,
  },
  sectionHeaderText: { ...typography.eyebrow, color: colors.textMuted, fontVariant: ['tabular-nums'] },

  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    // A hairline row, not a boxed card (CATALOG: hairline sections).
    minHeight: 64,
    paddingVertical: 6,
    paddingHorizontal: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    gap: 10,
  },
  itemRowChecked: { opacity: 1 },
  checkbox: { width: 44, height: 44, marginLeft: -8, alignItems: 'center', justifyContent: 'center' },
  itemContent: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 12 },
  itemName: { ...typography.h3, fontFamily: 'CormorantGaramond_400Regular', fontSize: 20, lineHeight: 26, color: colors.textPrimary, flexGrow: 1, flexShrink: 1, flexBasis: '55%' },
  itemNameChecked: { textDecorationLine: 'line-through', color: colors.textMuted },
  itemMeta: { ...typography.body, color: colors.textMuted, fontVariant: ['tabular-nums'], textAlign: 'right', flexShrink: 0, marginLeft: 'auto' },
  deleteBtn: { width: 44, height: 44, marginRight: -12, alignItems: 'center', justifyContent: 'center' },

  });

/** The same rows and fields on the Shopping list (one look for both lists). */
export const makeListStyles = makeStyles;
