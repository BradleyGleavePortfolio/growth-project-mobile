import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  SafeAreaView,
  Linking,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AuthStackParamList } from '../../navigation/AuthNavigator';
// All colors from central theme — never hardcode hex values here
import { Colors, Spacing, Radius, typographyTokens } from '../../theme/index';

type Props = {
  navigation: NativeStackNavigationProp<AuthStackParamList, 'Welcome'>;
};

export default function WelcomeScreen({ navigation }: Props) {
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.background} />
      <View style={styles.container}>
        <View style={styles.logoContainer}>
          <View style={styles.logoIcon}>
            <Text style={styles.logoIconText}>GP</Text>
          </View>
          <Text style={styles.title}>The Growth Project</Text>
          <Text style={styles.tagline}>
            The work is quiet. The results are not.
          </Text>
        </View>

        {/* Round 3: accessibility labels on primary CTAs */}
        <View style={styles.buttonContainer}>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => navigation.navigate('CreateAccount')}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Get started"
            accessibilityHint="Opens account creation"
          >
            <Text style={styles.primaryButtonText}>Get Started</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => navigation.navigate('Login')}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Log in"
            accessibilityHint="Opens sign-in screen"
          >
            <Text style={styles.secondaryButtonText}>Log In</Text>
          </TouchableOpacity>

          <Text style={styles.accessNote}>
            By invitation only. Without a code from your coach,{' '}
            <Text
              style={styles.accessLink}
              accessibilityRole="link"
              accessibilityLabel="Request access by email"
              onPress={() =>
                Linking.openURL(
                  'mailto:hello@thegrowthproject.app?subject=Request%20access%20to%20The%20Growth%20Project',
                )
              }
            >
              request access
            </Text>
            .
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  container: {
    flex: 1,
    backgroundColor: Colors.background,
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
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },
  logoIconText: {
    ...typographyTokens.h2,
    color: Colors.white,
  },
  title: {
    ...typographyTokens.h1,
    color: Colors.dark,
    textAlign: 'center',
    marginBottom: Spacing.sm,
  },
  tagline: {
    ...typographyTokens.body,
    color: Colors.textMuted,
    textAlign: 'center',
  },
  buttonContainer: {
    gap: 12,
  },
  primaryButton: {
    backgroundColor: Colors.primary,
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
    alignItems: 'center',
  },
  primaryButtonText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: Colors.white,
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  secondaryButtonText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
    fontWeight: '500',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: Colors.dark,
  },
  accessNote: {
    marginTop: Spacing.md,
    fontSize: 12,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 18,
  },
  accessLink: {
    color: Colors.primary,
    textDecorationLine: 'underline',
  },
});
