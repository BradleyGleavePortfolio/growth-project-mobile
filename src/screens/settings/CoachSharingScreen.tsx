/**
 * Settings > Privacy > Coach sharing: what the current coach sees. Owner
 * #SHARE-SIMPLE / #SHARE-JOIN: workouts, food logs, weigh-ins, check-ins and
 * habits always reach the current coach, so there are no switches here (the
 * one sharing switch is Roman and AI). GET /consent/me says whether there is
 * a coach (400 = none). Where connected devices exist, one line says how new
 * device data stops, with the Connected devices row.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, NavigationProp, ParamListBase } from '@react-navigation/native';
import HapticPressable from '../../components/HapticPressable';
import { featureFlags } from '../../config/featureFlags';
import { isAndroidHealthConnectEnabled } from '../../config/healthConnect';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { radius } from '../../theme/tokens';
import { readCoachSharing } from '../../api/coachSharingApi';
import type { CoachSharingRead } from '../../api/coachSharingApi';
import { coachSharingCopy as copy } from '../../components/coachSharing/coachSharingCopy';

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
          <Text style={styles.body} testID="coach-sharing-intro">{copy.intro}</Text>
          {showsConnectedDevices() ? (
            <View testID="coach-sharing-devices">
              <Text style={styles.caption}>{copy.devicesNote()}</Text>
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
    card: { borderWidth: 1, borderColor: c.border, borderRadius: radius.card, padding: 16, gap: 12, backgroundColor: c.surface },
    rowLabel: { fontFamily: 'Inter_500Medium', fontSize: 15, color: c.textPrimary },
    body: { ...text, fontSize: 15, lineHeight: 22 },
    caption: { ...text, fontSize: 13, lineHeight: 19, color: c.textSecondary },
    link: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, marginTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
    button: { minHeight: 44, borderRadius: radius.button, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.border },
    buttonText: { fontFamily: 'Inter_500Medium', fontSize: 15, color: c.textPrimary },
  });
}
