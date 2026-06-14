import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';
import StepTransitionView from './onboarding/StepTransitionView';
import { featureFlags } from '../config/featureFlags';

interface Props {
  step: number;
  totalSteps: number;
  title: string;
  subtitle?: string;
  onBack?: () => void;
  onContinue: () => void;
  continueEnabled?: boolean;
  continueLabel?: string;
  children: React.ReactNode;
}

export default function OnboardingLayout({
  step,
  totalSteps,
  title,
  subtitle,
  onBack,
  onContinue,
  continueEnabled = true,
  continueLabel = 'Continue',
  children,
}: Props) {
  const progressAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: step / totalSteps,
      duration: 300,
      useNativeDriver: false,
    }).start();
  }, [step, totalSteps]);

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.topBar}>
        {onBack ? (
          <TouchableOpacity onPress={onBack} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
          </TouchableOpacity>
        ) : (
          <View style={styles.backButton} />
        )}
        <View style={styles.dotsRow}>
          {Array.from({ length: totalSteps }, (_, i) => (
            <View
              key={i}
              style={[styles.dot, i < step && styles.dotActive]}
            />
          ))}
        </View>
        <View style={styles.backButton} />
      </View>

      <View style={styles.progressBar}>
        <Animated.View
          style={[styles.progressFill, { width: progressWidth }]}
        />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/*
          ED.5 onboarding polish: when `romanOnboardingPolish` is ON, the
          per-step content cross-fades + slides 8px on mount through the shared
          StepTransitionView primitive (220ms ease-out cubic), re-triggered per
          `step`. When OFF, StepTransitionView renders its children at rest with
          no animation, so the legacy hard-cut behaviour is byte-identical. This
          is a presentation-only wrap — the step title, subtitle, and content
          are untouched.
        */}
        <StepTransitionView
          enabled={featureFlags.romanOnboardingPolish}
          transitionKey={step}
          style={styles.transition}
        >
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}

          <View style={styles.content}>{children}</View>
        </StepTransitionView>
      </ScrollView>

      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={[styles.continueButton, !continueEnabled && styles.continueDisabled]}
          onPress={onContinue}
          disabled={!continueEnabled}
          activeOpacity={0.8}
        >
          <Text style={styles.continueText}>{continueLabel}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 60,
    paddingBottom: 12,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.border,
  },
  dotActive: {
    backgroundColor: Colors.primary,
  },
  progressBar: {
    height: 4,
    backgroundColor: Colors.border,
    marginHorizontal: 24,
    borderRadius: 2,
    marginBottom: 24,
  },
  progressFill: {
    height: '100%',
    backgroundColor: Colors.primary,
    borderRadius: 2,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  transition: {
    // The transition wrapper should size to its content inside the scroll view
    // rather than stretch to fill, so the legacy (flag-off) layout is unchanged.
    flex: 0,
  },
  title: {
    fontSize: 28,
    fontWeight: '500',
    color: Colors.textPrimary,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: Colors.textSecondary,
    lineHeight: 22,
    marginBottom: 8,
  },
  content: {
    marginTop: 24,
  },
  bottomBar: {
    paddingHorizontal: 24,
    paddingBottom: 40,
    paddingTop: 16,
  },
  continueButton: {
    backgroundColor: Colors.primary,
    paddingVertical: 16,
    borderRadius: 2, // radius.md
    alignItems: 'center',
  },
  continueDisabled: {
    opacity: 0.4,
  },
  continueText: {
    color: Colors.textOnPrimary,
    fontSize: 18,
    fontWeight: '500',
  },
});
