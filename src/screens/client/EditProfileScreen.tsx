/**
 * EditProfileScreen — captures the personalization fields that the backend
 * uses for daily targets and training preferences.
 *
 * Field set is tied to lib/profileCompletion: sex, DOB, target weight, diet
 * preference, weekly workout days, and equipment access. The backend column
 * for equipment access is currently `gym_membership` (yes_regular /
 * yes_occasional / home_gym / no_gym) — UI copy is written so it can later
 * absorb a finer-grained equipment schema without renaming the screen.
 *
 * About you, Body and Goal group every existing field on one page.
 * Hairline inputs show pounds/cm beside values; Save is the only primary
 * action. Semantic theme colours keep the surface ready for a dark pass.
 * Back cancels without writing; validation stays beside its own input.
 *
 * On save we PUT the populated fields (snake_case to match
 * the backend), update the local user_data cache, and pop back to the
 * previous screen.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import HapticPressable from '../../components/HapticPressable';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { useCurrentUser, CurrentUser } from '../../hooks/useCurrentUser';
import { profileApi } from '../../services/api';
import { queryClient } from '../../services/queryClient';
import { refreshRecipeReads } from '../../lib/recipeAllergens';
import { errorMessage } from '../../types/common';
import { track } from '../../lib/analytics';
import { HapticService } from '../../ui/haptics/haptics.service';
import { typography, radius, spacing, SemanticTokens } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';
import { MoreStackParamList } from '../../navigation/ClientNavigator';
import {
  getProfileCompletion,
  buildProfileUpdatePayload,
  resolveProfileFields,
  ProfileField,
} from '../../lib/profileCompletion';
import { calcBMR, calcTDEE, calcMacros, calculateAge } from '../../utils/nutrition';
import { patchUserCache } from '../../lib/userCache';

type Nav = NativeStackNavigationProp<MoreStackParamList, 'EditProfile'>;

type Sex = 'male' | 'female';
type DietType =
  | 'omnivore'
  | 'vegetarian'
  | 'vegan'
  | 'pescatarian'
  | 'keto'
  | 'paleo'
  | 'mediterranean'
  | 'other';
type GymMembership = 'yes_regular' | 'yes_occasional' | 'home_gym' | 'no_gym';
type ActivityLevel =
  | 'sedentary'
  | 'light'
  | 'moderate'
  | 'active'
  | 'very_active';
type PrimaryGoal =
  | 'lose_fast'
  | 'lose_moderate'
  | 'maintain'
  | 'gain'
  | 'gain_fast'
  | 'mobility';

const SEX_OPTIONS: { value: Sex; label: string }[] = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
];

const DIET_OPTIONS: { value: DietType; label: string }[] = [
  { value: 'omnivore', label: 'Omnivore' },
  { value: 'vegetarian', label: 'Vegetarian' },
  { value: 'vegan', label: 'Vegan' },
  { value: 'pescatarian', label: 'Pescatarian' },
  { value: 'keto', label: 'Keto' },
  { value: 'paleo', label: 'Paleo' },
  { value: 'mediterranean', label: 'Mediterranean' },
  { value: 'other', label: 'Other' },
];

const GYM_OPTIONS: { value: GymMembership; label: string; description: string }[] = [
  { value: 'yes_regular', label: 'Full gym, regular access', description: 'Three or more sessions a week' },
  { value: 'yes_occasional', label: 'Full gym, occasional access', description: 'One or two sessions a week' },
  { value: 'home_gym', label: 'Home setup', description: 'Dumbbells, bands, or a small rack at home' },
  { value: 'no_gym', label: 'Bodyweight only', description: 'Outdoors or living-room training' },
];

const WORKOUT_DAY_OPTIONS = [1, 2, 3, 4, 5, 6, 7];

const ACTIVITY_OPTIONS: {
  value: ActivityLevel;
  label: string;
  description: string;
}[] = [
  { value: 'sedentary',   label: 'Sedentary',     description: 'Desk job, little movement' },
  { value: 'light',       label: 'Lightly active', description: 'Light walking, 1–3 sessions a week' },
  { value: 'moderate',    label: 'Moderately active', description: 'Steady training, 3–5 sessions a week' },
  { value: 'active',      label: 'Active',        description: 'Hard training, 5+ sessions a week' },
  { value: 'very_active', label: 'Very active',   description: 'Two-a-days or physical job' },
];

const GOAL_OPTIONS: { value: PrimaryGoal; label: string; description: string }[] = [
  { value: 'lose_fast',     label: 'Lose weight fast',   description: 'Aggressive deficit (~750 kcal)' },
  { value: 'lose_moderate', label: 'Lose weight steady', description: 'Calorie adjustment (~500 kcal deficit)' },
  { value: 'maintain',      label: 'Maintain',           description: 'Hold the line' },
  { value: 'gain',          label: 'Build muscle',       description: 'Calorie adjustment (+350 kcal)' },
  { value: 'gain_fast',     label: 'Gain mass',          description: 'Aggressive surplus (+700 kcal)' },
  { value: 'mobility',      label: 'Mobility & wellness', description: 'Maintenance calorie target' },
];

// The allergy chips of AllergySafetyPrompt plus diet exclusions, saved as typed (the backend
// maps the allergy ones, Soy, Sesame and Fish included). Includes "None"
// as an explicit answer so an empty selection still records intent.
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
  'No Pork',
  'No Beef',
  'No Fish',
  'No Spicy',
];

interface FormState {
  sex: Sex | null;
  dob: string;
  targetWeight: string;
  dietType: DietType | null;
  workoutDaysPerWeek: number | null;
  gymMembership: GymMembership | null;
  // Wave 5: TDEE inputs + dietary safety.
  currentWeight: string;
  heightCm: string;
  activityLevel: ActivityLevel | null;
  primaryGoal: PrimaryGoal | null;
  dietRestrictions: string[];
  /** True once the user has explicitly engaged the restrictions section. */
  dietRestrictionsAnswered: boolean;
}

function profileToForm(user: CurrentUser | null): FormState {
  // Older names first, then the server columns (resolveProfileFields).
  const p = user?.profile ? resolveProfileFields(user.profile) : undefined;
  const sexRaw = p?.sex;
  const dietRaw = p?.diet_type;
  const gymRaw = p?.gym_membership;
  const activityRaw = p?.activity_level;
  const goalRaw = p?.primary_goal;
  const restrictionsRaw = p?.diet_restrictions;

  const sex: Sex | null =
    sexRaw === 'male' || sexRaw === 'female' ? sexRaw : null;
  const dietType: DietType | null = DIET_OPTIONS.some((o) => o.value === dietRaw)
    ? (dietRaw as DietType)
    : null;
  const gymMembership: GymMembership | null = GYM_OPTIONS.some((o) => o.value === gymRaw)
    ? (gymRaw as GymMembership)
    : null;
  const activityLevel: ActivityLevel | null = ACTIVITY_OPTIONS.some(
    (o) => o.value === activityRaw,
  )
    ? (activityRaw as ActivityLevel)
    : null;
  const primaryGoal: PrimaryGoal | null = GOAL_OPTIONS.some((o) => o.value === goalRaw)
    ? (goalRaw as PrimaryGoal)
    : null;

  // diet_restrictions: array means user has already answered (possibly with
  // an empty list = "none"). Anything else (undefined, string, etc.) means
  // unanswered — we keep the form blank so the safety nudge fires.
  const dietRestrictions = Array.isArray(restrictionsRaw)
    ? restrictionsRaw.filter((s): s is string => typeof s === 'string')
    : [];
  const dietRestrictionsAnswered = Array.isArray(restrictionsRaw);

  return {
    sex,
    dob: typeof p?.dob === 'string' ? p.dob : '',
    targetWeight: typeof p?.target_weight === 'number' ? String(p.target_weight) : '',
    dietType,
    workoutDaysPerWeek:
      typeof p?.workout_days_per_week === 'number' ? p.workout_days_per_week : null,
    gymMembership,
    currentWeight:
      typeof p?.current_weight === 'number' ? String(p.current_weight) : '',
    heightCm: typeof p?.height_cm === 'number' ? String(p.height_cm) : '',
    activityLevel,
    primaryGoal,
    dietRestrictions,
    dietRestrictionsAnswered,
  };
}

const DOB_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDob(value: string): boolean {
  if (!DOB_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  if (date > now) return false;
  const yearsAgo = (now.getTime() - date.getTime()) / (365.25 * 24 * 3600 * 1000);
  return yearsAgo >= 13 && yearsAgo <= 110;
}

function isValidTargetWeight(raw: string): boolean {
  if (!raw) return true;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 50 && n <= 700;
}

function isValidCurrentWeightLbs(raw: string): boolean {
  if (!raw) return true;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 60 && n <= 700;
}

function isValidHeightCm(raw: string): boolean {
  if (!raw) return true;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 90 && n <= 250;
}

/**
 * Compute calorie + macro targets from the form when we have all four
 * required inputs (current_weight, height, dob, sex) + an activity bucket
 * + a goal. Returns null if any are missing — caller must not send the
 * partial result. Mirrors `finalizeLeanOnboarding`'s tryComputeMacros.
 */
function tryComputeMacrosFromForm(form: FormState): {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  tdee: number;
} | null {
  if (!form.currentWeight.trim() || !form.heightCm.trim()) return null;
  if (!form.dob || !form.sex) return null;
  if (!form.activityLevel || !form.primaryGoal) return null;
  const weightLbs = Number(form.currentWeight);
  const heightCm = Number(form.heightCm);
  if (!Number.isFinite(weightLbs) || weightLbs <= 0) return null;
  if (!Number.isFinite(heightCm) || heightCm <= 0) return null;
  const age = calculateAge(form.dob);
  if (!Number.isFinite(age) || age <= 0) return null;
  const bmr = calcBMR(weightLbs, heightCm, age, form.sex);
  const tdee = calcTDEE(bmr, form.activityLevel);
  const out = calcMacros(weightLbs, tdee, form.primaryGoal);
  return {
    calories: out.calories,
    protein: out.protein,
    carbs: out.carbs,
    fat: out.fat,
    tdee: out.tdee,
  };
}

export default function EditProfileScreen() {
  const { semanticColors: colors } = useTheme();
  const styles = useStyles();
  const navigation = useNavigation<Nav>();
  const currentUser = useCurrentUser();
  const initial = useMemo(() => profileToForm(currentUser), [currentUser]);
  const [form, setForm] = useState<FormState>(initial);
  const [saving, setSaving] = useState(false);
  const [dobError, setDobError] = useState<string | null>(null);
  const [weightError, setWeightError] = useState<{ field: string; message: string } | null>(null);

  // The user cache resolves after mount; show the saved values once it loads.
  useEffect(() => {
    if (currentUser) setForm(initial);
  }, [currentUser, initial]);

  const completion = getProfileCompletion(currentUser);

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  // Toggle a chip in the diet_restrictions multi-select. Selecting "None"
  // clears every other selection (you can't simultaneously have "None" and
  // "Nut Allergy"). Any non-None selection clears "None" if it was set.
  const toggleRestriction = (label: string) => {
    setForm((prev) => {
      const has = prev.dietRestrictions.includes(label);
      let next: string[];
      if (label === 'None') {
        next = has ? [] : ['None'];
      } else {
        const without = prev.dietRestrictions.filter((x) => x !== 'None');
        next = has ? without.filter((x) => x !== label) : [...without, label];
      }
      // Any interaction = answered (even toggling "None" off — they
      // engaged with the question, just decided "no" on this option).
      return { ...prev, dietRestrictions: next, dietRestrictionsAnswered: true };
    });
  };

  const handleSave = async () => {
    if (form.dob && !isValidDob(form.dob)) {
      // Phase 11 / Track 3: warning haptic on form validation error
      HapticService.warning();
      setDobError('Enter a date as YYYY-MM-DD for an age between 13 and 110.');
      return;
    }
    if (form.targetWeight && !isValidTargetWeight(form.targetWeight)) {
      // Phase 11 / Track 3: warning haptic on form validation error
      HapticService.warning();
      setWeightError({ field: 'targetWeight', message: 'Enter a weight between 50 and 700 lbs.' });
      return;
    }
    if (form.currentWeight && !isValidCurrentWeightLbs(form.currentWeight)) {
      HapticService.warning();
      setWeightError({ field: 'currentWeight', message: 'Enter a current weight between 60 and 700 lbs.' });
      return;
    }
    if (form.heightCm && !isValidHeightCm(form.heightCm)) {
      HapticService.warning();
      setWeightError({ field: 'heightCm', message: 'Enter a height between 90 and 250 cm.' });
      return;
    }
    setDobError(null);
    setWeightError(null);

    const payload = buildProfileUpdatePayload(form);

    // If we have every TDEE input, recompute targets so the user does NOT
    // need to re-onboard. The lean flow only runs once; subsequent changes
    // (weight, activity bump) flow through here.
    const macros = tryComputeMacrosFromForm(form);
    if (macros) {
      payload.tdee = macros.tdee;
      payload.calorie_target = macros.calories;
      payload.protein_target = macros.protein;
      payload.carbs_target = macros.carbs;
      payload.fat_target = macros.fat;
    }

    if (Object.keys(payload).length === 0) {
      navigation.goBack();
      return;
    }

    setSaving(true);
    try {
      await profileApi.update(payload);
      // Saved allergies decide which shared recipes are hidden: read the recipe lists again.
      if (Array.isArray(payload.diet_restrictions)) refreshRecipeReads(queryClient);

      // If we just recomputed macros, persist them locally so Home picks
      // them up immediately on the next render.
      if (macros) {
        try {
          await AsyncStorage.setItem('macro_targets', JSON.stringify(macros));
        } catch {
          // Best-effort.
        }
      }

      // Refresh local user_data so Home + Profile reflect the change without
      // requiring a /auth/me round-trip.
      try {
        await patchUserCache({ profile: payload as never });
      } catch (err) {
        console.warn('EditProfile: failed to refresh local user_data', err);
      }

      track('profile_edit_saved', {
        fields: Object.keys(payload),
        previously_missing: completion.missing.length,
        macros_recomputed: !!macros,
      });
      // Phase 11 / Track 3: success haptic on profile saved
      HapticService.success();
      navigation.goBack();
    } catch (err) {
      // Phase 11 / Track 3: error haptic on failed profile save
      HapticService.error();
      Alert.alert(
        "Couldn't save",
        errorMessage(err, 'Profile changes were not saved. Check the connection and try again.'),
      );
    } finally {
      setSaving(false);
    }
  };

  const isComplete = (() => {
    const next: ProfileField[] = [];
    if (!form.sex) next.push('sex');
    if (!form.dob) next.push('dob');
    if (!form.targetWeight) next.push('target_weight');
    if (!form.dietType) next.push('diet_type');
    if (form.workoutDaysPerWeek === null) next.push('workout_days_per_week');
    if (!form.gymMembership) next.push('gym_membership');
    if (!form.currentWeight) next.push('current_weight');
    if (!form.heightCm) next.push('height_cm');
    if (!form.activityLevel) next.push('activity_level');
    if (!form.primaryGoal) next.push('primary_goal');
    if (!form.dietRestrictionsAnswered) next.push('diet_restrictions');
    return next.length === 0;
  })();

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <HapticPressable
          intent="light"
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </HapticPressable>
        <Text style={styles.title}>Edit profile</Text>
        <View style={styles.backBtn} />
      </View>

      <Text style={styles.lede}>
        Update the details used for daily targets and training preferences.
      </Text>

      <Text style={styles.overline}>ABOUT YOU</Text>
      <Section label="Sex">
        <View style={styles.rowChoices}>
          {SEX_OPTIONS.map((opt) => (
            <ChoicePill
              key={opt.value}
              label={opt.label}
              selected={form.sex === opt.value}
              onPress={() => setField('sex', opt.value)}
            />
          ))}
        </View>
      </Section>

      <Section label="Date of birth" hint="Format: YYYY-MM-DD">
        <TextInput
          style={[styles.input, dobError ? styles.inputError : null]}
          value={form.dob}
          onChangeText={(t) => setField('dob', t)}
          placeholder="1992-04-15"
          placeholderTextColor={colors.textMuted}
          keyboardType="numbers-and-punctuation"
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={10}
          accessibilityLabel="Date of birth"
        />
        {dobError ? <Text style={styles.errorText}>{dobError}</Text> : null}
      </Section>

      <Text style={styles.overline}>BODY</Text>
      <Section label="Current weight">
        <View style={styles.unitRow}>
          <TextInput
            style={[styles.input, weightError?.field === 'currentWeight' ? styles.inputError : null]}
            value={form.currentWeight}
            onChangeText={(t) => setField('currentWeight', t.replace(/[^0-9.]/g, ''))}
            placeholder="180"
            placeholderTextColor={colors.textMuted}
            keyboardType="decimal-pad"
            accessibilityLabel="Current weight in pounds"
          />
          <Text style={styles.unit}>lbs</Text>
        </View>
        {weightError?.field === 'currentWeight' ? <Text style={styles.errorText}>{weightError.message}</Text> : null}
      </Section>

      <Section label="Height">
        <View style={styles.unitRow}>
          <TextInput
            style={[styles.input, weightError?.field === 'heightCm' ? styles.inputError : null]}
            value={form.heightCm}
            onChangeText={(t) => setField('heightCm', t.replace(/[^0-9]/g, ''))}
            placeholder="178"
            placeholderTextColor={colors.textMuted}
            keyboardType="number-pad"
            maxLength={3}
            accessibilityLabel="Height in centimetres"
          />
          <Text style={styles.unit}>cm</Text>
        </View>
        {weightError?.field === 'heightCm' ? <Text style={styles.errorText}>{weightError.message}</Text> : null}
      </Section>

      <Text style={styles.overline}>GOAL</Text>
      <Section label="Target weight">
        <View style={styles.unitRow}>
          <TextInput
            style={[styles.input, weightError?.field === 'targetWeight' ? styles.inputError : null]}
            value={form.targetWeight}
            onChangeText={(t) => setField('targetWeight', t.replace(/[^0-9.]/g, ''))}
            placeholder="165"
            placeholderTextColor={colors.textMuted}
            keyboardType="decimal-pad"
            accessibilityLabel="Target weight in pounds"
          />
          <Text style={styles.unit}>lbs</Text>
        </View>
        {weightError?.field === 'targetWeight' ? <Text style={styles.errorText}>{weightError.message}</Text> : null}
      </Section>

      <Section
        label="Activity level"
        hint="Used with body details to calculate daily calorie targets."
      >
        {ACTIVITY_OPTIONS.map((opt) => (
          <SelectRow
            key={opt.value}
            label={opt.label}
            description={opt.description}
            selected={form.activityLevel === opt.value}
            onPress={() => setField('activityLevel', opt.value)}
          />
        ))}
      </Section>

      <Section
        label="Primary goal"
        hint="Choose a goal for daily calorie targets."
      >
        {GOAL_OPTIONS.map((opt) => (
          <SelectRow
            key={opt.value}
            label={opt.label}
            description={opt.description}
            selected={form.primaryGoal === opt.value}
            onPress={() => setField('primaryGoal', opt.value)}
          />
        ))}
      </Section>

      <Section
        label="Allergies and restrictions"
        hint="Record allergies and dietary restrictions. Pick None if you have none."
      >
        <View style={styles.rowChoicesWrap}>
          {RESTRICTION_OPTIONS.map((label) => (
            <ChoicePill
              key={label}
              label={label}
              selected={form.dietRestrictions.includes(label)}
              onPress={() => toggleRestriction(label)}
            />
          ))}
        </View>
      </Section>

      <Section label="Diet preference">
        <View style={styles.rowChoicesWrap}>
          {DIET_OPTIONS.map((opt) => (
            <ChoicePill
              key={opt.value}
              label={opt.label}
              selected={form.dietType === opt.value}
              onPress={() => setField('dietType', opt.value)}
            />
          ))}
        </View>
      </Section>

      <Section label="Workout days per week">
        <View style={styles.rowChoices}>
          {WORKOUT_DAY_OPTIONS.map((n) => (
            <ChoicePill
              key={n}
              label={String(n)}
              selected={form.workoutDaysPerWeek === n}
              onPress={() => setField('workoutDaysPerWeek', n)}
            />
          ))}
        </View>
      </Section>

      <Section
        label="Equipment access"
        hint="Record the equipment available for training."
      >
        {GYM_OPTIONS.map((opt) => (
          <SelectRow
            key={opt.value}
            label={opt.label}
            description={opt.description}
            selected={form.gymMembership === opt.value}
            onPress={() => setField('gymMembership', opt.value)}
          />
        ))}
      </Section>

      <HapticPressable
        intent="medium"
        style={[styles.saveBtn, saving ? styles.saveBtnDisabled : null]}
        onPress={handleSave}
        disabled={saving}
        accessibilityRole="button"
        accessibilityLabel="Save profile"
      >
        {saving ? (
          <ActivityIndicator color={colors.textOnAccent} accessibilityLabel="Saving profile" />
        ) : (
          <Text style={styles.saveBtnText}>{isComplete ? 'Save' : 'Save progress'}</Text>
        )}
      </HapticPressable>

      <Text style={styles.footnote}>
        You can revise these any time.
      </Text>
    </ScrollView>
  );
}

function Section({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  const styles = useStyles();
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{label}</Text>
      {hint ? <Text style={styles.sectionHint}>{hint}</Text> : null}
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function ChoicePill({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  return (
    <HapticPressable
      intent="light"
      style={[styles.pill, selected ? styles.pillSelected : null]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
    >
      <Text style={[styles.pillLabel, selected ? styles.pillLabelSelected : null]}>
        {label}
      </Text>
    </HapticPressable>
  );
}

function SelectRow({
  label,
  description,
  selected,
  onPress,
}: {
  label: string;
  description: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { semanticColors: colors } = useTheme();
  const styles = useStyles();
  return (
    <HapticPressable
      intent="light"
      style={[styles.selectRow, selected ? styles.selectRowSelected : null]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
    >
      <View style={{ flex: 1 }}>
        <Text style={[styles.selectRowLabel, selected ? styles.selectRowLabelSelected : null]}>
          {label}
        </Text>
        <Text style={styles.selectRowDescription}>{description}</Text>
      </View>
      {selected ? (
        <Ionicons name="checkmark-outline" size={20} color={colors.accentText} />
      ) : null}
    </HapticPressable>
  );
}

function useStyles() {
  const { semanticColors } = useTheme();
  return useMemo(() => createStyles(semanticColors), [semanticColors]);
}

const createStyles = (colors: SemanticTokens) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 60,
    paddingBottom: 64,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  backBtn: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    ...typography.h2,
    color: colors.textPrimary,
  },
  lede: {
    ...typography.body,
    color: colors.textMuted,
    marginBottom: spacing['2xl'],
  },
  section: {
    marginBottom: spacing['2xl'],
  },
  overline: {
    ...typography.eyebrow,
    color: colors.textMuted,
    marginBottom: spacing.lg,
  },
  sectionLabel: {
    ...typography.bodySmall,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  sectionHint: {
    ...typography.bodySmall,
    color: colors.textMuted,
    marginBottom: spacing.md,
  },
  sectionBody: {
    marginTop: 4,
  },
  rowChoices: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  rowChoicesWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pill: {
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  pillSelected: {
    borderColor: colors.accentText,
  },
  pillLabel: {
    ...typography.bodySmall,
    color: colors.textMuted,
    fontWeight: '500' as const,
  },
  pillLabelSelected: {
    color: colors.textPrimary,
  },
  unitRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  unit: {
    ...typography.bodySmall,
    color: colors.textMuted,
    paddingLeft: spacing.md,
    minWidth: 44,
  },
  input: {
    ...typography.body,
    color: colors.textPrimary,
    flexGrow: 1,
    fontVariant: ['tabular-nums'],
    minHeight: 48,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingVertical: 14,
  },
  inputError: {
    borderColor: colors.textPrimary,
  },
  errorText: {
    ...typography.bodySmall,
    color: colors.textPrimary,
    marginTop: 6,
  },
  selectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    marginBottom: 8,
  },
  selectRowSelected: {
    borderColor: colors.accentText,
  },
  selectRowLabel: {
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: '500' as const,
  },
  selectRowLabelSelected: {
    color: colors.textPrimary,
  },
  selectRowDescription: {
    ...typography.bodySmall,
    color: colors.textMuted,
    marginTop: 2,
  },
  saveBtn: {
    backgroundColor: colors.accent,
    minHeight: 52,
    borderRadius: radius.lg,
    paddingVertical: 18,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  saveBtnDisabled: {
    opacity: 0.6,
  },
  saveBtnText: {
    ...typography.bodyMd,
    color: colors.textOnAccent,
  },
  footnote: {
    ...typography.bodySmall,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
});
