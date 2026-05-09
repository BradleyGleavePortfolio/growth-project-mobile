/**
 * EditProfileScreen — captures the personalization fields that the backend
 * needs in order to produce a credible plan and unlock cold outbound copy.
 *
 * Field set is tied to lib/profileCompletion: sex, DOB, target weight, diet
 * preference, weekly workout days, and equipment access. The backend column
 * for equipment access is currently `gym_membership` (yes_regular /
 * yes_occasional / home_gym / no_gym) — UI copy is written so it can later
 * absorb a finer-grained equipment schema without renaming the screen.
 *
 * On save we PUT the fields the user actually changed (snake_case to match
 * the backend), update the local user_data cache, and pop back to the
 * previous screen.
 */
import React, { useMemo, useState } from 'react';
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
import { errorMessage } from '../../types/common';
import { track } from '../../lib/analytics';
import { HapticService } from '../../ui/haptics/haptics.service';
import { colors, typography, radius, spacing } from '../../theme/tokens';
import { MoreStackParamList } from '../../navigation/ClientNavigator';
import {
  getProfileCompletion,
  buildProfileUpdatePayload,
  ProfileField,
} from '../../lib/profileCompletion';
import { calcBMR, calcTDEE, calcMacros, calculateAge } from '../../utils/nutrition';

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
  { value: 'lose_moderate', label: 'Lose weight steady', description: 'Sustainable deficit (~500 kcal)' },
  { value: 'maintain',      label: 'Maintain',           description: 'Hold the line' },
  { value: 'gain',          label: 'Build muscle',       description: 'Lean surplus (+350 kcal)' },
  { value: 'gain_fast',     label: 'Gain mass',          description: 'Aggressive surplus (+700 kcal)' },
  { value: 'mobility',      label: 'Mobility & wellness', description: 'Maintenance, no caloric target' },
];

// Restriction chip set mirrors OnboardingStep6 for parity. Includes "None"
// as an explicit answer so an empty selection still records intent.
const RESTRICTION_OPTIONS = [
  'None',
  'Nut Allergy',
  'Peanut Allergy',
  'Shellfish Allergy',
  'Egg Allergy',
  'Dairy Allergy',
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
  const p = user?.profile;
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
    dob: p?.dob ?? '',
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
  const navigation = useNavigation<Nav>();
  const currentUser = useCurrentUser();
  const initial = useMemo(() => profileToForm(currentUser), [currentUser]);
  const [form, setForm] = useState<FormState>(initial);
  const [saving, setSaving] = useState(false);
  const [dobError, setDobError] = useState<string | null>(null);
  const [weightError, setWeightError] = useState<string | null>(null);

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
      setDobError('Use the format YYYY-MM-DD.');
      return;
    }
    if (form.targetWeight && !isValidTargetWeight(form.targetWeight)) {
      // Phase 11 / Track 3: warning haptic on form validation error
      HapticService.warning();
      setWeightError('Enter a weight between 50 and 700 lbs.');
      return;
    }
    if (form.currentWeight && !isValidCurrentWeightLbs(form.currentWeight)) {
      HapticService.warning();
      setWeightError('Current weight should be between 60 and 700 lbs.');
      return;
    }
    if (form.heightCm && !isValidHeightCm(form.heightCm)) {
      HapticService.warning();
      setWeightError('Height should be between 90 and 250 cm.');
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
      // requiring a /auth/me round-trip. We only update the profile slice; the
      // rest of the user_data record is preserved.
      try {
        const raw = await AsyncStorage.getItem('user_data');
        if (raw) {
          const parsed = JSON.parse(raw);
          const nextProfile = { ...(parsed.profile ?? {}), ...payload };
          await AsyncStorage.setItem(
            'user_data',
            JSON.stringify({ ...parsed, profile: nextProfile }),
          );
        }
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
        errorMessage(err, 'Please try again in a moment.'),
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
          <Ionicons name="chevron-back" size={24} color={colors.ink} />
        </HapticPressable>
        <Text style={styles.title}>Edit profile</Text>
        <View style={styles.backBtn} />
      </View>

      <Text style={styles.lede}>
        These details shape your plan. Your coach sees them; nothing leaves the app.
      </Text>

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
          placeholderTextColor={colors.stone}
          keyboardType="numbers-and-punctuation"
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={10}
          accessibilityLabel="Date of birth"
        />
        {dobError ? <Text style={styles.errorText}>{dobError}</Text> : null}
      </Section>

      <Section label="Current weight" hint="Pounds">
        <TextInput
          style={[styles.input, weightError ? styles.inputError : null]}
          value={form.currentWeight}
          onChangeText={(t) => setField('currentWeight', t.replace(/[^0-9.]/g, ''))}
          placeholder="180"
          placeholderTextColor={colors.stone}
          keyboardType="decimal-pad"
          accessibilityLabel="Current weight in pounds"
        />
      </Section>

      <Section label="Height" hint="Centimetres">
        <TextInput
          style={[styles.input, weightError ? styles.inputError : null]}
          value={form.heightCm}
          onChangeText={(t) => setField('heightCm', t.replace(/[^0-9]/g, ''))}
          placeholder="178"
          placeholderTextColor={colors.stone}
          keyboardType="number-pad"
          maxLength={3}
          accessibilityLabel="Height in centimetres"
        />
      </Section>

      <Section label="Target weight" hint="Pounds">
        <TextInput
          style={[styles.input, weightError ? styles.inputError : null]}
          value={form.targetWeight}
          onChangeText={(t) => setField('targetWeight', t.replace(/[^0-9.]/g, ''))}
          placeholder="165"
          placeholderTextColor={colors.stone}
          keyboardType="decimal-pad"
          accessibilityLabel="Target weight in pounds"
        />
        {weightError ? <Text style={styles.errorText}>{weightError}</Text> : null}
      </Section>

      <Section
        label="Activity level"
        hint="Drives your daily calorie target."
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
        hint="Sets the deficit or surplus on top of your TDEE."
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
        hint="The recipe library hides anything that conflicts with these. Pick None if you have none."
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
        hint="Used to decide which lifts your plan can prescribe."
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
          <ActivityIndicator color={colors.bone} />
        ) : (
          <Text style={styles.saveBtnText}>{isComplete ? 'SAVE' : 'SAVE PROGRESS'}</Text>
        )}
      </HapticPressable>

      <Text style={styles.footnote}>
        You can revise these any time. Coaches will see the most recent values.
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
        <Ionicons name="checkmark" size={20} color={colors.forest} />
      ) : null}
    </HapticPressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bone,
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
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    ...typography.h2,
    color: colors.ink,
  },
  lede: {
    ...typography.body,
    color: colors.charcoal,
    marginBottom: spacing['2xl'],
  },
  section: {
    marginBottom: spacing['2xl'],
  },
  sectionLabel: {
    ...typography.eyebrow,
    color: colors.charcoal,
    marginBottom: 6,
  },
  sectionHint: {
    ...typography.bodySmall,
    color: colors.stone,
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
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 0.5,
    borderColor: colors.stone,
    borderRadius: radius.lg,
    backgroundColor: colors.cream,
  },
  pillSelected: {
    borderColor: colors.forest,
    borderWidth: 1,
    backgroundColor: colors.cream,
  },
  pillLabel: {
    ...typography.bodySmall,
    color: colors.charcoal,
    fontWeight: '500' as const,
  },
  pillLabelSelected: {
    color: colors.forest,
  },
  input: {
    ...typography.body,
    color: colors.ink,
    backgroundColor: colors.cream,
    borderWidth: 0.5,
    borderColor: colors.stone,
    borderRadius: radius.md,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  inputError: {
    borderColor: colors.error,
  },
  errorText: {
    ...typography.bodySmall,
    color: colors.error,
    marginTop: 6,
  },
  selectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 0.5,
    borderColor: colors.stone,
    borderRadius: radius.lg,
    backgroundColor: colors.cream,
    marginBottom: 8,
  },
  selectRowSelected: {
    borderColor: colors.forest,
    borderWidth: 1,
  },
  selectRowLabel: {
    ...typography.body,
    color: colors.ink,
    fontWeight: '500' as const,
  },
  selectRowLabelSelected: {
    color: colors.forest,
  },
  selectRowDescription: {
    ...typography.bodySmall,
    color: colors.stone,
    marginTop: 2,
  },
  saveBtn: {
    backgroundColor: colors.ink,
    paddingVertical: 18,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  saveBtnDisabled: {
    opacity: 0.6,
  },
  saveBtnText: {
    ...typography.eyebrow,
    color: colors.bone,
  },
  footnote: {
    ...typography.bodySmall,
    color: colors.stone,
    textAlign: 'center',
    marginTop: spacing.lg,
    fontStyle: 'italic',
  },
});
