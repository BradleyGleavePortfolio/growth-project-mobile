/**
 * Apple Sign-In button — thin wrapper around the official
 * <AppleAuthentication.AppleAuthenticationButton/> so we comply with
 * Apple HIG (the button visual MUST be Apple's, not a custom one).
 *
 * Renders nothing on Android or when the iOS device does not support
 * Apple Sign-In; callers should fall back to other methods. The button
 * fires its own native press, so we just surface the press handler.
 */
import React, { useEffect, useState } from 'react';
import { Platform, StyleProp, ViewStyle } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { isAppleAuthAvailable } from '../utils/appleAuth';

interface Props {
  onPress: () => void;
  // Match the visual style to the surrounding screen. SIGN_IN for the login
  // screen, SIGN_UP for the create-account screen.
  label: 'SIGN_IN' | 'SIGN_UP' | 'CONTINUE';
  cornerRadius?: number;
  style?: StyleProp<ViewStyle>;
}

export default function AppleSignInButton({
  onPress,
  label,
  cornerRadius = 8,
  style,
}: Props) {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (Platform.OS !== 'ios') return;
      const ok = await isAppleAuthAvailable();
      if (mounted && ok) setAvailable(true);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  if (!available) return null;

  const types = AppleAuthentication.AppleAuthenticationButtonType;
  const buttonStyles = AppleAuthentication.AppleAuthenticationButtonStyle;

  const buttonType =
    label === 'SIGN_IN'
      ? types.SIGN_IN
      : label === 'SIGN_UP'
      ? types.SIGN_UP
      : types.CONTINUE;

  return (
    <AppleAuthentication.AppleAuthenticationButton
      buttonType={buttonType}
      buttonStyle={buttonStyles.BLACK}
      cornerRadius={cornerRadius}
      style={[{ width: '100%', height: 48 }, style]}
      onPress={onPress}
    />
  );
}
