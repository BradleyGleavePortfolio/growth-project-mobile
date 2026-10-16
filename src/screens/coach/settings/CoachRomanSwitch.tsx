/**
 * COACH-AI-CONSENT (owner ruling op 2 item 4): Settings > Privacy, the coach's own Roman switch
 * (CAC-4). On = a live grant. On opens the same request (CoachAiConsentSheet); off withdraws at once
 * (DELETE /me/ai-consent/coach), from the next request. Read again on every focus; hidden until the
 * status loads. A withdrawal that is not saved puts the switch back and says so.
 */
import React, { useContext, useEffect, useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { NavigationContext } from '@react-navigation/native';
import CoachAiConsentSheet from '../../../components/ai/CoachAiConsentSheet';
import { AI_CONSENT_SHEET_COPY } from '../../../components/ai/AiConsentSheet';
import { coachAiConsentApi, type CoachAiConsentApi } from '../../../api/coachAiConsentApi';
import { COACH_AI_CONSENT_COPY as COPY } from '../../../lib/ai/coachAiConsentCopy';
import type { ThemeColors } from '../../../theme/ThemeProvider';
import type { SettingsStyles } from './styles';

export function CoachRomanSwitch({ colors, styles, api = coachAiConsentApi }: { colors: ThemeColors; styles: SettingsStyles; api?: CoachAiConsentApi }) {
  const navigation = useContext(NavigationContext);
  const [on, setOn] = useState<boolean | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    const read = () => {
      void api.getStatus().then((out) => live && out.kind === 'ok' && setOn(out.status.granted));
    };
    read();
    const stop = typeof navigation?.addListener === 'function' ? navigation.addListener('focus', read) : undefined;
    return () => {
      live = false;
      stop?.();
    };
  }, [api, navigation]);

  if (on === null) return null;
  const turnOff = async () => {
    setBusy(true);
    setOn(false);
    const out = await api.withdraw();
    const saved = out.kind === 'ok' && !out.status.granted;
    setBusy(false);
    setOn(!saved);
    setFailed(!saved);
  };

  return (
    <>
      <View style={styles.row} testID="coach-settings-roman-ai">
        <View style={{ flex: 1 }}>
          <Text style={styles.rowLabel}>{COPY.switchLabel}</Text>
          <Text style={styles.rowSubLabel}>{COPY.switchHint}</Text>
        </View>
        <Switch
          value={on}
          onValueChange={(next) => {
            setFailed(false);
            if (next) setAsking(true);
            else void turnOff();
          }}
          disabled={busy}
          trackColor={{ false: colors.border, true: colors.primary }}
          thumbColor={colors.white}
          accessibilityRole="switch"
          accessibilityLabel={COPY.switchLabel}
          accessibilityHint={COPY.switchHint}
          accessibilityState={{ checked: on, disabled: busy }}
          testID="coach-settings-roman-ai-switch"
        />
      </View>
      {failed ? (
        <Text style={[styles.rowSubLabel, { paddingHorizontal: 16, paddingBottom: 12 }]} accessibilityRole="alert" testID="coach-settings-roman-ai-failed">
          {AI_CONSENT_SHEET_COPY.unavailable}
        </Text>
      ) : null}
      <CoachAiConsentSheet
        visible={asking}
        api={api}
        onGranted={() => {
          setAsking(false);
          setOn(true);
        }}
        onClose={() => setAsking(false)}
        testID="coach-settings-roman-ai-sheet"
      />
    </>
  );
}
