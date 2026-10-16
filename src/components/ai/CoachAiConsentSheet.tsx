/**
 * CoachAiConsentSheet (COACH-AI-CONSENT, owner ruling op 2): the one request a coach answers before
 * Roman sends what they type, and their coaching notes, to Anthropic (Apple 5.1.2(i)). The
 * AiConsentSheet presentation (its styles, the shared PrimaryButton / TextLink) with Roman's face,
 * CAC-1 as the title, CAC-2 and CAC-3. Allow grants and plays HapticService.success(); Not now and
 * the Android back gesture record "Not now" (kept by the server only while never asked) and close.
 * A grant that is not saved says so in the sheet's existing words, with Try again. Opened once at app
 * open (CoachAiConsentHost), from Roman's off state (RomanConsentGate), a coach AI refusal
 * (AiRefusalNotice) and the Settings switch (CoachRomanSwitch).
 */
import React, { useState } from 'react';
import { Modal, Text, View } from 'react-native';
import RomanAvatar from '../roman/RomanAvatar';
import { AI_CONSENT_SHEET_COPY, makeStyles } from './AiConsentSheet';
import { coachAiConsentApi, type CoachAiConsentApi } from '../../api/coachAiConsentApi';
import { COACH_AI_CONSENT_COPY as COPY } from '../../lib/ai/coachAiConsentCopy';
import { HapticService } from '../../ui/haptics/haptics.service';
import { useTheme } from '../../theme/ThemeProvider';
import { footerBottomPadding, Headline, PrimaryButton, TextLink, useScreenInsets } from '../../ui';
import { logger } from '../../utils/logger';

export interface CoachAiConsentSheetProps {
  visible: boolean;
  /** After a live grant is on file. */
  onGranted: () => void;
  /** After Not now, the back gesture or Close. */
  onClose: () => void;
  /** Injected in tests. */
  api?: Pick<CoachAiConsentApi, 'grant' | 'decline'>;
  testID?: string;
}

export default function CoachAiConsentSheet({
  visible,
  onGranted,
  onClose,
  api = coachAiConsentApi,
  testID = 'coach-ai-consent-sheet',
}: CoachAiConsentSheetProps): React.ReactElement {
  const styles = makeStyles(useTheme().colors);
  const insets = useScreenInsets();
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const close = () => {
    setFailed(false);
    onClose();
  };
  const notNow = () => {
    void api.decline().then((out) => {
      if (out.kind !== 'ok') logger.warn('CoachAiConsentSheet.decline', out.kind);
    });
    close();
  };
  const allow = async () => {
    setSaving(true);
    const out = await api.grant();
    setSaving(false);
    setFailed(!(out.kind === 'ok' && out.status.granted));
    if (out.kind === 'ok' && out.status.granted) {
      void HapticService.success();
      onGranted();
    } else logger.warn('CoachAiConsentSheet.grant', out.kind);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={saving ? () => undefined : failed ? close : notNow}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { paddingBottom: footerBottomPadding(insets.bottom) }]} testID={testID} accessibilityViewIsModal>
          <View style={styles.title}>
            <RomanAvatar size={40} />
          </View>
          <Headline level="h2" style={styles.title}>
            {COPY.title}
          </Headline>
          <Text
            style={failed ? styles.message : styles.paragraph}
            accessibilityRole={failed ? 'alert' : undefined}
            testID={`${testID}-${failed ? 'failed' : 'paragraph'}`}
          >
            {failed ? AI_CONSENT_SHEET_COPY.unavailable : COPY.paragraph}
          </Text>
          <PrimaryButton
            label={failed ? AI_CONSENT_SHEET_COPY.tryAgain : COPY.allow}
            onPress={() => void allow()}
            loading={saving}
            style={styles.primary}
            testID={`${testID}-allow`}
          />
          <TextLink
            label={failed ? AI_CONSENT_SHEET_COPY.close : COPY.notNow}
            onPress={failed ? close : notNow}
            disabled={saving}
            tone="accent"
            underline={false}
            style={styles.secondary}
            testID={`${testID}-${failed ? 'close' : 'not-now'}`}
          />
        </View>
      </View>
    </Modal>
  );
}
