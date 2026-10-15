/**
 * AgeCheckScreen (AGEGATE16, owner ruling #C8-UNDER18-B): a client who
 * reached the app without a date of birth on file (an earlier build's setup,
 * or any way in that skipped the consultation) is asked once before
 * entering. It is the consultation's own B2 question ("When were you born?")
 * and, under 16, its calm final stop screen (prototype 45), so there is no
 * new wording. The chapter eyebrow is left off: this is not a chapter.
 * Continue saves only the date of birth (PUT /profile, the same field the
 * consultation fills) and opens the app; under 16 nothing is saved.
 */
import React, { useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';
import QuestionScreen from './QuestionScreen';
import { screenById } from '../../lib/consultation/definitions';
import type { Answers, ScreenDef } from '../../lib/consultation/types';
import { profileApi } from '../../services/api';
import { patchUserCache } from '../../lib/userCache';
import { errorMessage } from '../../types/common';
import { HapticService } from '../../ui/haptics/haptics.service';
import { logger } from '../../utils/logger';
import { settleAgeConfirmation } from '../../lib/ageGate';

const AGE_SCREEN: ScreenDef = { ...(screenById('B2') as ScreenDef), eyebrow: undefined };

export default function AgeCheckScreen({ onConfirmed }: { onConfirmed: () => void }) {
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
    />
  );
}
