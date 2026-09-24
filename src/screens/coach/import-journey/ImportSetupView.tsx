import React, { useState } from 'react';
import { I18nManager, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CUSTOM_PLATFORM_ID, IMPORT_PLATFORMS, findImportPlatform } from '../../../constants/importPlatforms';
import { useTheme } from '../../../theme/useTheme';
import { radius, spacing, typography } from '../../../theme/tokens';
import { safeImportLoginUrl } from '../../../utils/safeImportLoginUrl';
import { importJourneyCopy as t } from './importJourneyCopy';
import { ImportJourneyAction, ImportJourneyPortrait, ui, useImportHeadingFocus } from './importJourneyUI';

type SetupPresentation = {
  romanEnabled: boolean;
  onBack: () => void;
  onLater: () => void;
  /** Explicit user entry only; a rerender does not request focus again. */
  focusOnMount?: boolean;
};
type SourceInputs = {
  selectedSourceId: string | null;
  customSourceUrl: string;
  validation: 'idle' | 'invalid';
  onSourceChange: (id: string) => void;
  onCustomSourceChange: (text: string) => void;
  onCustomSourceBlur: () => void;
  onContinue: () => void;
};

/** UI inputs only. These are not backend DTOs, setup states, or eligibility. */
export type ImportSetupViewProps = SetupPresentation & (
  | ({ step: 'source' } & SourceInputs)
  | ({ step: 'customSource' } & SourceInputs & { selectedSourceId: typeof CUSTOM_PLATFORM_ID })
  | { step: 'computerHandoff'; selectedSourceId: string }
);

export function ImportSetupView(props: ImportSetupViewProps) {
  const { semanticColors: c } = useTheme();
  const insets = useSafeAreaInsets();
  const headingRef = useImportHeadingFocus(props.step, props.focusOnMount ?? false);
  const [inputFocused, setInputFocused] = useState(false);
  const selected = props.selectedSourceId ? findImportPlatform(props.selectedSourceId) : undefined;
  const customValid = props.step === 'customSource' && safeImportLoginUrl(props.customSourceUrl) !== null;
  const canContinue = props.step === 'source' ? selected != null : customValid;
  const invalid = props.step === 'customSource' && props.validation === 'invalid' && !customValid;

  return (
    <KeyboardAvoidingView
      style={[styles.shell, { backgroundColor: c.bgPrimary }]}
      enabled={props.step === 'customSource'}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
      >
        <View style={[styles.content, {
          paddingTop: Math.max(insets.top, spacing.lg),
          paddingBottom: Math.max(insets.bottom, spacing.lg) + spacing.lg,
          paddingStart: Math.max(I18nManager.isRTL ? insets.right : insets.left, spacing.xl),
          paddingEnd: Math.max(I18nManager.isRTL ? insets.left : insets.right, spacing.xl),
        }]}>
          <View style={styles.header}>
            <View style={styles.back}><ImportJourneyAction label={t('common.back')} onPress={props.onBack} /></View>
            <Text style={[typography.bodyMd, styles.headerTitle, ui.text, { color: c.textPrimary }]}>{t('common.setupTitle')}</Text>
          </View>
          <View style={styles.introduction}>
            {props.romanEnabled && <ImportJourneyPortrait />}
            <Text ref={headingRef} accessibilityRole="header" style={[typography.h1, ui.text, { color: c.textPrimary }]}>
              {t(props.step === 'computerHandoff' ? 'handoff.title' : 'source.title')}
            </Text>
            {props.step === 'computerHandoff' && selected && (
              <Text style={[typography.bodyMd, ui.text, { color: c.textPrimary }]}>
                {t('handoff.source', { sourceName: selected.label })}
              </Text>
            )}
            <Text style={[typography.body, ui.text, { color: c.textPrimary }]}>
              {t(props.step === 'computerHandoff' ? 'handoff.body' : 'source.body')}
            </Text>
          </View>
          {props.step === 'computerHandoff' ? <>
            <View style={styles.steps}>
              {(['handoff.stepOne', 'handoff.stepTwo', 'handoff.stepThree'] as const).map((key, index) => (
                <View key={key} style={styles.instruction}>
                  <Text accessible={false} importantForAccessibility="no" style={[typography.bodyMd, { color: c.textMuted }]}>{index + 1}</Text>
                  <Text style={[typography.body, styles.flexText, ui.text, { color: c.textPrimary }]}>{t(key)}</Text>
                </View>
              ))}
            </View>
            <ImportJourneyAction label={t('handoff.noComputer')} onPress={props.onLater} />
          </> : <>
            <View accessibilityRole="radiogroup" style={ui.actions}>
              {IMPORT_PLATFORMS.map((platform) => (
                <SourceChoice key={platform.id} label={platform.label} selected={props.selectedSourceId === platform.id} onPress={() => props.onSourceChange(platform.id)} />
              ))}
            </View>
            {props.step === 'customSource' && (
              <View style={styles.custom}>
                <Text nativeID="import-site-label" style={[typography.bodyMd, ui.text, { color: c.textPrimary }]}>{t('source.customLabel')}</Text>
                <View style={[ui.focusFrame, { borderColor: inputFocused ? c.textPrimary : 'transparent' }]}>
                  <TextInput
                    accessibilityLabel={t('source.customLabel')}
                    accessibilityLabelledBy="import-site-label"
                    accessibilityHint={t(invalid ? 'source.invalid' : 'source.customHint')}
                    value={props.customSourceUrl}
                    onChangeText={props.onCustomSourceChange}
                    onFocus={() => setInputFocused(true)}
                    onBlur={() => { setInputFocused(false); props.onCustomSourceBlur(); }}
                    keyboardType="url"
                    autoCapitalize="none"
                    autoCorrect={false}
                    spellCheck={false}
                    autoComplete="off"
                    multiline
                    scrollEnabled={false}
                    style={[typography.body, styles.input, { color: c.textPrimary, backgroundColor: c.bgSurface, borderColor: c.textMuted }]}
                  />
                </View>
                <Text style={[typography.bodySmall, ui.text, { color: c.textMuted }]}>{t('source.customHint')}</Text>
                <Text style={[typography.bodySmall, ui.text, { color: c.textMuted }]}>{t('source.noCredentials')}</Text>
                {invalid && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={[typography.bodySmall, ui.text, { color: c.textPrimary }]}>{t('source.invalid')}</Text>}
              </View>
            )}
            <Text style={[typography.bodySmall, ui.text, { color: c.textMuted }]}>{t('source.note')}</Text>
            <View style={ui.actions}>
              <ImportJourneyAction primary label={t('source.continue')} disabled={!canContinue} hint={!canContinue ? t(props.step === 'customSource' ? (invalid ? 'source.invalid' : 'source.customHint') : 'source.body') : undefined} onPress={props.onContinue} />
              <ImportJourneyAction label={t('common.later')} onPress={props.onLater} />
            </View>
          </>}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function SourceChoice({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const { semanticColors: c } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={[ui.focusFrame, { borderColor: focused ? c.textPrimary : 'transparent' }]}>
      <Pressable
        accessibilityRole="radio"
        accessibilityLabel={label}
        accessibilityState={{ checked: selected, selected }}
        onPress={onPress}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={({ pressed }) => [styles.source, { backgroundColor: pressed ? c.disabledBg : c.bgSurface, borderColor: selected ? c.textPrimary : c.textMuted }]}
      >
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.radio, { borderColor: c.textPrimary }]}>
          {selected && <View style={[styles.radioDot, { backgroundColor: c.textPrimary }]} />}
        </View>
        <Text style={[typography.bodyMd, styles.flexText, ui.text, { color: c.textPrimary }]}>{label}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1 },
  scrollContent: { flexGrow: 1, alignItems: 'center' },
  content: { width: '100%', maxWidth: 560, gap: spacing.xl },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  back: { maxWidth: '45%', flexShrink: 1 },
  headerTitle: { flex: 1 },
  introduction: { gap: spacing.md },
  source: { minHeight: 56, minWidth: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.lg, padding: spacing.lg, borderWidth: 1, borderRadius: radius.lg },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 8, height: 8, borderRadius: 4 },
  flexText: { flex: 1, flexShrink: 1 },
  custom: { gap: spacing.sm },
  input: { minHeight: 48, minWidth: 48, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, textAlign: 'left', writingDirection: 'ltr' },
  steps: { gap: spacing.xl },
  instruction: { flexDirection: 'row', gap: spacing.lg, alignItems: 'flex-start' },
});
