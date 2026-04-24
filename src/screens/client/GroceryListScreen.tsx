import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SectionList,
  TouchableOpacity,
  TextInput,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { Colors } from '../../constants/colors';
import { Shadow, Radius } from '../../constants/theme';
import { ShoppingItem } from '../../types';
import {
  getShoppingList,
  saveShoppingList,
  generateShoppingListFromPlan,
} from '../../db/shoppingListDb';
import { getTodayString, generateId } from '../../utils/date';
import FadeInView from '../../components/FadeInView';

function getWeekStart(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().split('T')[0];
}

const CATEGORY_ICONS: Record<string, string> = {
  Protein: 'fish-outline',
  Dairy: 'water-outline',
  'Grains & Legumes': 'leaf-outline',
  Fruits: 'nutrition-outline',
  Vegetables: 'flower-outline',
  Condiments: 'flask-outline',
  'Nuts & Seeds': 'ellipse-outline',
  'Spices & Other': 'color-palette-outline',
  Other: 'cube-outline',
};

interface GroceryListScreenProps {
  onBack?: () => void;
  embedded?: boolean;
  onContinue?: () => void;
}

export default function GroceryListScreen({ onBack, embedded, onContinue }: GroceryListScreenProps) {
  const currentUser = useCurrentUser();
  const [weekStart] = useState(() => getWeekStart(getTodayString()));
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [addMode, setAddMode] = useState(false);
  const [newItemName, setNewItemName] = useState('');

  useEffect(() => {
    loadList();
  }, [currentUser?.id]);

  const loadList = async () => {
    if (!currentUser) return;
    setIsLoading(true);
    const list = await getShoppingList(currentUser.id, weekStart);
    if (list.length === 0) {
      const generated = await generateShoppingListFromPlan(currentUser.id, weekStart);
      setItems(generated);
    } else {
      setItems(list);
    }
    setIsLoading(false);
  };

  const toggleItem = async (id: string) => {
    if (!currentUser) return;
    const updated = items.map((item) =>
      item.id === id ? { ...item, checked: !item.checked } : item
    );
    setItems(updated);
    await saveShoppingList(currentUser.id, weekStart, updated);
  };

  const removeItem = async (id: string) => {
    if (!currentUser) return;
    const updated = items.filter((item) => item.id !== id);
    setItems(updated);
    await saveShoppingList(currentUser.id, weekStart, updated);
  };

  const addItem = async () => {
    if (!currentUser || !newItemName.trim()) return;
    const newItem: ShoppingItem = {
      id: generateId(),
      name: newItemName.trim(),
      category: 'Other',
      checked: false,
    };
    const updated = [...items, newItem];
    setItems(updated);
    await saveShoppingList(currentUser.id, weekStart, updated);
    setNewItemName('');
    setAddMode(false);
  };

  const handleRegenerate = async () => {
    if (!currentUser) return;
    Alert.alert('Regenerate List', 'Replace current list from your meal plan?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Regenerate',
        onPress: async () => {
          setIsLoading(true);
          const generated = await generateShoppingListFromPlan(currentUser.id, weekStart);
          setItems(generated);
          setIsLoading(false);
        },
      },
    ]);
  };

  const checkedCount = items.filter((i) => i.checked).length;
  const totalCount = items.length;
  const progress = totalCount > 0 ? checkedCount / totalCount : 0;

  const sections = useMemo(() => {
    const categoryMap = new Map<string, ShoppingItem[]>();
    for (const item of items) {
      const cat = item.category;
      if (!categoryMap.has(cat)) categoryMap.set(cat, []);
      categoryMap.get(cat)!.push(item);
    }
    return Array.from(categoryMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([title, data]) => ({ title, data }));
  }, [items]);

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerRow}>
          {!embedded && (
            <TouchableOpacity onPress={onBack} style={styles.backBtn}>
              <Ionicons name="arrow-back" size={22} color={Colors.textPrimary} />
            </TouchableOpacity>
          )}
          <View>
            <Text style={styles.title}>Grocery List</Text>
            <Text style={styles.subtitle}>
              {checkedCount}/{totalCount} items checked
            </Text>
          </View>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={handleRegenerate} style={styles.headerIconBtn}>
            <Ionicons name="refresh-outline" size={20} color={Colors.primary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setAddMode(!addMode)} style={styles.headerIconBtn}>
            <Ionicons name={addMode ? 'close' : 'add'} size={20} color={Colors.primary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Progress Bar */}
      <FadeInView>
        <View style={styles.progressContainer}>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
          </View>
          <Text style={styles.progressText}>{Math.round(progress * 100)}% complete</Text>
        </View>
      </FadeInView>

      {/* Add Item */}
      {addMode && (
        <View style={styles.addRow}>
          <TextInput
            style={styles.addInput}
            placeholder="Add item..."
            placeholderTextColor={Colors.textMuted}
            value={newItemName}
            onChangeText={setNewItemName}
            onSubmitEditing={addItem}
            autoFocus
          />
          <TouchableOpacity style={styles.addConfirm} onPress={addItem}>
            <Ionicons name="checkmark" size={20} color={Colors.textOnPrimary} />
          </TouchableOpacity>
        </View>
      )}

      {/* List */}
      {totalCount === 0 && !isLoading ? (
        <View style={styles.emptyState}>
          <Ionicons name="cart-outline" size={48} color={Colors.textMuted} />
          <Text style={styles.emptyTitle}>No items yet</Text>
          <Text style={styles.emptyText}>
            Generate a meal plan first, then your grocery list will be auto-created.
          </Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          renderSectionHeader={({ section: { title } }) => (
            <View style={styles.sectionHeader}>
              <Ionicons
                name={(CATEGORY_ICONS[title] || 'cube-outline') as any}
                size={16}
                color={Colors.primary}
              />
              <Text style={styles.sectionHeaderText}>{title}</Text>
            </View>
          )}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.itemRow}
              onPress={() => toggleItem(item.id)}
              onLongPress={() =>
                Alert.alert('Remove Item', `Remove "${item.name}"?`, [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Remove', style: 'destructive', onPress: () => removeItem(item.id) },
                ])
              }
              activeOpacity={0.7}
            >
              <Ionicons
                name={item.checked ? 'checkbox' : 'square-outline'}
                size={22}
                color={item.checked ? Colors.primary : Colors.textMuted}
              />
              <Text style={[styles.itemText, item.checked && styles.itemTextChecked]}>
                {item.name}
              </Text>
              {item.quantity && <Text style={styles.itemQty}>{item.quantity}</Text>}
            </TouchableOpacity>
          )}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}
      {embedded && onContinue && (
        <View style={styles.continueContainer}>
          <TouchableOpacity style={styles.continueBtn} onPress={onContinue}>
            <Text style={styles.continueBtnText}>Continue to Prep Guide →</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 24,
    paddingTop: 60,
    marginBottom: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  subtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  headerIconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  progressContainer: {
    marginHorizontal: 24,
    marginBottom: 16,
  },
  progressBar: {
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.surfaceElevated,
    overflow: 'hidden',
    marginBottom: 6,
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
    backgroundColor: Colors.primary,
  },
  progressText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  addRow: {
    flexDirection: 'row',
    paddingHorizontal: 24,
    gap: 10,
    marginBottom: 12,
  },
  addInput: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: Colors.textPrimary,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  addConfirm: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 80,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  emptyText: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: 40,
  },
  listContent: {
    paddingHorizontal: 24,
    paddingBottom: 100,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    marginTop: 8,
  },
  sectionHeaderText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    marginBottom: 4,
    ...Shadow.small,
  },
  itemText: {
    flex: 1,
    fontSize: 15,
    color: Colors.textPrimary,
  },
  itemTextChecked: {
    textDecorationLine: 'line-through',
    color: Colors.textMuted,
  },
  itemQty: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: '600',
  },
  continueContainer: {
    padding: 20,
    paddingBottom: 32,
  },
  continueBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  continueBtnText: {
    color: Colors.textOnPrimary,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});
