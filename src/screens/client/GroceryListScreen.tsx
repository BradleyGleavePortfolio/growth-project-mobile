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
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, NavigationProp, ParamListBase } from '@react-navigation/native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { listsApi } from '../../services/api';

import FadeInView from '../../components/FadeInView';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { colors as palette, layout, typography, radius, withAlpha } from '../../theme/tokens';
import { PrimaryButton, TextLink, Screen } from '../../ui';
import { HapticService } from '../../ui/haptics/haptics.service';
import { StyleCCheck, StyleCDashes, StyleCEmpty, StyleCLoadingLines, StyleCMasthead, StyleCMastText, StyleCNotice, StyleCPaper, usePullToRefresh, useStyleCScreen } from '../../ui/layout/StyleCPage';

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

// One read (owner 10-07, CF-ONE-LIST-128): More no longer opens a Shopping list, so rows a client saved there are
// read here too. The shopping read runs only after the grocery read succeeds, so a failed load costs one request.
// SHOP-SWITCH-M (owner 203-D16 op 1, ctx#527 style 1): the switch under the title chooses which list the page shows.
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

// Each list's words, all main's: the grocery ones from this screen, the shopping ones from ShoppingListScreen.tsx.
const LISTS = {
  grocery: {
    tab: 'Grocery', title: 'Grocery list', loading: 'Loading grocery list…', failed: "Couldn't load grocery list.",
    empty: 'Your grocery list is empty', addFailed: 'Could not add grocery item', clearFailed: 'Could not clear grocery items',
    clearLine: 'Checked items could not be removed. Refresh the grocery list before clearing them again.',
  },
  shopping: {
    tab: 'Shopping', title: 'Shopping list', loading: 'Loading shopping list…', failed: "Couldn't load shopping list.",
    empty: 'Your shopping list is empty', addFailed: 'Could not add shopping item', clearFailed: 'Could not clear shopping items',
    clearLine: 'Checked items could not be removed. Refresh the shopping list before clearing them again.',
  },
} as const;
type ListType = keyof typeof LISTS;
/** A row is on Shopping when it came from the shopping read (above), else on Grocery. */
const onList = (type: ListType) => (item: ListItem) => fromShopping(item) === (type === 'shopping');

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function GroceryListScreen() {
  const page = useStyleCScreen();
  const { semanticColors: sc } = useTheme();
  const colors = useMemo(() => ({
    background: sc.bgPrimary, surface: sc.bgPrimary, primary: sc.accent,
    textPrimary: sc.textPrimary, textMuted: sc.textMuted, textOnPrimary: sc.textOnAccent,
    border: sc.border, success: sc.textMuted, error: sc.textMuted,
  }), [sc]);
  const { fontScale } = useWindowDimensions();
  const styles = useMemo(() => makeStyles(colors, fontScale), [colors, fontScale]);
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const queryClient = useQueryClient();

  const [newItemName, setNewItemName] = useState('');
  const [newItemQty, setNewItemQty] = useState('1');
  const [newItemUnit, setNewItemUnit] = useState('');
  // The list on show: Grocery every time the screen opens (operator R2, every drawn frame), held while it stays mounted.
  const [chosen] = useState<ListType>('grocery');
  const list = LISTS[chosen];

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchOneList,
    staleTime: 60 * 1000,
  });
  const { pulling, onRefresh } = usePullToRefresh(refetch);

  const rows = data ?? [];
  const items = rows.filter(onList(chosen));
  const unchecked = items.filter((i) => !i.is_checked);
  const checked = items.filter((i) => i.is_checked);

  // The list rides with the add, so the row lands on the list chosen at the tap even if the client switches before it is sent.
  const addMutation = useMutation({
    mutationFn: ({ type, ...item }: { type: ListType; name: string; quantity: number; unit?: string }) =>
      listsApi.addItem(type, item),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      setNewItemName('');
      setNewItemQty('1');
      setNewItemUnit('');
      Keyboard.dismiss();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
    onError: (_err, { type }) => Alert.alert(LISTS[type].addFailed, 'Your item is still in the form. Check your connection and tap Add again.'),
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

  // Clears one list: the one on show when the client confirmed (never the list she cannot see).
  const clearCheckedMutation = useMutation({
    mutationFn: (type: ListType) => listsApi.clearChecked(type),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: (_err, type) => Alert.alert(LISTS[type].clearFailed, LISTS[type].clearLine),
  });

  const handleAdd = useCallback(() => {
    const name = newItemName.trim();
    if (!name) return;
    addMutation.mutate({ type: chosen, name, quantity: parseFloat(newItemQty) || 1, unit: newItemUnit.trim() || undefined });
  }, [newItemName, newItemQty, newItemUnit, chosen, addMutation]);

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
    const type = chosen;
    Alert.alert(
      'Clear checked items?',
      `Remove ${checked.length} checked item${checked.length > 1 ? 's' : ''}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear', style: 'destructive', onPress: () => clearCheckedMutation.mutate(type) },
      ],
    );
  }, [checked.length, chosen, clearCheckedMutation]);

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
    <Screen edges={['top']} scroll={false} {...page} testID="grocery-prep-screen">
      <FlatList
        keyboardShouldPersistTaps="handled"
        testID="list-scroll"
        style={{ backgroundColor: sc.bgPrimary }}
        ListHeaderComponent={(
        <View style={{ backgroundColor: sc.surface.forestBand }}>
      <StyleCMasthead title="Grocery list" onBack={() => navigation.goBack()}>
        {/* The summary on the masthead, as on the Shopping list (ctx#457): one look for both lists. */}
        {!isLoading && !isError && items.length > 0 ? (
          <StyleCDashes total={items.length} done={checked.length} label={unchecked.length > 0 ? `${unchecked.length} to get.` : 'All items checked.'} />
        ) : null}
        {!isLoading && !isError && rows.some(fromShopping) ? <StyleCMastText kind="muted">Includes items from your shopping list.</StyleCMastText> : null}
      </StyleCMasthead>
      <StyleCPaper scrolls style={styles.paper}>

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
      </View>
      </StyleCPaper>
      </View>
      )}

      ListEmptyComponent={isLoading ? (
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>{list.loading}</Text>
          <StyleCLoadingLines lead="ring" rows={5} />
        </View>
      ) : isError ? (
        <View style={styles.errorBlock}>
          <StyleCNotice>{list.failed}</StyleCNotice>
          <PrimaryButton label="Try again" onPress={() => refetch()} disabled={isRefetching} haptic={false} />
        </View>
      ) : items.length === 0 ? (
        <FadeInView>
          <StyleCEmpty
            icon="bag-outline"
            title={list.empty}
            subtitle="Add items using the field above."
          />
        </FadeInView>
      ) : null}
          data={isLoading || isError ? [] : listData}
          keyExtractor={(item) =>
            'type' in item ? `header-${item.label}` : item.id
          }
          refreshControl={
            <RefreshControl
              testID="list-refresh"
              refreshing={pulling}
              onRefresh={onRefresh}
              enabled={!isLoading && !isError && items.length > 0}
              tintColor={colors.primary}
            />
          }
          contentContainerStyle={styles.listContent}
          ListFooterComponent={!isLoading && !isError && checked.length > 0 ? (
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
    </Screen>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
// A field grows and shrinks with the system text size but is never under the 44 pt target.
const fieldSize = (size: number, fontScale: number) => Math.max(layout.touchMin, size * fontScale);
// Inter's normal line box is 1.21em. Fill the space above it so the text keeps the drawing's 10 pt bottom baseline.
const fieldPaddingTop = (textSize: number, fontScale: number) => Math.max(0, fieldSize(48, fontScale) - textSize * 1.21 * fontScale - 10);

// ctx#457 .fld.sm underline #B9B2A7: stone at 0.9 over the paper is #B8B0A8.
const smallFieldLine = withAlpha(palette.stone, 0.9);

const makeStyles = (colors: Pick<ThemeColors, 'background' | 'surface' | 'primary' | 'textPrimary' | 'textMuted' | 'textOnPrimary' | 'border' | 'error'>, fontScale = 1) =>
  StyleSheet.create({
  // Screen owns the inset top (forest via useStyleCScreen); the masthead and paper are Style C; the paper holds the list.
  paper: { paddingTop: 22 },
  // TextLink keeps 4 pt each side inside its 44 pt target; 20 + 4 puts the words on the 24 pt gutter (ctx#457 .clear).
  clearBtn: { marginLeft: 20, marginRight: 24, paddingVertical: 16 },

  addRow: { paddingHorizontal: 24, marginBottom: 0 },
  // Underlined fields (C_grocery, ctx#457), not boxes: the name on its own line, then Qty, Unit and the round add.
  addInputs: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', columnGap: 14, rowGap: 14 },
  nameInput: {
    fontFamily: typography.body.fontFamily,
    flexBasis: '100%',
    width: '100%',
    height: fieldSize(48, fontScale),
    paddingTop: fieldPaddingTop(18, fontScale),
    paddingBottom: 10,
    textAlignVertical: 'bottom',
    borderBottomWidth: 1.5,
    borderColor: colors.textPrimary,
    fontSize: 18,
    color: colors.textPrimary,
  },
  qtyInput: {
    fontFamily: typography.body.fontFamily,
    width: fieldSize(52, fontScale),
    height: fieldSize(48, fontScale),
    paddingTop: fieldPaddingTop(16, fontScale),
    paddingBottom: 10,
    textAlignVertical: 'bottom',
    borderBottomWidth: 1.5,
    borderColor: smallFieldLine,
    paddingHorizontal: 0,
    fontSize: 16,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  unitInput: {
    fontFamily: typography.body.fontFamily,
    width: fieldSize(70, fontScale),
    height: fieldSize(48, fontScale),
    paddingTop: fieldPaddingTop(16, fontScale),
    paddingBottom: 10,
    textAlignVertical: 'bottom',
    borderBottomWidth: 1.5,
    borderColor: smallFieldLine,
    paddingHorizontal: 0,
    fontSize: 16,
    color: colors.textPrimary,
  },
  addBtn: {
    width: 44,
    height: 44,
    marginBottom: 2,
    backgroundColor: colors.primary,
    borderRadius: radius.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnDisabled: { opacity: 0.42 },

  loadingContainer: { paddingHorizontal: 24, paddingTop: 26, gap: 4 },
  // The drawn error state (ctx#457 shopping-error): Try again 16 pt under the notice.
  errorBlock: { paddingHorizontal: 24, paddingTop: 26, gap: 16 },
  loadingText: { ...typography.bodySmall, lineHeight: 20.3, color: colors.textMuted },

  listContent: { flexGrow: 1, paddingBottom: 48 },

  sectionHeader: {
    marginHorizontal: 24,
    paddingTop: 26,
    paddingBottom: 0,
  },
  sectionHeaderText: { ...typography.eyebrow, fontFamily: 'Inter_600SemiBold', fontWeight: '600', fontSize: 11.5, lineHeight: 14, letterSpacing: 2, color: colors.textMuted, fontVariant: ['tabular-nums'] },

  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    // A hairline row, not a boxed card (CATALOG: hairline sections).
    minHeight: 64 * fontScale,
    paddingVertical: 0,
    paddingHorizontal: 0,
    marginHorizontal: 24,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    gap: 6,
  },
  itemRowChecked: { opacity: 1 },
  // ctx#457: the ring at the left edge, the serif name, the amount at the right on one line, the cross at the edge. The
  // name keeps at least half the row so a word never breaks mid-word; when the amount does not fit beside it (narrow
  // phones at large text) the amount moves under the name, still at the right, whole.
  // The ring's 44 pt target reaches 2 pt into the gutter; the cross's ends at it (ctx#457 .chk, .rm), so both sit at the content edges.
  checkbox: { width: 44, height: 44, marginLeft: -2, alignItems: 'flex-start', justifyContent: 'center' },
  itemContent: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 12 },
  itemName: { ...typography.h3, fontSize: 21, lineHeight: 26.25, letterSpacing: 0, paddingVertical: 10, color: colors.textPrimary, flexGrow: 1, flexShrink: 1, flexBasis: 'auto', minWidth: '50%' },
  itemNameChecked: { textDecorationLine: 'line-through', color: colors.textMuted },
  itemMeta: { fontFamily: typography.body.fontFamily, fontSize: 15, letterSpacing: 0, color: colors.textMuted, fontVariant: ['tabular-nums'], textAlign: 'right', flexShrink: 0, marginLeft: 'auto' },
  // ctx#457 .rm: the 44 pt box ends at the gutter with the cross at its right edge, so the amount ends 50 pt in.
  deleteBtn: { width: 44, height: 44, alignItems: 'flex-end', justifyContent: 'center' },

  });

/** The same rows and fields on the Shopping list (one look for both lists). */
export const makeListStyles = makeStyles;
