/**
 * Welcome (prototype 00 AUTH). Pre-account: no Roman here. One filled action
 * ("Get started" -> CreateAccount, where the role question comes first) and
 * one text link ("Log in" -> Login): the same two actions as before (B12).
 * The TGP wordmark replaces the old "GP" box (B11). Insets and the breathing
 * room under the status bar come from the shared Screen (B13).
 */
import React, { useMemo } from 'react';
import { StatusBar, StyleSheet, Text, View } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AuthStackParamList } from '../../navigation/AuthNavigator';
import { useTheme } from '../../theme/ThemeProvider';
import { layout, lightTokens, typography, type SemanticTokens } from '../../theme/tokens';
import { AccentRule, Headline, Lede, Overline, PrimaryButton, Screen, TextLink } from '../../ui';

type Props = {
  navigation: NativeStackNavigationProp<AuthStackParamList, 'Welcome'>;
};

export default function WelcomeScreen({ navigation }: Props) {
  const { semanticColors: colors = lightTokens, colorScheme } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Screen
      scroll={false}
      centerContent
      testID="welcome"
      header={
        <View style={styles.markRow}>
          {/* Brand mark only; the title below names the app for screen readers. */}
          <Text
            style={styles.wordmark}
            testID="welcome-wordmark"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            TGP
          </Text>
        </View>
      }
      footer={
        <>
          <PrimaryButton
            label="Get started"
            onPress={() => navigation.navigate('CreateAccount')}
            accessibilityHint="Opens account creation"
            testID="welcome-get-started"
          />
          <TextLink
            label="Log in"
            onPress={() => navigation.navigate('Login')}
            tone="ink"
            role="link"
            accessibilityHint="Opens sign-in"
            testID="welcome-log-in"
          />
        </>
      }
    >
      <StatusBar
        barStyle={colorScheme === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={colors.bgPrimary}
      />
      <Overline testID="welcome-eyebrow">Personal training, in your pocket</Overline>
      <Headline level="display" style={styles.title}>
        The Growth Project
      </Headline>
      <AccentRule />
      <Lede>A plan, daily targets, and a coach who knows you.</Lede>
    </Screen>
  );
}

const makeStyles = (colors: SemanticTokens) =>
  StyleSheet.create({
    markRow: { paddingHorizontal: layout.gutter, minHeight: layout.touchMin, justifyContent: 'center' },
    wordmark: {
      ...typography.h3,
      letterSpacing: 4,
      color: colors.textPrimary,
    },
    title: { marginTop: 12 },
  });
