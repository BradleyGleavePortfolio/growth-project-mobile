/**
 * AuthCallbackScreen — idempotent landing for `tgp://auth/callback`.
 *
 * Background (P3-4 / R21): `src/utils/googleAuth.ts` declares
 * `tgp://auth/callback` as the OAuth redirect URI. Day-to-day the URL
 * is consumed in-process by `WebBrowser.openAuthSessionAsync` and never
 * actually routes through the navigator. But if a stray click on the
 * URL arrives from outside that flow (e.g. a user re-opens the Google
 * confirmation email an hour later, or the system relays the URL after
 * the auth session has already closed), the navigator previously had
 * no screen mapping for it and the user landed nowhere.
 *
 * This screen is the idempotent landing target. On mount it routes the
 * user to a sensible place:
 *   - authenticated (has a session token) → bounce to the root, which
 *     re-runs `bootstrapAuth` and drops them on Home / Coach as before.
 *   - unauthenticated → land on Login so they can sign in fresh.
 *
 * The screen renders a minimal centered spinner while the redirect
 * happens; the user should never see it for more than a frame or two.
 *
 * Note: this stub is not yet mounted inside AuthNavigator — the
 * `RootNavigator.linking.config.screens` entry aliases the path onto
 * the already-mounted `Login` route so the URL has a real landing
 * surface today. When the auth stack is next refactored, mount this
 * component under the `AuthCallback` route and update the linking
 * config to point at it directly.
 */
import React, { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Colors } from '../../constants/colors';
import { secureStorage } from '../../services/secureStorage';

export default function AuthCallbackScreen() {
  const navigation = useNavigation<{
    reset: (state: { index: number; routes: { name: string }[] }) => void;
  }>();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await secureStorage.getItem('supabase_token');
      if (cancelled) return;
      // Either path resets the stack to a single route so the callback
      // landing cannot be re-entered via back navigation.
      navigation.reset({
        index: 0,
        routes: [{ name: token ? 'Home' : 'Login' }],
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [navigation]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={Colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background,
  },
});
