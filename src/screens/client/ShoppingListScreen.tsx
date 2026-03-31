import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  SectionList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { Colors } from '../../constants/colors';
import { ShoppingItem } from '../../types';
import {
  getShoppingList,
  saveShoppingList,
  generateShoppingListFromPlan,
} from '../../db/shoppingListDb';
import { addDays, getTodayString, generateId } from '../../utils/date';

function getWeekStart(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().split('T')[0];
}

function formatWeekRange(weekStart: string): string {
  const start = new Date(weekStart + 'T00:00:00');
  const end = new Date(addDays(weekStart, 6) + 'T00:00:00');
  const sMonth = start.toLocaleDateString('en-US', { month: 'short' });
  const eMonth = end.toLocaleDateString('en-US', { month: 'short' });
  if (sMonth === eMonth) {
    return `${sMonth} ${start.getDate()} – ${end.getDate()}`;
  }
  return `${sMonth} ${start.getDate()} – ${eMonth} ${end.getDate()}`;
}

export default function ShoppingListScreen({ onBack }: { onBack?: () => void } = {}) {
  const currentUser = useCurrentUser();
  const [weekStart, setWeekStart] = useState(() => getWeekStart(getTodayString()));
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [addMode, setAddMode] = useState(false);
  const [newItemName, setNewItemName] = useState('');

  useEffect(() => {
    loadList();
  }, [weekStart, currentUser?.id]);

  const loadList = async () => {
    if (!currentUser) return;
    setIsLoading(true);
    const list = await getShoppingList(currentUser.id, weekStart);
    setItems(list);
    setIsLoading(false);
  };

  const changeWeek = (direction: number) => {
    setWeekStart(addDays(weekStart, direction * 7));
  };

  const handleGenerate = async () => {
    if (!currentUser) return;
    if (items.length > 0) {
      Alert.alert(
        'Replace List?',
        'This will replace your current shopping list with items from your meal plan.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Generate',
            onPress: async () => {
              setIsLoading(true);
              const generated = await generateShoppingListFromPlan(currentUser.id, weekStart);
              setItems(generated);
              setIsLoading(false);
            },
          },
        ]
      );
    } else {
      setIsLoading(true);
      const generated = await generateShoppingListFromPlan(currentUser.id, weekStart);
      setItems(generated);
      setIsLoading(false);
    }
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

  const checkedCount = items.filter((i) => i.checked).length;

  const sections = React.useMemo(() => {
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
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            {onBack && (
              <TouchableOpacity onPress={onBack}>
                <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
              </TouchableOpacity>
            )}
            <Text style={styles.title}>Shopping List</Text>
          </View>
        </View>
        {items.length > 0 && (
          <Text style={styles.subtitle}>
            {checkedCount}/{items.length} items
          </Text>
        )}
      </View>

      <View style={styles.weekSelector}>
        <TouchableOpacity
          onPress={() => changeWeek(-1)}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="chevron-back" size={22} color={Colors.textSecondary} />
        </TouchableOpacity>
        <Text style={styles.weekText}>{formatWeekRange(weekStart)}</Text>
        <TouchableOpacity
          onPress={() => changeWeek(1)}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="chevron-forward" size={22} color={Colors.textSecondary} />
        </TouchableOpacity>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity style={styles.generateBtn} onPress={handleGenerate}>
          <Ionicons name="sparkles" size={16} color="#fff" />
          <Text style={styles.generateBtnText}>Generate from Plan</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.addBtn}
          onPress={() => setAddMode(!addMode)}
        >
          <Ionicons name={addMode ? 'close' : 'add'} size={20} color={Colors.primary} />
        </TouchableOpacity>
      </View>

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
            <Ionicons name="checkmark" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
      )}

      {items.length === 0 && !isLoading ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="cart-outline" size={48} color={Colors.textMuted} />
          <Text style={styles.emptyText}>No items yet</Text>
          <Text style={styles.emptyHint}>
            Generate a list from your meal plan or add items manually
          </Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          renderSectionHeader={({ section: { title } }) => (
            <View style={styles.sectionHeader}>
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
            >
              <Ionicons
                name={item.checked ? 'checkbox' : 'square-outline'}
                size={22}
                color={item.checked ? Colors.primary : Colors.textMuted}
              />
              <Text
                style={[
                  styles.itemText,
                  item.checked && styles.itemTextChecked,
                ]}
              >
                {item.name}
              </Text>
              {item.quantity && (
                <Text style={styles.itemQty}>{item.quantity}</Text>
              )}
            </TouchableOpacity>
          )}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
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
    paddingHorizontal: 24,
    paddingTop: 60,
    marginBottom: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  subtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginTop: 4,
  },
  weekSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    marginBottom: 16,
  },
  weekText: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
    minWidth: 160,
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    paddingHorizontal: 24,
    gap: 10,
    marginBottom: 12,
  },
  generateBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 12,
  },
  generateBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
  addBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
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
    borderRadius: 12,
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
    borderRadius: 12,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 80,
    gap: 8,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.textMuted,
    marginTop: 8,
  },
  emptyHint: {
    fontSize: 13,
    color: Colors.textMuted,
    textAlign: 'center',
    paddingHorizontal: 40,
  },
  listContent: {
    paddingHorizontal: 24,
    paddingBottom: 100,
  },
  sectionHeader: {
    paddingVertical: 8,
    marginTop: 8,
  },
  sectionHeaderText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
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
});
