/**
 * Settings > Privacy > Coach sharing: one toggle per kind of log the coach
 * can see (GET /consent/me; each toggle saves at once via POST
 * /consent/grant | revoke and goes back with a specific line on failure).
 * Rows say "Shared" / "Not shared" in words. The owner-account line is
 * hidden only when the server says owner_access: false (B-451-1). Under the
 * switches, one line says connected devices are not covered by them, with the
 * Connected devices row (FW-BODY B2).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, NavigationProp, ParamListBase } from '@react-navigation/native';
import HapticPressable from '../../components/HapticPressable';
import { featureFlags } from '../../config/featureFlags';
import { isAndroidHealthConnectEnabled } from '../../config/healthConnect';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { lightTap, warningTap } from '../../utils/haptics';
import { COACH_SHARING_LABELS, COACH_SHARING_SCOPES, readCoachSharing, setCoachSharing } from '../../api/coachSharingApi';
import type { CoachSharingRead, CoachSharingScope } from '../../api/coachSharingApi';
import { coachSharingCopy as copy, ownerAccessNote } from '../../components/coachSharing/coachSharingCopy';

type Load = { kind: 'loading' } | CoachSharingRead;

/** Same rule as the More screen's "Connected devices" row (MoreScreen.tsx showsWearableRows). */
function showsConnectedDevices(): boolean {
  return featureFlags.clientTutorial || Platform.OS === 'ios' || isAndroidHealthConnectEnabled();
}

export default function CoachSharingScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [saving, setSaving] = useState<CoachSharingScope | null>(null);
  const [failed, setFailed] = useState<CoachSharingScope | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const read = useCallback(async () => {
    setLoad({ kind: 'loading' });
    const out = await readCoachSharing();
    if (mounted.current) setLoad(out);
  }, []);
  useEffect(() => {
    void read();
  }, [read]);

  const toggle = useCallback(
    async (scope: CoachSharingScope, on: boolean) => {
      if (load.kind !== 'ok' || saving) return;
      const before = load.state;
      lightTap();
      setFailed(null);
      setSaving(scope);
      setLoad({ kind: 'ok', state: { ...before, shared: { ...before.shared, [scope]: on } } });
      const ok = await setCoachSharing(before.coachId, scope, on);
      if (!mounted.current) return;
      setSaving(null);
      if (!ok) {
        warningTap();
        setFailed(scope);
        setLoad({ kind: 'ok', state: before });
      }
    },
    [load, saving],
  );

  const note = load.kind === 'ok' ? ownerAccessNote(load.state.ownerAccess) : null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} testID="coach-sharing-screen">
      {load.kind === 'loading' ? (
        <ActivityIndicator color={colors.primary} accessibilityLabel={copy.loading} testID="coach-sharing-loading" />
      ) : load.kind === 'no_coach' ? (
        <Text style={styles.body} testID="coach-sharing-no-coach">{copy.noCoach}</Text>
      ) : load.kind === 'error' ? (
        <View style={styles.card} testID="coach-sharing-load-error">
          <Text style={styles.body}>{copy.loadFailed}</Text>
          <HapticPressable intent="light" style={styles.button} onPress={() => void read()} accessibilityRole="button" accessibilityLabel={copy.retry}>
            <Text style={styles.buttonText}>{copy.retry}</Text>
          </HapticPressable>
        </View>
      ) : (
        <>
          <Text style={styles.body}>{copy.intro}</Text>
          {note ? <Text style={styles.caption} testID="coach-sharing-owner-note">{note}</Text> : null}
          <View style={styles.card}>
            {COACH_SHARING_SCOPES.map((scope, i) => {
              const label = COACH_SHARING_LABELS[scope];
              const on = load.state.shared[scope];
              return (
                <View key={scope}>
                  {i > 0 ? <View style={styles.divider} /> : null}
                  <View style={styles.row}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowLabel}>{label}</Text>
                      <Text style={styles.caption} testID={`coach-sharing-state-${scope}`}>{on ? copy.on : copy.off}</Text>
                    </View>
                    <Switch
                      value={on}
                      onValueChange={(v) => void toggle(scope, v)}
                      disabled={saving !== null}
                      accessibilityLabel={`${label} shared with your coach`}
                      accessibilityState={{ checked: on, disabled: saving !== null, busy: saving === scope }}
                      testID={`coach-sharing-toggle-${scope}`}
                      trackColor={{ true: colors.primary, false: colors.border }}
                    />
                  </View>
                  {failed === scope ? <Text style={styles.error} accessibilityLiveRegion="polite">{copy.rowFailed(label)}</Text> : null}
                </View>
              );
            })}
          </View>
          {showsConnectedDevices() ? (
            <View testID="coach-sharing-devices">
              <Text style={styles.caption}>{copy.devicesNote}</Text>
              <HapticPressable
                intent="light"
                style={styles.link}
                onPress={() => navigation.navigate('Connections')}
                accessibilityRole="button"
                accessibilityLabel={copy.devicesLink}
                accessibilityHint={copy.devicesLinkHint}
                testID="coach-sharing-devices-link"
              >
                <Text style={styles.rowLabel}>{copy.devicesLink}</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
              </HapticPressable>
            </View>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

function makeStyles(c: ThemeColors) {
  const text = { fontFamily: 'Inter_400Regular', color: c.textPrimary } as const;
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    content: { padding: 24, paddingBottom: 48, gap: 16 },
    card: { borderWidth: 1, borderColor: c.border, borderRadius: 4, padding: 16, gap: 12, backgroundColor: c.surface },
    row: { flexDirection: 'row', alignItems: 'center', minHeight: 52, gap: 12 },
    rowLabel: { fontFamily: 'Inter_500Medium', fontSize: 15, color: c.textPrimary },
    body: { ...text, fontSize: 15, lineHeight: 22 },
    caption: { ...text, fontSize: 13, lineHeight: 19, color: c.textSecondary },
    error: { ...text, fontSize: 13, lineHeight: 19, color: c.error, marginTop: 4 },
    divider: { height: 1, backgroundColor: c.divider, marginBottom: 12 },
    link: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, marginTop: 8 },
    button: { minHeight: 44, borderRadius: 4, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.border },
    buttonText: { fontFamily: 'Inter_500Medium', fontSize: 15, color: c.textPrimary },
  });
}
