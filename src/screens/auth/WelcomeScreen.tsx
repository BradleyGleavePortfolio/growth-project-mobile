import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  SafeAreaView,
  ScrollView,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AuthStackParamList } from '../../navigation/AuthNavigator';
// All colors from central theme — never hardcode hex values here
import { Spacing, Radius, typographyTokens } from '../../theme/index';
import { useTheme } from '../../theme/ThemeProvider';
import { lightTokens, type SemanticTokens } from '../../theme/tokens';
type Props = {
  navigation: NativeStackNavigationProp<AuthStackParamList, 'Welcome'>;
};

export default function WelcomeScreen({ navigation }: Props) {
  const { semanticColors: colors = lightTokens, colorScheme } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle={colorScheme === 'dark' ? 'light-content' : 'dark-content'} backgroundColor={colors.bgPrimary} />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.logoContainer}>
          <View style={styles.logoIcon}>
            <Text style={styles.logoIconText}>GP</Text>
          </View>
          <Text style={styles.title}>The Growth Project</Text>
          <Text style={styles.tagline}>
            Sign in or create an account.
          </Text>
        </View>

        {/* Round 3: accessibility labels on primary CTAs */}
        <View style={styles.buttonContainer}>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => navigation.navigate('Login')}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Sign in"
            accessibilityHint="Opens sign-in screen"
          >
            <Text style={styles.primaryButtonText}>Sign in</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => navigation.navigate('CreateAccount')}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Create account"
            accessibilityHint="Opens account creation"
          >
            <Text style={styles.secondaryButtonText}>Create account</Text>
          </TouchableOpacity>

          {/* Owner 2026-10-01 13:28: signup is open for every role; a code
              from a coach is optional and can be added now or later. */}
          <Text style={styles.accessNote} testID="welcome-optional-code-note">
            Have a code from your coach? You can add it now or later.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: SemanticTokens) =>
  StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
  },
  container: {
    flexGrow: 1,
    backgroundColor: colors.bgPrimary,
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingTop: 80,
    paddingBottom: Spacing.xxl,
  },
  logoContainer: {
    alignItems: 'center',
    marginTop: Spacing.xxl,
  },
  logoIcon: {
    width: 80,
    height: 80,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },
  logoIconText: {
    ...typographyTokens.h2,
    color: colors.textPrimary,
  },
  title: {
    ...typographyTokens.h1,
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: Spacing.sm,
  },
  tagline: {
    ...typographyTokens.body,
    color: colors.textMuted,
    textAlign: 'center',
  },
  buttonContainer: {
    gap: 12,
  },
  primaryButton: {
    backgroundColor: colors.accent,
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
    alignItems: 'center',
  },
  primaryButtonText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    fontWeight: '600',
    color: colors.textOnAccent,
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
    alignItems: 'center',
  },
  secondaryButtonText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  accessNote: {
    marginTop: Spacing.md,
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 18,
  },

  });
