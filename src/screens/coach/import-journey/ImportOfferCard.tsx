import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../../theme/useTheme';
import { radius, spacing, typography } from '../../../theme/tokens';
import { ImportAddressForm, importJourneyCopy as t, importOfferQuestion } from './importJourneyCopy';
import { ImportJourneyAction, ImportJourneyPortrait, ui, useImportHeadingFocus } from './importJourneyUI';

type OfferPresentation = {
  romanEnabled: boolean;
  addressForm?: ImportAddressForm;
  /** Only true for entry caused by an explicit user action, never a home impression. */
  focusOnMount?: boolean;
};

export type ImportOfferCardProps = OfferPresentation & (
  | { variant: 'question'; onYes: () => void; onStartingFresh: () => void; onLater: () => void }
  | { variant: 'value'; onImportRecords: () => void; onBack: () => void; onLater: () => void }
  | { variant: 'resume'; onResume: () => void }
);

/** Controlled inline card. Its host supplies scrolling and owns all decisions. */
export function ImportOfferCard(props: ImportOfferCardProps) {
  const { semanticColors: c } = useTheme();
  const headingRef = useImportHeadingFocus(props.variant, props.focusOnMount ?? false);
  return (
    <View style={[styles.card, props.variant === 'resume' && styles.resume, { backgroundColor: c.bgSurface, borderColor: c.border }]}>
      {props.romanEnabled && <ImportJourneyPortrait />}
      {props.variant !== 'resume' && (
        <Text ref={headingRef} accessibilityRole="header" style={[typography.h2, ui.text, { color: c.textPrimary }]}>
          {props.variant === 'question' ? importOfferQuestion(props.romanEnabled, props.addressForm) : t('offer.value')}
        </Text>
      )}
      <View style={[ui.actions, props.variant === 'resume' && styles.resumeAction]}>
        {props.variant === 'question' && <>
          <ImportJourneyAction primary label={t('offer.yes')} onPress={props.onYes} />
          <ImportJourneyAction label={t('offer.fresh')} onPress={props.onStartingFresh} />
          <ImportJourneyAction label={t('common.later')} onPress={props.onLater} />
        </>}
        {props.variant === 'value' && <>
          <ImportJourneyAction primary label={t('common.importRecords')} onPress={props.onImportRecords} />
          <ImportJourneyAction label={t('common.later')} onPress={props.onLater} />
          <ImportJourneyAction label={t('common.back')} onPress={props.onBack} />
        </>}
        {props.variant === 'resume' && <ImportJourneyAction label={t('offer.resume')} onPress={props.onResume} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  resume: { flexDirection: 'row', alignItems: 'center' },
  resumeAction: { flex: 1 },
  card: { padding: spacing.lg, gap: spacing.lg, borderWidth: 1, borderRadius: radius.lg, width: '100%', maxWidth: 560, alignSelf: 'center' },
});
