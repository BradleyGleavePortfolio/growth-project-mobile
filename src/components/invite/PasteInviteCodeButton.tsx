/**
 * "Paste invite code" affordance.
 *
 * After a client installs from the App Store the deep link that carried the
 * invite code is lost (no deferred deep linking in v1). The clinic poster and
 * the /join landing page tell them to copy the code; this button reads the
 * clipboard (expo-clipboard, already a dependency, no native permission) and
 * accepts either a bare `GP-XXXX` code or a `/join/<code>` URL.
 *
 * The clipboard is only read on an explicit tap (never on mount), so iOS
 * shows its paste banner only when the user asked for it.
 */
import React, { useCallback, useState } from 'react';
import { Text, TouchableOpacity, StyleSheet } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { extractInviteCode } from '../../lib/inviteCodeInput';
import { useTheme } from '../../theme/ThemeProvider';
import { typography } from '../../theme/tokens';

export const PASTE_EMPTY_MESSAGE =
  'No invite code was found on your clipboard. Copy the code from your coach, then tap Paste again.';

interface Props {
  onCode: (code: string) => void;
  onNoCode?: (message: string) => void;
  disabled?: boolean;
  testID?: string;
}

export default function PasteInviteCodeButton({ onCode, onNoCode, disabled, testID }: Props) {
  const { colors } = useTheme();
  const [busy, setBusy] = useState(false);

  const handlePress = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const text = await Clipboard.getStringAsync();
      const code = extractInviteCode(text);
      if (code) onCode(code);
      else onNoCode?.(PASTE_EMPTY_MESSAGE);
    } catch {
      onNoCode?.(PASTE_EMPTY_MESSAGE);
    } finally {
      setBusy(false);
    }
  }, [busy, onCode, onNoCode]);

  return (
    <TouchableOpacity
      onPress={handlePress}
      disabled={disabled || busy}
      style={styles.button}
      accessibilityRole="button"
      accessibilityLabel="Paste invite code"
      accessibilityHint="Pastes an invite code or join link you copied"
      testID={testID ?? 'paste-invite-code'}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Text style={[styles.text, { color: colors.primary }]}>Paste invite code</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: { alignSelf: 'flex-start', marginTop: 8, paddingVertical: 4 },
  text: { ...typography.bodyMd },
});
