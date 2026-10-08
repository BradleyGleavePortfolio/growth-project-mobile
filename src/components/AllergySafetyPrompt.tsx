/**
 * AllergySafetyPrompt — one-time bottom sheet that asks newly-onboarded
 * lean users about food restrictions BEFORE they browse recipes.
 *
 * Why this exists
 * ───────────────
 * Wave 5's lean onboarding dropped the legacy 10-step flow's
 * `restrictions` chip set. This prompt asks for it again and saves it to
 * `profile.diet_restrictions` (backend `dietary_restrictions`).
 *
 * ALLERGY-M-130: what the copy says about hiding follows `rule` (the caller
 * reads GET /recipes/allergens, src/lib/recipeAllergens.ts). 'on': the server
 * hides shared recipes whose author declared one of the saved allergens, so
 * the copy says so and that undeclared recipes still show. 'off' (a backend
 * without the rule, ALLERGY-128): recipes are not filtered. 'unknown': no
 * claim either way. Every state tells the client to check each recipe's
 * ingredients.
 *
 * Trigger conditions (managed by the caller — useAllergySafetyPrompt):
 *   - User completed the lean flow (lean_onboarding_done === 'true')
 *   - profile.diet_restrictions is NOT an array (i.e. unanswered)
 *   - We have not yet shown the prompt this session/install
 *     (allergy_prompt_shown !== 'true')
 *
 * Once the user dismisses the prompt with EITHER an explicit answer or
 * "Set this up later", we set `allergy_prompt_shown=true` so we never
 * re-prompt. Repeated prompts are nagging; users can always update their
 * restrictions from Edit Profile.
 */
import React from 'react';
import { Modal, View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { colors, typography, spacing, radius } from '../theme/tokens';
import type { RecipeAllergenRule } from '../lib/recipeAllergens';

const LEDE: Record<RecipeAllergenRule, string> = {
  on:
    'This is saved to your profile. Recipes that list an allergen you choose are hidden. ' +
    'Vegetarian, Vegan and Pescatarian are saved but do not hide recipes. Recipes without declared ' +
    "allergens still show, so check each recipe's ingredients before you cook. Choose None if you have no restrictions.",
  off:
    "This is saved to your profile. Recipes are not filtered by it, so check each recipe's ingredients " +
    'before you cook. Choose None if you have no restrictions.',
  unknown:
    "This is saved to your profile. Check each recipe's ingredients before you cook. Choose None if you have no restrictions.",
};

// Each label is saved as typed; the backend (src/recipes/allergens.ts) maps the allergy ones to
// its allergen codes. Soy, Sesame and Fish are the allergen names it maps (ALLERGY-CHOICES-131).
const RESTRICTION_OPTIONS = [
  'None',
  'Nut Allergy',
  'Peanut Allergy',
  'Shellfish Allergy',
  'Egg Allergy',
  'Dairy Allergy',
  'Soy',
  'Sesame',
  'Fish',
  'Gluten-Free',
  'Vegetarian',
  'Vegan',
  'Pescatarian',
];

interface Props {
  visible: boolean;
  onDismiss: () => void;
  /** Called with the chosen restrictions array (possibly empty if user picked "None"). */
  onSubmit: (restrictions: string[]) => Promise<void> | void;
  /** Called when the user chooses "Set this up later" without selecting. */
  onLater: () => Promise<void> | void;
  /** Whether the server hides recipes by saved allergens; absent = 'off' (the copy before the rule). */
  rule?: RecipeAllergenRule;
}

export default function AllergySafetyPrompt({
  visible,
  onDismiss,
  onSubmit,
  onLater,
  rule = 'off',
}: Props) {
  const [selected, setSelected] = React.useState<string[]>([]);
  const [submitting, setSubmitting] = React.useState(false);

  const toggle = (label: string) => {
    setSelected((prev) => {
      if (label === 'None') {
        // None is mutually exclusive with everything else.
        return prev.includes('None') ? [] : ['None'];
      }
      const without = prev.filter((x) => x !== 'None');
      return prev.includes(label)
        ? without.filter((x) => x !== label)
        : [...without, label];
    });
  };

  const canSubmit = selected.length > 0;

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      // "None" answer → empty array (the canonical "I have no restrictions").
      const payload = selected.includes('None') ? [] : selected;
      await onSubmit(payload);
    } finally {
      setSubmitting(false);
      onDismiss();
    }
  };

  const handleLater = async () => {
    setSubmitting(true);
    try {
      await onLater();
    } finally {
      setSubmitting(false);
      onDismiss();
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleLater}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <View style={styles.sheet} accessibilityViewIsModal>
          <Text style={styles.eyebrow}>BEFORE YOU BROWSE</Text>
          <Text style={styles.headline}>Anything to avoid?</Text>
          <Text style={styles.lede}>{LEDE[rule]}</Text>

          <ScrollView
            style={styles.chipsScroll}
            contentContainerStyle={styles.chipsContainer}
            showsVerticalScrollIndicator={false}
          >
            {RESTRICTION_OPTIONS.map((label) => {
              const isSelected = selected.includes(label);
              return (
                <Pressable
                  key={label}
                  onPress={() => toggle(label)}
                  style={[styles.chip, isSelected ? styles.chipSelected : null]}
                  accessibilityRole="button"
                  accessibilityLabel={label}
                  accessibilityState={{ selected: isSelected }}
                >
                  <Text
                    style={[
                      styles.chipLabel,
                      isSelected ? styles.chipLabelSelected : null,
                    ]}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <Pressable
            onPress={handleSubmit}
            disabled={!canSubmit || submitting}
            style={[
              styles.primaryBtn,
              (!canSubmit || submitting) && styles.primaryBtnDisabled,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Save restrictions"
            accessibilityState={{ disabled: !canSubmit || submitting }}
          >
            <Text style={styles.primaryBtnText}>SAVE</Text>
          </Pressable>

          <Pressable
            onPress={handleLater}
            disabled={submitting}
            style={styles.laterBtn}
            accessibilityRole="button"
            accessibilityLabel="Set this up later"
          >
            <Text style={styles.laterText}>Set this up later</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(26, 26, 24, 0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.bone,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 32,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    maxHeight: '80%',
  },
  eyebrow: {
    ...typography.eyebrow,
    color: colors.charcoal,
    marginBottom: 6,
  },
  headline: {
    ...typography.h2,
    color: colors.ink,
    marginBottom: 8,
  },
  lede: {
    ...typography.body,
    color: colors.charcoal,
    marginBottom: spacing.lg,
  },
  chipsScroll: {
    marginBottom: spacing.lg,
  },
  chipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 0.5,
    borderColor: colors.stone,
    borderRadius: radius.lg,
    backgroundColor: colors.cream,
  },
  chipSelected: {
    borderColor: colors.forest,
    borderWidth: 1,
  },
  chipLabel: {
    ...typography.bodySmall,
    color: colors.charcoal,
    fontWeight: '500' as const,
  },
  chipLabelSelected: {
    color: colors.forest,
  },
  primaryBtn: {
    backgroundColor: colors.ink,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 4,
  },
  primaryBtnDisabled: {
    opacity: 0.4,
  },
  primaryBtnText: {
    ...typography.eyebrow,
    color: colors.bone,
  },
  laterBtn: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  laterText: {
    ...typography.bodySmall,
    color: colors.stone,
  },
});
