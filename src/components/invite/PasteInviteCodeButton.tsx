/**
 * "Paste code" affordance.
 *
 * After a client installs from the App Store the deep link that carried the
 * invite code is lost (no deferred deep linking in v1). The /join landing page
 * offers "Copy code" (INVITE-COPY-CODE) and the partner poster tells them to
 * copy it; this button reads the clipboard (expo-clipboard, already a
 * dependency, no native permission) and accepts either a bare code or a
 * `/join/<code>` URL.
 *
 * The clipboard is only read on an explicit tap (never on mount), so iOS
 * shows its paste prompt only when the user asked for it. The shared quiet
 * text action gives the 44 pt target and the forest text; one haptic per tap
 * (docs/HAPTICS.md): selection when the field fills, warning when nothing
 * usable was there.
 */
import React, { useCallback, useRef } from 'react';
import { StyleSheet } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { extractInviteCode } from '../../lib/inviteCodeInput';
import { QuietTextButton } from '../../ui/buttons/PrimaryButton';
import { HapticService } from '../../ui/haptics/haptics.service';

export const PASTE_EMPTY_MESSAGE =
  'No invite code was found on your clipboard. Copy the code from your coach, then tap Paste again.';

interface Props {
  onCode: (code: string) => void;
  onNoCode?: (message: string) => void;
  disabled?: boolean;
  testID?: string;
}

export default function PasteInviteCodeButton({ onCode, onNoCode, disabled, testID }: Props) {
  // A ref, not state: a second tap while iOS shows its paste prompt is
  // ignored without greying the label on every tap.
  const busy = useRef(false);

  const handlePress = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    let code: string | null = null;
    try {
      code = extractInviteCode(await Clipboard.getStringAsync());
    } catch {
      code = null;
    } finally {
      busy.current = false;
    }
    if (code) {
      void HapticService.selection();
      onCode(code);
    } else {
      void HapticService.warning();
      onNoCode?.(PASTE_EMPTY_MESSAGE);
    }
  }, [onCode, onNoCode]);

  return (
    <QuietTextButton
      label="Paste code"
      onPress={() => void handlePress()}
      disabled={disabled}
      accessibilityHint="Pastes an invite code or join link you copied"
      testID={testID ?? 'paste-invite-code'}
      style={styles.button}
    />
  );
}

// Text starts on the field's left edge (the shared link pads 4 pt each side).
const styles = StyleSheet.create({
  button: { paddingHorizontal: 0 },
});
