/**
 * HomeScreen — Wave 3: Luxury hero rewrite.
 *
 * One thought. Bone background, editorial serif date headline,
 * charcoal progress line, ink "CONTINUE" CTA, hairline rule,
 * 2×2 number grid below the fold.
 *
 * Removed from home: streak banner, calorie ring, macro bar,
 * day selector, community win, trust cue row, identity badge,
 * milestone tiles, weekly volume card, habits section, quick-access grid.
 *
 * The brief: "Home is one thought, not eleven."
 */

import React, { useEffect, useCallback, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  SafeAreaView,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useClientStore } from '../../store/clientStore';
import { track } from '../../lib/analytics';
import { colors, typography } from '../../theme/tokens';

// ─── Date-as-poetry helpers ───────────────────────────────────────────────────

const ORDINAL_WORDS: Record<number, string> = {
  1:  'the first',   2:  'the second', 3:  'the third',   4:  'the fourth',
  5:  'the fifth',   6:  'the sixth',  7:  'the seventh',  8:  'the eighth',
  9:  'the ninth',  10:  'the tenth', 11:  'the eleventh', 12: 'the twelfth',
  13: 'the thirteenth', 14: 'the fourteenth', 15: 'the fifteenth',
  16: 'the sixteenth',  17: 'the seventeenth', 18: 'the eighteenth',
  19: 'the nineteenth', 20: 'the twentieth',   21: 'the twenty-first',
  22: 'the twenty-second', 23: 'the twenty-third', 24: 'the twenty-fourth',
  25: 'the twenty-fifth',  26: 'the twenty-sixth', 27: 'the twenty-seventh',
  28: 'the twenty-eighth', 29: 'the twenty-ninth', 30: 'the thirtieth',
  31: 'the thirty-first',
};

function numberToOrdinalWords(day: number): string {
  return ORDINAL_WORDS[day] ?? `the ${day}th`;
}

function buildDateAsPoetry(date: Date): string {
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(date);
  const day = date.getDate();
  return `${weekday}, ${numberToOrdinalWords(day)}.`;
}

// ─── Progress line ────────────────────────────────────────────────────────────

function buildProgressLine(mealsLogged: number, workoutDone: boolean): string {
  if (mealsLogged === 0 && !workoutDone) return 'A clean slate.';

  const parts: string[] = [];

  if (mealsLogged === 1) parts.push('One meal logged.');
  else if (mealsLogged === 2) parts.push('Two meals logged.');
  else if (mealsLogged === 3) parts.push('Three meals logged.');
  else if (mealsLogged > 3) parts.push(`${mealsLogged} meals logged.`);

  if (workoutDone) {
    parts.push('Workout complete.');
  } else {
    parts.push('One workout to go.');
  }

  return parts.join(' ');
}

// ─── NumberCell ───────────────────────────────────────────────────────────────

interface NumberCellProps {
  label: string;
  value: string;
}

function NumberCell({ label, value }: NumberCellProps) {
  return (
    <View style={{ width: '50%', paddingVertical: 20 }}>
      <Text style={{ ...typography.eyebrow, color: colors.stone, marginBottom: 6 }}>
        {label}
      </Text>
      <Text style={{ ...typography.h2, color: colors.ink }}>
        {value}
      </Text>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const currentUser = useCurrentUser();
  const {
    foodLogs,
    dailyTotals,
    waterOz,
    isLoading,
    loadDayData,
    loadProfile,
  } = useClientStore();

  const navigation = useNavigation<any>();
  const [refreshing, setRefreshing] = useState(false);

  // Stable today date
  const today = new Date();

  // Derive state
  const mealsLogged = (() => {
    const mealTypes = new Set(foodLogs.map((f: any) => f.mealType));
    return mealTypes.size;
  })();

  // Workout: derive from foodLogs length as a proxy — if the user has 0 food logs
  // for the day assume workout not done. In a future pass wire to workout endpoint.
  const workoutDone = false; // conservative default — no workout endpoint on home

  const datePoetry = buildDateAsPoetry(today);
  const progressLine = buildProgressLine(mealsLogged, workoutDone);

  // Water in litres
  const waterL = waterOz > 0 ? `${(waterOz * 0.0295735).toFixed(1)}L` : '0.0L';

  // Macro display values
  const protein = dailyTotals?.protein ? `${Math.round(dailyTotals.protein)}g` : '—';
  const carbs   = dailyTotals?.carbs   ? `${Math.round(dailyTotals.carbs)}g`   : '—';
  const fat     = dailyTotals?.fat     ? `${Math.round(dailyTotals.fat)}g`     : '—';

  useEffect(() => {
    if (currentUser) {
      loadDayData(currentUser.id);
      loadProfile(currentUser.id);
    }
  }, [currentUser?.id]);

  const onRefresh = useCallback(async () => {
    if (!currentUser) return;
    setRefreshing(true);
    await Promise.all([
      loadDayData(currentUser.id),
      loadProfile(currentUser.id),
    ]);
    setRefreshing(false);
  }, [currentUser?.id]);

  const onContinue = () => {
    track('home_continue_tapped', { surface: 'home_hero' });
    // Wire to workout tab — same destination as the old HeroAction log_workout state
    navigation.navigate('WorkoutTab');
  };

  if (!currentUser) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bone }}>
        <ActivityIndicator size="large" color={colors.ink} style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bone }}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 32, paddingTop: 64, paddingBottom: 96 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.ink}
          />
        }
      >
        {/* Hero */}
        <Text style={{ ...typography.eyebrow, color: colors.charcoal, marginBottom: 24 }}>
          THE GROWTH PROJECT
        </Text>
        <Text style={{ ...typography.h1, color: colors.ink, marginBottom: 20 }}>
          {datePoetry}
        </Text>
        <Text style={{ ...typography.body, color: colors.charcoal, marginBottom: 56 }}>
          {progressLine}
        </Text>

        {/* Single CTA */}
        <Pressable
          style={({ pressed }) => ({
            backgroundColor: colors.ink,
            paddingVertical: 20,
            alignItems: 'center',
            opacity: pressed ? 0.85 : 1,
          })}
          onPress={onContinue}
          accessibilityRole="button"
          accessibilityLabel="Continue"
          accessibilityHint="Opens your workout tracker"
        >
          <Text style={{ ...typography.eyebrow, color: colors.bone }}>CONTINUE</Text>
        </Pressable>

        {/* Below-fold rule + 2×2 numbers grid */}
        <View style={{ height: 1, backgroundColor: colors.stone, marginTop: 96, marginBottom: 32 }} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          <NumberCell label="PROTEIN" value={protein} />
          <NumberCell label="CARBS"   value={carbs} />
          <NumberCell label="FAT"     value={fat} />
          <NumberCell label="WATER"   value={waterL} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
