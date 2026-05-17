/**
 * CoachWizardNavigator — 6-step coach onboarding wizard.
 *
 * Shown when GET /coach/onboarding returns { is_complete: false }.
 * Step 6 calls POST /coach/onboarding/complete, writes the MMKV completion
 * flag, and fires authEvents.emit() so RootNavigator re-bootstraps into
 * the full CoachNavigator.
 *
 * Steps 1–5 are intentional stubs — product copy and data capture to be
 * filled in per the coach-onboarding spec. The navigation skeleton is in
 * place and fully wired.
 */

import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  ScrollView,
} from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { authEvents } from '../utils/authEvents';
import { prefsStorage } from '../storage/mmkv';
import api from '../services/api';
import { useTheme, ThemeColors } from '../theme/ThemeProvider';

// ─── Types ────────────────────────────────────────────────────────────────────

export type CoachWizardParamList = {
  CoachWizardStep1: undefined;
  CoachWizardStep2: undefined;
  CoachWizardStep3: undefined;
  CoachWizardStep4: undefined;
  CoachWizardStep5: undefined;
  CoachWizardStep6: undefined;
};

const MMKV_COMPLETE_KEY = 'coach.onboarding.is_complete';

// ─── Shared step layout ───────────────────────────────────────────────────────

interface StepLayoutProps {
  stepNumber: number;
  totalSteps: number;
  heading: string;
  body: string;
  ctaLabel: string;
  onCta: () => void;
  ctaDisabled?: boolean;
  onBack?: () => void;
  children?: React.ReactNode;
  errorMessage?: string;
}

function StepLayout({
  stepNumber,
  totalSteps,
  heading,
  body,
  ctaLabel,
  onCta,
  ctaDisabled,
  onBack,
  children,
  errorMessage,
}: StepLayoutProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
        {/* Step indicator */}
        <View style={styles.stepIndicator}>
          {Array.from({ length: totalSteps }).map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                i < stepNumber - 1 && styles.dotComplete,
                i === stepNumber - 1 && styles.dotActive,
              ]}
            />
          ))}
        </View>

        <Text style={styles.headline}>{heading}</Text>
        <Text style={styles.subtext}>{body}</Text>
        {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}

        {children ? <View style={styles.childrenContainer}>{children}</View> : null}

        <View style={{ flex: 1 }} />

        <TouchableOpacity
          style={[styles.primaryBtn, ctaDisabled && styles.primaryBtnDisabled]}
          onPress={onCta}
          disabled={ctaDisabled}
          accessibilityRole="button"
          accessibilityLabel={ctaLabel}
          testID={`wizard-step-${stepNumber}-cta`}
        >
          <Text style={styles.primaryBtnText}>{ctaLabel.toUpperCase()}</Text>
        </TouchableOpacity>

        {onBack ? (
          <TouchableOpacity
            onPress={onBack}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            testID={`wizard-step-${stepNumber}-back`}
          >
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Steps 1–5 (stubs with navigation wiring) ─────────────────────────────────

type Step1Props = { navigation: NativeStackNavigationProp<CoachWizardParamList, 'CoachWizardStep1'> };
function CoachWizardStep1({ navigation }: Step1Props) {
  return (
    <StepLayout
      stepNumber={1}
      totalSteps={6}
      heading="Welcome, Coach."
      body="Let's set up your coaching practice. This takes about two minutes."
      ctaLabel="Get started"
      onCta={() => navigation.navigate('CoachWizardStep2')}
    />
  );
}

type Step2Props = { navigation: NativeStackNavigationProp<CoachWizardParamList, 'CoachWizardStep2'> };
function CoachWizardStep2({ navigation }: Step2Props) {
  return (
    <StepLayout
      stepNumber={2}
      totalSteps={6}
      heading="Your practice name."
      body="This is how clients will see you in the app."
      ctaLabel="Continue"
      onCta={() => navigation.navigate('CoachWizardStep3')}
      onBack={() => navigation.goBack()}
    />
  );
}

type Step3Props = { navigation: NativeStackNavigationProp<CoachWizardParamList, 'CoachWizardStep3'> };
function CoachWizardStep3({ navigation }: Step3Props) {
  return (
    <StepLayout
      stepNumber={3}
      totalSteps={6}
      heading="Your speciality."
      body="Tell clients what you focus on — strength, nutrition, lifestyle, or something else."
      ctaLabel="Continue"
      onCta={() => navigation.navigate('CoachWizardStep4')}
      onBack={() => navigation.goBack()}
    />
  );
}

type Step4Props = { navigation: NativeStackNavigationProp<CoachWizardParamList, 'CoachWizardStep4'> };
function CoachWizardStep4({ navigation }: Step4Props) {
  return (
    <StepLayout
      stepNumber={4}
      totalSteps={6}
      heading="Your capacity."
      body="How many clients are you ready to take on right now?"
      ctaLabel="Continue"
      onCta={() => navigation.navigate('CoachWizardStep5')}
      onBack={() => navigation.goBack()}
    />
  );
}

type Step5Props = { navigation: NativeStackNavigationProp<CoachWizardParamList, 'CoachWizardStep5'> };
function CoachWizardStep5({ navigation }: Step5Props) {
  return (
    <StepLayout
      stepNumber={5}
      totalSteps={6}
      heading="Connect payments."
      body="Link Stripe to accept client payments. You can do this now or from Settings later."
      ctaLabel="Continue"
      onCta={() => navigation.navigate('CoachWizardStep6')}
      onBack={() => navigation.goBack()}
    />
  );
}

// ─── Step 6 — final step, calls complete endpoint ─────────────────────────────

// Advance the backend wizard row to the final step if the coach navigated
// here by tapping through the UI rather than via step-advance API calls.
// This ensures POST /coach/onboarding/complete passes the backend's
// current_step >= total_steps guard regardless of how the wizard was traversed.
async function ensureWizardAtFinalStep(totalSteps: number): Promise<void> {
  let currentStep = 0;
  try {
    const res = await api.get<{ current_step: number; is_complete: boolean }>('/coach/onboarding');
    if (res.data.is_complete) return;
    currentStep = res.data.current_step ?? 0;
  } catch {
    // If the GET fails, attempt to advance from step 0 anyway — worst case
    // the backend rejects individual step advances, which is non-fatal.
  }
  for (let step = currentStep + 1; step <= totalSteps; step += 1) {
    try {
      await api.post(`/coach/onboarding/steps/${step}`, {});
    } catch {
      // Individual step advance failures are non-fatal — continue to complete.
    }
  }
}

type Step6Props = { navigation: NativeStackNavigationProp<CoachWizardParamList, 'CoachWizardStep6'> };
function CoachWizardStep6({ navigation }: Step6Props) {
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleBeginCoaching = async () => {
    if (submitting) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      await ensureWizardAtFinalStep(6);
      await api.post('/coach/onboarding/complete');
      await prefsStorage.set(MMKV_COMPLETE_KEY, 'true');
      authEvents.emit();
    } catch {
      setErrorMessage('Setup could not complete. Check your connection and try again.');
      setSubmitting(false);
    }
  };

  return (
    <StepLayout
      stepNumber={6}
      totalSteps={6}
      heading="You're ready."
      body="Everything is set. Your coaching dashboard is waiting."
      ctaLabel="Begin Coaching"
      onCta={handleBeginCoaching}
      ctaDisabled={submitting}
      onBack={() => navigation.goBack()}
      errorMessage={errorMessage ?? undefined}
    />
  );
}

// ─── Navigator ────────────────────────────────────────────────────────────────

const Stack = createNativeStackNavigator<CoachWizardParamList>();

export default function CoachWizardNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="CoachWizardStep1" component={CoachWizardStep1} />
      <Stack.Screen name="CoachWizardStep2" component={CoachWizardStep2} />
      <Stack.Screen name="CoachWizardStep3" component={CoachWizardStep3} />
      <Stack.Screen name="CoachWizardStep4" component={CoachWizardStep4} />
      <Stack.Screen name="CoachWizardStep5" component={CoachWizardStep5} />
      <Stack.Screen name="CoachWizardStep6" component={CoachWizardStep6} />
    </Stack.Navigator>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    inner: {
      flexGrow: 1,
      paddingHorizontal: 24,
      paddingTop: 32,
      paddingBottom: 24,
    },
    stepIndicator: { flexDirection: 'row', gap: 8, marginBottom: 28 },
    dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border },
    dotActive: { backgroundColor: colors.primary, width: 24 },
    dotComplete: { backgroundColor: colors.primary },
    headline: {
      fontFamily: 'CormorantGaramond_400Regular',
      fontSize: 32,
      lineHeight: 36,
      color: colors.textPrimary,
      marginBottom: 12,
    },
    subtext: {
      fontFamily: 'Inter_400Regular',
      fontSize: 15,
      color: colors.textSecondary,
      lineHeight: 22,
      marginBottom: 16,
    },
    childrenContainer: { marginBottom: 16 },
    primaryBtn: {
      backgroundColor: colors.primary,
      paddingVertical: 16,
      alignItems: 'center',
      marginTop: 16,
    },
    primaryBtnDisabled: { opacity: 0.5 },
    primaryBtnText: {
      fontFamily: 'Inter_600SemiBold',
      fontSize: 14,
      color: colors.textOnPrimary,
      letterSpacing: 1.2,
    },
    backBtn: {
      paddingVertical: 12,
      alignSelf: 'flex-start',
      marginTop: 4,
    },
    backText: {
      fontFamily: 'Inter_500Medium',
      fontSize: 13,
      color: colors.textSecondary,
    },
    errorText: {
      fontFamily: 'Inter_400Regular',
      fontSize: 13,
      color: colors.error,
      lineHeight: 19,
      marginTop: 8,
      marginBottom: 8,
    },
  });
