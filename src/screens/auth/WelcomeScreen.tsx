/**
 * Welcome (prototype 00 AUTH). Pre-account: no Roman here. One filled action
 * ("Get started" -> CreateAccount, where the role question comes first) and
 * one text link ("Log in" -> Login): the same two actions as before (B12).
 * The TGP wordmark replaces the old "GP" box (B11). Insets and the breathing
 * room under the status bar come from the shared Screen (B13).
 */
import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StatusBar, StyleSheet, Text, View } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AuthStackParamList } from '../../navigation/AuthNavigator';
import { useTheme } from '../../theme/ThemeProvider';
import { layout, lightTokens, typography, type SemanticTokens } from '../../theme/tokens';
import { AccentRule, Headline, Lede, Overline, PrimaryButton, Screen, TextLink } from '../../ui';
import { HapticService } from '../../ui/haptics/haptics.service';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { authStyleB } from './AuthStyleB';
import { useStatusBarBand } from '../../components/StatusBarBand';

type Props = {
  navigation: NativeStackNavigationProp<AuthStackParamList, 'Welcome'>;
};

/**
 * C7 Style B (firstRunV2): forest to the top edge, with light status icons
 * only while focused. The title rises 8 pt and fades in over 250 ms (Reduce Motion: a
 * 150 ms fade only); Get started plays mediumImpact (primary CTA).
 */
function WelcomeStyleB({ navigation }: Props) {
  const { semanticColors: sc = lightTokens } = useTheme();
  useStatusBarBand(sc.surface.forestBand);
  const reduced = useReducedMotion();
  const shown = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(shown, { toValue: 1, duration: reduced ? 150 : 250, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [shown, reduced]);
  const rise = reduced ? 0 : shown.interpolate({ inputRange: [0, 1], outputRange: [8, 0] });
  const onForest = { color: sc.textOnAccent };
  return (
    <Screen
      scroll={false}
      testID="welcome"
      style={{ backgroundColor: sc.surface.forestBand }}
      contentStyle={{ justifyContent: 'flex-end' }}
      footer={
        <>
          <PrimaryButton
            label="Get started"
            tone="cream"
            haptic={false}
            onPress={() => {
              void HapticService.mediumImpact();
              navigation.navigate('CreateAccount');
            }}
            accessibilityHint="Opens account creation"
            testID="welcome-get-started"
          />
          <TextLink label="Log in" onPress={() => navigation.navigate('Login')} tone="onForest" role="link" accessibilityHint="Opens sign-in" testID="welcome-log-in" />
        </>
      }
    >
      <Overline style={{ color: sc.textOnMastheadMuted }} testID="welcome-eyebrow">Personal training, in your pocket</Overline>
      <Animated.View style={{ opacity: shown, transform: [{ translateY: rise }] }} testID="welcome-title-motion">
        <Headline level="display" style={[{ marginTop: 12 }, onForest]}>
          TGP Fitness
        </Headline>
      </Animated.View>
      <AccentRule />
      <Lede style={onForest}>A plan, daily targets, and a coach who knows you.</Lede>
    </Screen>
  );
}

export default function WelcomeScreen({ navigation }: Props) {
  if (authStyleB()) return <WelcomeStyleB navigation={navigation} />;
  return <WelcomeToday navigation={navigation} />;
}

function WelcomeToday({ navigation }: Props) {
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
        TGP Fitness
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
