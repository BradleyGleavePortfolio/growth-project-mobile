/**
 * Share outside the app (SHARE-A): the card as drawn becomes a PNG on the phone (no server, so it works offline) and
 * opens the phone's share options. No success haptic: the app cannot know whether the person finished. A failure is
 * logged, gives the error haptic and returns false so the caller says so in place (MOCK-SHARE-46); never an alert.
 */
import type React from 'react';
import type { View } from 'react-native';
import * as Sharing from 'expo-sharing';
import { track } from '../../lib/analytics';
import { AnalyticsEvents, type ReferralShareCardSharedProps } from '../../analytics/events';
import { HapticService } from '../../ui/haptics/haptics.service';
import { errorMessage } from '../../types/common';
import { logger } from '../../utils/logger';

type CaptureRefFn = (ref: React.RefObject<View | null>, options?: Record<string, unknown>) => Promise<string>;

/** Lazy: react-native-view-shot needs a native build (not Expo Go), and Jest mocks apply before the first call. */
function getCaptureRef(): CaptureRefFn | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
    return (require('react-native-view-shot') as { captureRef?: CaptureRefFn }).captureRef;
  } catch {
    return undefined;
  }
}

export async function sharePicture(
  ref: React.RefObject<View | null>,
  card: Omit<ReferralShareCardSharedProps, 'destination'>,
  dialogTitle: string,
): Promise<boolean> {
  try {
    const capture = getCaptureRef();
    if (!capture || !(await Sharing.isAvailableAsync())) throw new Error('picture sharing is not available in this build');
    const uri = await capture(ref, { format: 'png', quality: 1, result: 'tmpfile' });
    await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle, UTI: 'public.png' });
    const props: ReferralShareCardSharedProps = { ...card, destination: 'native_share_sheet' };
    track(AnalyticsEvents.REFERRAL_SHARE_CARD_SHARED, props as unknown as Record<string, unknown>);
    return true;
  } catch (err) {
    logger.warn('share', 'share picture failed', { reason: errorMessage(err, 'share picture failed') });
    void HapticService.error();
    return false;
  }
}
