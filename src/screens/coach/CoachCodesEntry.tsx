/**
 * The coach's Codes entry (route `InviteCodes`, reached from Clients, Home,
 * Messages and Settings). GET /coach/codes decides which screen shows:
 *   - answers        -> CoachCodesScreen (create, rotate, turn off, QR, counts)
 *   - 404 (server flag FEATURE_COACH_CODE_TOOLS off, or an older backend)
 *                    -> the legacy InviteCodesScreen, unchanged
 *   - anything else  -> a retry state that says what happened
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { NavigationProp, ParamListBase } from '@react-navigation/native';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import InviteCodesScreen from './InviteCodesScreen';
import CoachCodesScreen from './CoachCodesScreen';
import {
  coachCodesApi,
  coachCodesErrorMessage,
  isCodeToolsDisabled,
  type CoachCodeList,
} from '../../api/coachCodesApi';

type State =
  | { kind: 'loading' }
  | { kind: 'tools'; list: CoachCodeList }
  | { kind: 'legacy' }
  | { kind: 'error'; message: string };

export default function CoachCodesEntry({ navigation }: { navigation: NavigationProp<ParamListBase> }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [state, setState] = useState<State>({ kind: 'loading' });

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      setState({ kind: 'tools', list: await coachCodesApi.list() });
    } catch (err) {
      setState(
        isCodeToolsDisabled(err)
          ? { kind: 'legacy' }
          : { kind: 'error', message: coachCodesErrorMessage(err, 'load') },
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.kind === 'legacy') return <InviteCodesScreen navigation={navigation} />;
  if (state.kind === 'tools') return <CoachCodesScreen initial={state.list} />;
  return (
    <View style={styles.center} testID="coach-codes-entry">
      {state.kind === 'loading' ? (
        <ActivityIndicator accessibilityLabel="Loading your codes" />
      ) : (
        <>
          <Text style={styles.message} accessibilityRole="alert">{state.message}</Text>
          <TouchableOpacity style={styles.retry} onPress={load} accessibilityRole="button" testID="coach-codes-retry">
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12, backgroundColor: c.background },
    message: { fontSize: 15, color: c.textSecondary, textAlign: 'center' },
    retry: { minHeight: 44, paddingHorizontal: 20, justifyContent: 'center', borderRadius: 10, backgroundColor: c.primary },
    retryText: { fontSize: 16, fontWeight: '600', color: c.textOnPrimary },
  });
