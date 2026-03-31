import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated,
  Image,
  Modal,
  Platform,
  SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { Shadow } from '../../constants/theme';
import GroceryListScreen from './GroceryListScreen';
import PrepGuideScreen from './PrepGuideScreen';
import FadeInView from '../../components/FadeInView';

// ── Meal Pools ─────────────────────────────────────────────────────────────

interface MealOption {
  name: string;
  desc: string;
  cal: number;
  p: number;
  c: number;
  f: number;
  img: string;
}

const BREAKFAST_POOL: MealOption[] = [
  { name: 'Greek Yogurt Parfait', desc: 'Greek yogurt, granola, mixed berries', cal: 380, p: 28, c: 42, f: 9, img: 'https://images.unsplash.com/photo-1488477181946-6428a0291777?w=160&h=160&fit=crop' },
  { name: 'Overnight Oats', desc: 'Oats, almond milk, chia seeds, banana', cal: 420, p: 18, c: 68, f: 10, img: 'https://images.unsplash.com/photo-1484723091739-30a097e8f929?w=160&h=160&fit=crop' },
  { name: 'Egg White Scramble', desc: 'Egg whites, spinach, peppers, feta', cal: 290, p: 35, c: 12, f: 8, img: 'https://images.unsplash.com/photo-1525351484163-7529414344d8?w=160&h=160&fit=crop' },
  { name: 'Protein Smoothie Bowl', desc: 'Protein powder, frozen acai, banana, toppings', cal: 450, p: 32, c: 58, f: 11, img: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=160&h=160&fit=crop' },
  { name: 'Turkey & Veggie Frittata', desc: 'Ground turkey, zucchini, eggs, herbs', cal: 360, p: 38, c: 8, f: 18, img: 'https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=160&h=160&fit=crop' },
  { name: 'Avocado Toast + Eggs', desc: 'Sourdough, avocado, poached eggs, red pepper flakes', cal: 430, p: 22, c: 44, f: 20, img: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=160&h=160&fit=crop' },
  { name: 'Cottage Cheese Bowl', desc: 'Low-fat cottage cheese, pineapple, chia seeds', cal: 310, p: 30, c: 32, f: 7, img: 'https://images.unsplash.com/photo-1567306226416-28f0efdc88ce?w=160&h=160&fit=crop' },
  { name: 'Whole Grain Waffles', desc: 'Protein waffles, almond butter, strawberries', cal: 480, p: 28, c: 55, f: 16, img: 'https://images.unsplash.com/photo-1562376552-0d160a2f238d?w=160&h=160&fit=crop' },
  { name: 'Breakfast Burrito', desc: 'Whole wheat tortilla, eggs, black beans, salsa', cal: 520, p: 32, c: 58, f: 16, img: 'https://images.unsplash.com/photo-1626700051175-6818013e1d4f?w=160&h=160&fit=crop' },
  { name: 'Quinoa Breakfast Bowl', desc: 'Quinoa, almond milk, cinnamon, apple, walnuts', cal: 400, p: 14, c: 65, f: 12, img: 'https://images.unsplash.com/photo-1490645935967-10de6ba17061?w=160&h=160&fit=crop' },
  { name: 'Tuna Salad Toast', desc: 'Tuna, Greek yogurt, celery, whole grain toast', cal: 340, p: 40, c: 28, f: 8, img: 'https://images.unsplash.com/photo-1571091718767-18b5b1457add?w=160&h=160&fit=crop' },
  { name: 'Banana Protein Pancakes', desc: 'Banana, oats, egg whites, protein powder', cal: 390, p: 34, c: 52, f: 6, img: 'https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445?w=160&h=160&fit=crop' },
  { name: 'Smoked Salmon Plate', desc: 'Smoked salmon, cream cheese, cucumber, capers', cal: 350, p: 30, c: 12, f: 18, img: 'https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?w=160&h=160&fit=crop' },
  { name: 'Steel Cut Oatmeal', desc: 'Steel cut oats, protein powder, blueberries', cal: 410, p: 28, c: 60, f: 8, img: 'https://images.unsplash.com/photo-1517673400267-0251440c45dc?w=160&h=160&fit=crop' },
  { name: 'Egg Muffins Batch', desc: 'Egg, turkey bacon, bell pepper, cheese muffins', cal: 320, p: 36, c: 6, f: 16, img: 'https://images.unsplash.com/photo-1482049016688-2d3e1b311543?w=160&h=160&fit=crop' },
];

const LUNCH_POOL: MealOption[] = [
  { name: 'Chicken Rice Bowl', desc: 'Grilled chicken, brown rice, roasted broccoli', cal: 520, p: 48, c: 55, f: 10, img: 'https://images.unsplash.com/photo-1512058564366-18510be2db19?w=160&h=160&fit=crop' },
  { name: 'Turkey Lettuce Wraps', desc: 'Ground turkey, hoisin, water chestnuts, lettuce cups', cal: 380, p: 40, c: 22, f: 12, img: 'https://images.unsplash.com/photo-1529193591184-b1d58069ecdd?w=160&h=160&fit=crop' },
  { name: 'Mediterranean Salad', desc: 'Chickpeas, cucumber, tomatoes, feta, olives', cal: 440, p: 18, c: 46, f: 20, img: 'https://images.unsplash.com/photo-1540420773420-3366772f4999?w=160&h=160&fit=crop' },
  { name: 'Tuna Quinoa Bowl', desc: 'Tuna, quinoa, avocado, cherry tomatoes', cal: 490, p: 46, c: 42, f: 16, img: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=160&h=160&fit=crop' },
  { name: 'Beef & Veggie Stir-fry', desc: 'Lean beef, bok choy, carrots, brown rice', cal: 550, p: 44, c: 52, f: 14, img: 'https://images.unsplash.com/photo-1603133872878-684f208fb84b?w=160&h=160&fit=crop' },
  { name: 'Lentil Soup', desc: 'Red lentils, cumin, tomatoes, spinach', cal: 380, p: 22, c: 58, f: 6, img: 'https://images.unsplash.com/photo-1547592180-85f173990554?w=160&h=160&fit=crop' },
  { name: 'Grilled Salmon Bowl', desc: 'Salmon, wild rice, edamame, sesame ginger', cal: 560, p: 48, c: 44, f: 18, img: 'https://images.unsplash.com/photo-1467003909585-2f8a72700288?w=160&h=160&fit=crop' },
  { name: 'Black Bean Tacos', desc: 'Black beans, slaw, avocado, corn tortillas', cal: 480, p: 20, c: 62, f: 16, img: 'https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=160&h=160&fit=crop' },
  { name: 'Egg Salad Sandwich', desc: 'Eggs, Greek yogurt, whole grain bread, greens', cal: 420, p: 28, c: 38, f: 16, img: 'https://images.unsplash.com/photo-1528736235302-52922df5c122?w=160&h=160&fit=crop' },
  { name: 'Chicken Fajita Bowl', desc: 'Chicken breast, peppers, onions, farro', cal: 530, p: 50, c: 48, f: 12, img: 'https://images.unsplash.com/photo-1576021182211-9ea8dced3690?w=160&h=160&fit=crop' },
  { name: 'Greek Chicken Wrap', desc: 'Chicken, tzatziki, romaine, tomato, pita', cal: 490, p: 42, c: 48, f: 14, img: 'https://images.unsplash.com/photo-1621996346565-e3dbc646d9a9?w=160&h=160&fit=crop' },
  { name: 'Shrimp Cauliflower Rice', desc: 'Shrimp, cauliflower rice, lime, cilantro, avocado', cal: 360, p: 38, c: 18, f: 14, img: 'https://images.unsplash.com/photo-1559847844-5315695dadae?w=160&h=160&fit=crop' },
  { name: 'Meal Prep Chili', desc: 'Lean beef, kidney beans, tomatoes, spices', cal: 500, p: 42, c: 50, f: 10, img: 'https://images.unsplash.com/photo-1548550023-2bdb3c5beed7?w=160&h=160&fit=crop' },
  { name: 'Veggie Buddha Bowl', desc: 'Roasted veggies, hummus, quinoa, tahini drizzle', cal: 460, p: 16, c: 64, f: 18, img: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=160&h=160&fit=crop' },
  { name: 'Turkey Club Sandwich', desc: 'Turkey breast, avocado, tomato, whole grain', cal: 510, p: 44, c: 42, f: 18, img: 'https://images.unsplash.com/photo-1571091718767-18b5b1457add?w=160&h=160&fit=crop' },
];

const DINNER_POOL: MealOption[] = [
  { name: 'Baked Salmon + Asparagus', desc: 'Atlantic salmon, roasted asparagus, lemon', cal: 480, p: 46, c: 14, f: 24, img: 'https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?w=160&h=160&fit=crop' },
  { name: 'Chicken Stir-fry', desc: 'Chicken breast, mixed vegetables, soy-ginger sauce', cal: 520, p: 48, c: 46, f: 12, img: 'https://images.unsplash.com/photo-1603133872878-684f208fb84b?w=160&h=160&fit=crop' },
  { name: 'Turkey Meatballs + Zoodles', desc: 'Turkey meatballs, zucchini noodles, marinara', cal: 440, p: 44, c: 22, f: 16, img: 'https://images.unsplash.com/photo-1551183053-bf91798d3e90?w=160&h=160&fit=crop' },
  { name: 'Lean Beef Taco Bowl', desc: 'Ground beef, black beans, brown rice, salsa', cal: 580, p: 46, c: 56, f: 14, img: 'https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=160&h=160&fit=crop' },
  { name: 'Shrimp Fried Rice', desc: 'Shrimp, cauliflower rice, eggs, soy sauce, peas', cal: 400, p: 40, c: 32, f: 12, img: 'https://images.unsplash.com/photo-1512058564366-18510be2db19?w=160&h=160&fit=crop' },
  { name: 'Chicken Tikka Masala', desc: 'Chicken, tomato sauce, garam masala, basmati rice', cal: 560, p: 44, c: 62, f: 14, img: 'https://images.unsplash.com/photo-1565557623262-b51c2513a641?w=160&h=160&fit=crop' },
  { name: 'Pork Tenderloin + Quinoa', desc: 'Pork tenderloin, roasted sweet potato, quinoa', cal: 510, p: 48, c: 46, f: 14, img: 'https://images.unsplash.com/photo-1467003909585-2f8a72700288?w=160&h=160&fit=crop' },
  { name: 'Stuffed Bell Peppers', desc: 'Lean beef, brown rice, tomatoes, cheese stuffed peppers', cal: 490, p: 40, c: 44, f: 14, img: 'https://images.unsplash.com/photo-1490645935967-10de6ba17061?w=160&h=160&fit=crop' },
  { name: 'White Fish + Veggies', desc: 'Tilapia, roasted broccoli, cherry tomatoes, lemon', cal: 380, p: 44, c: 18, f: 12, img: 'https://images.unsplash.com/photo-1559847844-5315695dadae?w=160&h=160&fit=crop' },
  { name: 'Slow Cooker Chicken Soup', desc: 'Chicken breast, vegetables, broth, noodles', cal: 420, p: 42, c: 38, f: 8, img: 'https://images.unsplash.com/photo-1547592180-85f173990554?w=160&h=160&fit=crop' },
  { name: 'Lamb Kofta + Tabbouleh', desc: 'Lamb kofta skewers, bulgur wheat tabbouleh', cal: 540, p: 38, c: 44, f: 20, img: 'https://images.unsplash.com/photo-1576021182211-9ea8dced3690?w=160&h=160&fit=crop' },
  { name: 'Tofu Veggie Curry', desc: 'Firm tofu, mixed vegetables, coconut curry, basmati', cal: 480, p: 24, c: 58, f: 18, img: 'https://images.unsplash.com/photo-1604379053956-6c49d5e43afe?w=160&h=160&fit=crop' },
  { name: 'Chicken Caesar Salad', desc: 'Grilled chicken, romaine, parmesan, croutons, light caesar', cal: 450, p: 50, c: 22, f: 18, img: 'https://images.unsplash.com/photo-1546793665-c74683f339c1?w=160&h=160&fit=crop' },
  { name: 'Bison Burger Bowl', desc: 'Bison patty, mixed greens, avocado, sweet potato fries', cal: 580, p: 52, c: 36, f: 22, img: 'https://images.unsplash.com/photo-1565299507177-b0ac66763828?w=160&h=160&fit=crop' },
  { name: 'Egg Fried Quinoa', desc: 'Quinoa, eggs, edamame, soy sauce, sesame oil', cal: 430, p: 28, c: 52, f: 14, img: 'https://images.unsplash.com/photo-1603360946369-dc9bb6258143?w=160&h=160&fit=crop' },
];

// ── Types ─────────────────────────────────────────────────────────────────

type Phase = 'picker' | 'grocery' | 'prep';

interface SelectedMeals {
  breakfast: MealOption | null;
  lunch: MealOption | null;
  dinner: MealOption | null;
}

// ── Meal Card with Swipe Animation ────────────────────────────────────────

interface SwipeMealCardProps {
  label: string;
  icon: string;
  pool: MealOption[];
  accepted: boolean;
  onAccept: (meal: MealOption) => void;
  onNext: () => void;
  currentIndex: number;
}

function SwipeMealCard({ label, icon, pool, accepted, onAccept, onNext, currentIndex }: SwipeMealCardProps) {
  const translateX = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const [localIndex, setLocalIndex] = useState(currentIndex);
  const [isAnimating, setIsAnimating] = useState(false);

  const handleReject = () => {
    if (isAnimating || accepted) return;
    setIsAnimating(true);
    Animated.parallel([
      Animated.timing(translateX, { toValue: -400, duration: 250, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => {
      const nextIdx = localIndex + 1;
      setLocalIndex(nextIdx);
      translateX.setValue(400);
      Animated.parallel([
        Animated.timing(translateX, { toValue: 0, duration: 250, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start(() => {
        setIsAnimating(false);
        onNext();
      });
    });
  };

  const handleAccept = () => {
    if (isAnimating || accepted) return;
    onAccept(pool[localIndex % pool.length]);
  };

  const currentMeal = pool[localIndex % pool.length];

  return (
    <View style={styles.mealRow}>
      {/* Meal Type Label */}
      <View style={styles.mealLabel}>
        <Text style={styles.mealLabelIcon}>{icon}</Text>
        <Text style={styles.mealLabelText}>{label}</Text>
      </View>

      {/* Card */}
      <Animated.View style={[styles.mealCard, { transform: [{ translateX }], opacity }, accepted && styles.mealCardAccepted]}>
        <Image source={{ uri: currentMeal.img }} style={styles.mealThumb} />
        <View style={styles.mealInfo}>
          <Text style={styles.mealName} numberOfLines={1}>{currentMeal.name}</Text>
          <Text style={styles.mealDesc} numberOfLines={2}>{currentMeal.desc}</Text>
          {/* Macro Pills */}
          <View style={styles.macroPills}>
            <View style={[styles.macroPill, { backgroundColor: '#FFF3E0' }]}>
              <Text style={[styles.macroPillText, { color: '#E65100' }]}>{currentMeal.cal} kcal</Text>
            </View>
            <View style={[styles.macroPill, { backgroundColor: Colors.primaryPale }]}>
              <Text style={[styles.macroPillText, { color: Colors.primary }]}>P {currentMeal.p}g</Text>
            </View>
            <View style={[styles.macroPill, { backgroundColor: '#E3F2FD' }]}>
              <Text style={[styles.macroPillText, { color: '#1565C0' }]}>C {currentMeal.c}g</Text>
            </View>
            <View style={[styles.macroPill, { backgroundColor: '#FFF9C4' }]}>
              <Text style={[styles.macroPillText, { color: '#F57F17' }]}>F {currentMeal.f}g</Text>
            </View>
          </View>
        </View>
        {/* Action Buttons or Accepted Overlay */}
        {accepted ? (
          <View style={styles.acceptedOverlay}>
            <Ionicons name="checkmark-circle" size={32} color="#2D6A4F" />
          </View>
        ) : (
          <View style={styles.actionBtns}>
            <TouchableOpacity style={styles.rejectBtn} onPress={handleReject}>
              <Ionicons name="close" size={22} color="#E63946" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.acceptBtn} onPress={handleAccept}>
              <Ionicons name="checkmark" size={22} color="#2D6A4F" />
            </TouchableOpacity>
          </View>
        )}
      </Animated.View>
    </View>
  );
}

// ── Main PlanScreen ───────────────────────────────────────────────────────

export default function PlanScreen() {
  const [phase, setPhase] = useState<Phase>('picker');
  const [selected, setSelected] = useState<SelectedMeals>({ breakfast: null, lunch: null, dinner: null });
  const [bIdx, setBIdx] = useState(0);
  const [lIdx, setLIdx] = useState(5);
  const [dIdx, setDIdx] = useState(10);
  const [weeklyModalVisible, setWeeklyModalVisible] = useState(false);

  const allAccepted = selected.breakfast && selected.lunch && selected.dinner;

  const totalCal = [selected.breakfast, selected.lunch, selected.dinner].reduce((s, m) => s + (m?.cal || 0), 0);
  const totalP = [selected.breakfast, selected.lunch, selected.dinner].reduce((s, m) => s + (m?.p || 0), 0);
  const totalC = [selected.breakfast, selected.lunch, selected.dinner].reduce((s, m) => s + (m?.c || 0), 0);
  const totalF = [selected.breakfast, selected.lunch, selected.dinner].reduce((s, m) => s + (m?.f || 0), 0);

  if (phase === 'grocery') {
    return (
      <GroceryListScreen
        embedded
        onContinue={() => setPhase('prep')}
      />
    );
  }

  if (phase === 'prep') {
    return (
      <PrepGuideScreen
        embedded
        onDone={() => setPhase('picker')}
      />
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <FadeInView>
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Today's Meals</Text>
              <Text style={styles.subtitle}>Tap ✓ to accept or ✗ to see next option</Text>
            </View>
            <TouchableOpacity style={styles.weeklyBtn} onPress={() => setWeeklyModalVisible(true)}>
              <Ionicons name="calendar-outline" size={18} color={Colors.primary} />
              <Text style={styles.weeklyBtnText}>Weekly</Text>
            </TouchableOpacity>
          </View>
        </FadeInView>

        {/* Meal Cards */}
        <View style={styles.mealSection}>
          <SwipeMealCard
            label="Breakfast"
            icon="🌅"
            pool={BREAKFAST_POOL}
            accepted={!!selected.breakfast}
            onAccept={(m) => setSelected((s) => ({ ...s, breakfast: m }))}
            onNext={() => setBIdx((i) => i + 1)}
            currentIndex={bIdx}
          />
          <SwipeMealCard
            label="Lunch"
            icon="☀️"
            pool={LUNCH_POOL}
            accepted={!!selected.lunch}
            onAccept={(m) => setSelected((s) => ({ ...s, lunch: m }))}
            onNext={() => setLIdx((i) => i + 1)}
            currentIndex={lIdx}
          />
          <SwipeMealCard
            label="Dinner"
            icon="🌙"
            pool={DINNER_POOL}
            accepted={!!selected.dinner}
            onAccept={(m) => setSelected((s) => ({ ...s, dinner: m }))}
            onNext={() => setDIdx((i) => i + 1)}
            currentIndex={dIdx}
          />
        </View>

        {/* Daily Totals when meals selected */}
        {allAccepted && (
          <FadeInView>
            <View style={styles.totalsCard}>
              <Text style={styles.totalsTitle}>Daily Totals</Text>
              <View style={styles.totalsRow}>
                <View style={styles.totalItem}>
                  <Text style={styles.totalValue}>{totalCal}</Text>
                  <Text style={styles.totalLabel}>Calories</Text>
                </View>
                <View style={styles.totalDivider} />
                <View style={styles.totalItem}>
                  <Text style={[styles.totalValue, { color: Colors.primary }]}>{totalP}g</Text>
                  <Text style={styles.totalLabel}>Protein</Text>
                </View>
                <View style={styles.totalDivider} />
                <View style={styles.totalItem}>
                  <Text style={[styles.totalValue, { color: Colors.carbs }]}>{totalC}g</Text>
                  <Text style={styles.totalLabel}>Carbs</Text>
                </View>
                <View style={styles.totalDivider} />
                <View style={styles.totalItem}>
                  <Text style={[styles.totalValue, { color: Colors.fat }]}>{totalF}g</Text>
                  <Text style={styles.totalLabel}>Fat</Text>
                </View>
              </View>
            </View>

            {/* Build Grocery List CTA */}
            <TouchableOpacity
              style={styles.groceryBtn}
              onPress={() => setPhase('grocery')}
              activeOpacity={0.85}
            >
              <Ionicons name="basket-outline" size={22} color="#FFFFFF" />
              <Text style={styles.groceryBtnText}>Build Grocery List →</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.resetBtn}
              onPress={() => setSelected({ breakfast: null, lunch: null, dinner: null })}
            >
              <Text style={styles.resetBtnText}>Start Over</Text>
            </TouchableOpacity>
          </FadeInView>
        )}
      </ScrollView>

      {/* Weekly Plan Modal */}
      <Modal visible={weeklyModalVisible} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modalSafe}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Weekly Plan</Text>
            <TouchableOpacity onPress={() => setWeeklyModalVisible(false)}>
              <Ionicons name="close" size={24} color={Colors.textPrimary} />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.modalContent}>
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, idx) => (
              <View key={day} style={styles.weekDayCard}>
                <Text style={styles.weekDayLabel}>{day}</Text>
                <View style={styles.weekDayMeals}>
                  {['🌅 ' + BREAKFAST_POOL[(idx * 3) % BREAKFAST_POOL.length].name,
                    '☀️ ' + LUNCH_POOL[(idx * 3 + 1) % LUNCH_POOL.length].name,
                    '🌙 ' + DINNER_POOL[(idx * 3 + 2) % DINNER_POOL.length].name,
                  ].map((meal, mi) => (
                    <Text key={mi} style={styles.weekDayMeal} numberOfLines={1}>{meal}</Text>
                  ))}
                </View>
              </View>
            ))}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 24,
    paddingTop: Platform.OS === 'android' ? 50 : 20,
    paddingBottom: 16,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: Colors.textPrimary,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 13,
    color: Colors.textMuted,
    marginTop: 4,
  },
  weeklyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.primaryPale,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    marginTop: 4,
  },
  weeklyBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.primary,
  },
  mealSection: {
    paddingHorizontal: 20,
    gap: 16,
    marginTop: 8,
  },
  mealRow: {
    gap: 8,
  },
  mealLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 4,
  },
  mealLabelIcon: {
    fontSize: 16,
  },
  mealLabelText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  mealCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    gap: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadow.small,
  },
  mealCardAccepted: {
    borderColor: Colors.primary,
    borderWidth: 2,
    backgroundColor: '#F0FAF4',
  },
  mealThumb: {
    width: 80,
    height: 80,
    borderRadius: 12,
    backgroundColor: Colors.surfaceElevated,
  },
  mealInfo: {
    flex: 1,
    gap: 4,
  },
  mealName: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  mealDesc: {
    fontSize: 12,
    color: Colors.textMuted,
    lineHeight: 16,
  },
  macroPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 4,
  },
  macroPill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
  },
  macroPillText: {
    fontSize: 10,
    fontWeight: '700',
  },
  actionBtns: {
    gap: 8,
  },
  rejectBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFEBEC',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#E63946',
  },
  acceptBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.primaryPale,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: Colors.primary,
  },
  acceptedOverlay: {
    width: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  totalsCard: {
    marginHorizontal: 20,
    marginTop: 24,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadow.small,
  },
  totalsTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 16,
    textAlign: 'center',
  },
  totalsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  totalItem: {
    flex: 1,
    alignItems: 'center',
  },
  totalValue: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  totalLabel: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 2,
    fontWeight: '600',
  },
  totalDivider: {
    width: 1,
    height: 36,
    backgroundColor: Colors.border,
  },
  groceryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: Colors.primary,
    marginHorizontal: 20,
    marginTop: 16,
    paddingVertical: 18,
    borderRadius: 16,
  },
  groceryBtnText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  resetBtn: {
    alignItems: 'center',
    marginTop: 12,
    paddingVertical: 8,
  },
  resetBtnText: {
    fontSize: 14,
    color: Colors.textMuted,
    fontWeight: '600',
  },
  // Modal
  modalSafe: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  modalContent: {
    padding: 20,
    gap: 12,
  },
  weekDayCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadow.small,
  },
  weekDayLabel: {
    fontSize: 16,
    fontWeight: '800',
    color: Colors.primary,
    width: 34,
    marginTop: 2,
  },
  weekDayMeals: {
    flex: 1,
    gap: 4,
  },
  weekDayMeal: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 20,
  },
});
