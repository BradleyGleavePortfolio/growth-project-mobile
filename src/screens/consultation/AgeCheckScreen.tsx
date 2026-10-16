/**
 * AgeCheckScreen (AGEGATE16, owner ruling #C8-UNDER18-B): a client who
 * reached the app without a date of birth on file (an earlier build's setup,
 * or any way in that skipped the consultation) is asked once before
 * entering. It is the consultation's own B2 question ("When were you born?")
 * and, under 16, its calm final stop screen (prototype 45), so there is no
 * new wording. The chapter eyebrow is left off: this is not a chapter.
 * Continue saves only the date of birth (PUT /profile, the same field the
 * consultation fills) and opens the app; under 16 nothing is saved.
 * FIXAGE R4: the question and the stop screen keep the ways out every
 * refused client has (the consultation's escape row, and the payment
 * lockout's data and deletion rows, which open the real screens).
 */
import React, { useMemo, useRef, useState } from 'react';
import { Alert, View } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import QuestionScreen from './QuestionScreen';
import { type AccountExits as Exits, CONSULT_SUPPORT_SUBJECT, ESCAPE_COPY, EscapeRow } from './RevealScreens';
import { useConsultationStyles } from './components';
import { TextLink } from '../../ui';
import ActionMenu, { type ActionMenuOption } from '../../components/messaging/ActionMenu';
import { SupportEmailFallback, useSupportEmail } from '../../components/support/SupportEmailFallback';
import DeleteAccountScreen from '../settings/DeleteAccountScreen';
import DataExportScreen from '../settings/DataExportScreen';
import { screenById } from '../../lib/consultation/definitions';
import type { Answers, ScreenDef } from '../../lib/consultation/types';
import { profileApi } from '../../services/api';
import { patchUserCache } from '../../lib/userCache';
import { errorMessage } from '../../types/common';
import { HapticService } from '../../ui/haptics/haptics.service';
import { logger } from '../../utils/logger';
import { settleAgeConfirmation } from '../../lib/ageGate';

const AGE_SCREEN: ScreenDef = { ...(screenById('B2') as ScreenDef), eyebrow: undefined };

const MENU: ActionMenuOption[] = [
  { key: 'export', label: 'Download my data', icon: 'download-outline' },
  { key: 'delete', label: 'Delete my account', icon: 'trash-outline', destructive: true },
  { key: 'support', label: ESCAPE_COPY.support, icon: 'mail-outline' },
  { key: 'signOut', label: ESCAPE_COPY.signOut, icon: 'log-out-outline' },
];

/** FIXAGE3 R9 (#AGE-R9-LABEL): the question's one way out, opening the four rows (training 6.2: five actions). */
function AccountAndSupport(exits: Exits) {
  const [open, setOpen] = useState(false);
  const { s, palette } = useConsultationStyles();
  const support = useSupportEmail(CONSULT_SUPPORT_SUBJECT);
  const run: Record<string, (() => void) | undefined> = {
    export: exits.onOpenDataExport,
    delete: exits.onOpenDeleteAccount,
    support: () => void support.open(),
    signOut: exits.onSignOut && (() =>
      Alert.alert(ESCAPE_COPY.signOutTitle, ESCAPE_COPY.signOutBody, [
        { text: ESCAPE_COPY.cancel, style: 'cancel' },
        { text: ESCAPE_COPY.signOut, style: 'destructive', onPress: exits.onSignOut },
      ])),
  };
  return (
    <View style={{ marginTop: 24 }}>
      <TextLink label="Account and support" onPress={() => setOpen(true)} testID="age-account-support" />
      <SupportEmailFallback handle={support} textStyle={s.body} linkColor={palette.accentText} testID="consult-support-fallback" />
      <ActionMenu visible={open} options={MENU.filter((o) => run[o.key])} onSelect={(key) => run[key]?.()} onClose={() => setOpen(false)} />
    </View>
  );
}

export default function AgeCheckScreen({ onConfirmed, ...exits }: { onConfirmed: () => void } & Exits) {
  const [answers, setAnswers] = useState<Answers>({});
  const now = useMemo(() => new Date(), []);
  const saving = useRef(false);

  const save = async (patch?: Answers) => {
    const dob = patch?.B2;
    if (typeof dob !== 'string' || saving.current) return;
    saving.current = true;
    try {
      await profileApi.update({ date_of_birth: dob });
    } catch (err) {
      saving.current = false;
      HapticService.error();
      Alert.alert(
        "Couldn't save",
        errorMessage(err, 'Profile changes were not saved. Check the connection and try again.'),
      );
      return;
    }
    try {
      await patchUserCache({ profile: { date_of_birth: dob } });
    } catch (err) {
      // RootNavigator reads it from the server instead.
      logger.warn('AgeCheckScreen', 'date of birth not cached', err);
    }
    HapticService.success();
    // FIXAGE R3: requests refused for age while this was open are sent again.
    settleAgeConfirmation(true);
    onConfirmed();
  };

  return (
    <QuestionScreen
      screen={AGE_SCREEN}
      answers={answers}
      progress={null}
      ctx={{}}
      now={now}
      onAnswer={(key, value) => setAnswers((a) => ({ ...a, [key]: value }))}
      onNext={(patch) => void save(patch)}
      onBack={null}
      onFinishLater={null}
      escape={(stopped) =>
        stopped ? <EscapeRow {...exits} /> : <AccountAndSupport {...exits} />
      }
    />
  );
}

const AgeStack = createNativeStackNavigator();

/** RootNavigator's age step: the question plus the two account screens it opens. */
export function AgeCheckNavigator({ onConfirmed, onSignOut }: { onConfirmed: () => void; onSignOut: () => void }) {
  return (
    <AgeStack.Navigator screenOptions={{ headerShown: false }}>
      <AgeStack.Screen name="AgeCheck">
        {({ navigation }) => (
          <AgeCheckScreen
            onConfirmed={onConfirmed}
            onSignOut={onSignOut}
            onOpenDataExport={() => navigation.navigate('DataExport')}
            onOpenDeleteAccount={() => navigation.navigate('DeleteAccount')}
          />
        )}
      </AgeStack.Screen>
      <AgeStack.Screen name="DeleteAccount" component={DeleteAccountScreen} />
      <AgeStack.Screen name="DataExport" component={DataExportScreen} />
    </AgeStack.Navigator>
  );
}
