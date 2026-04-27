import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { OnboardingStackParamList } from '../../navigation/OnboardingNavigator';
import { saveOnboardingData } from '../../utils/onboardingStore';
import OnboardingLayout from '../../components/OnboardingLayout';
import OptionCard from '../../components/OptionCard';
import MultiSelectChip from '../../components/MultiSelectChip';
import { Colors } from '../../constants/colors';

type Props = {
  navigation: NativeStackNavigationProp<OnboardingStackParamList, 'Step6'>;
};

const EATING_HABITS = [
  { value: 'regular', label: 'Regular meals (3/day)' },
  { value: 'skip', label: 'I often skip meals' },
  { value: 'snacker', label: 'Frequent snacker' },
  { value: 'fasting', label: 'Intermittent fasting' },
];

const FOOD_PREFS = ['Chicken', 'Turkey', 'Beef', 'Pork', 'Fish', 'Spicy'];
const RESTRICTIONS = ['No Fish', 'Nut Allergy', 'No Spicy', 'No Beef', 'Vegetarian', 'Vegan'];

export default function OnboardingStep6({ navigation }: Props) {
  const [eatHabits, setEatHabits] = useState<string | null>(null);
  const [foodPrefs, setFoodPrefs] = useState<string[]>([]);
  const [restrictions, setRestrictions] = useState<string[]>([]);

  const togglePref = (pref: string) => {
    setFoodPrefs((prev) =>
      prev.includes(pref) ? prev.filter((p) => p !== pref) : [...prev, pref]
    );
  };

  const toggleRestriction = (r: string) => {
    setRestrictions((prev) =>
      prev.includes(r) ? prev.filter((p) => p !== r) : [...prev, r]
    );
  };

  const handleContinue = async () => {
    if (!eatHabits) return;
    await saveOnboardingData({ eatHabits, foodPrefs, restrictions });
    navigation.navigate('Step7');
  };

  return (
    <OnboardingLayout
      step={6}
      totalSteps={10}
      title="Eating Habits"
      subtitle="Help us understand your current eating patterns"
      onBack={() => navigation.goBack()}
      onContinue={handleContinue}
      continueEnabled={eatHabits !== null}
    >
      <Text style={styles.sectionLabel}>Current eating style</Text>
      {EATING_HABITS.map((opt) => (
        <OptionCard
          key={opt.value}
          label={opt.label}
          selected={eatHabits === opt.value}
          onPress={() => setEatHabits(opt.value)}
        />
      ))}

      <Text style={[styles.sectionLabel, { marginTop: 24 }]}>
        Food preferences
      </Text>
      <View style={styles.chipContainer}>
        {FOOD_PREFS.map((p) => (
          <MultiSelectChip
            key={p}
            label={p}
            selected={foodPrefs.includes(p)}
            onPress={() => togglePref(p)}
          />
        ))}
      </View>

      <Text style={[styles.sectionLabel, { marginTop: 24 }]}>
        Dietary restrictions
      </Text>
      <View style={styles.chipContainer}>
        {RESTRICTIONS.map((r) => (
          <MultiSelectChip
            key={r}
            label={r}
            selected={restrictions.includes(r)}
            onPress={() => toggleRestriction(r)}
          />
        ))}
      </View>
    </OnboardingLayout>
  );
}

const styles = StyleSheet.create({
  sectionLabel: {
    fontSize: 16,
    fontWeight: '500',
    color: Colors.textPrimary,
    marginBottom: 12,
  },
  chipContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
});
