import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { OnboardingStackParamList } from '../../navigation/OnboardingNavigator';
import { useAuthStore } from '../../store/authStore';
import { updateProfile } from '../../db/profileDb';
import OnboardingLayout from '../../components/OnboardingLayout';
import MultiSelectChip from '../../components/MultiSelectChip';
import { Colors } from '../../constants/colors';

type Props = {
  navigation: NativeStackNavigationProp<OnboardingStackParamList, 'Step10'>;
};

const SNACK_OPTIONS = [
  'Protein Bars', 'Trail Mix', 'Greek Yogurt', 'Fruit',
  'Jerky', 'Rice Cakes', 'Peanut Butter', 'Cheese',
  'Veggies & Hummus', 'Smoothies', 'Popcorn', 'Dark Chocolate',
  'Hard Boiled Eggs', 'Cottage Cheese', 'Granola', 'Nuts',
];

export default function OnboardingStep10({ navigation }: Props) {
  const { currentUser } = useAuthStore();
  const [selected, setSelected] = useState<string[]>([]);

  const toggleSnack = (snack: string) => {
    setSelected((prev) =>
      prev.includes(snack) ? prev.filter((s) => s !== snack) : [...prev, snack]
    );
  };

  const handleContinue = async () => {
    if (!currentUser) return;
    await updateProfile(currentUser.id, {
      preferredSnacks: JSON.stringify(selected),
    });
    navigation.navigate('Results');
  };

  return (
    <OnboardingLayout
      step={10}
      totalSteps={10}
      title="Snack Preferences"
      subtitle="Select your go-to snacks (pick as many as you like)"
      onBack={() => navigation.goBack()}
      onContinue={handleContinue}
      continueEnabled={true}
    >
      <View style={styles.chipContainer}>
        {SNACK_OPTIONS.map((snack) => (
          <MultiSelectChip
            key={snack}
            label={snack}
            selected={selected.includes(snack)}
            onPress={() => toggleSnack(snack)}
          />
        ))}
      </View>

      {selected.length > 0 && (
        <Text style={styles.countText}>
          {selected.length} snack{selected.length !== 1 ? 's' : ''} selected
        </Text>
      )}
    </OnboardingLayout>
  );
}

const styles = StyleSheet.create({
  chipContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  countText: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginTop: 16,
  },
});
