/**
 * K6 Your personal link (prototype 83): the coach's real join link (GET /coaches/me/invite-link) as a 240 pt QR (CodeQr,
 * dark on light), the printed link and the code. Share (system sheet), Copy, Later. Sharing or copying sets `link_shared`
 * and ticks the Overview checklist; a failed load names the problem and offers Try again (Later still moves on).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Share, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { PrimaryButton, TextLink } from '../../../../ui';
import { useTheme } from '../../../../theme/ThemeProvider';
import { layout, lightTokens, radius, spacing, typography } from '../../../../theme/tokens';
import { coachSetupApi, type InviteLink } from '../../../../api/coachSetupApi';
import { describeError, type FriendlyError } from '../../../../lib/coachSetup/errors';
import { inviteSharedKey } from '../../../../lib/coachSetup/setupStatus';
import { prefsStorage } from '../../../../storage/mmkv';
import { useCurrentUser } from '../../../../hooks/useCurrentUser';
import { RomanLine } from '../../../consultation/components';
import { CoachStepFrame } from '../CoachStepFrame';
import type { CoachStepProps } from '../types';
import CodeQr from '../../../../components/coach/CodeQr';
import { K6_COPY, displayUrl, shareMessage } from './practiceCopy';

/** Coaches whose link loaded on this phone this session (K8 only claims "ready" for them). */
const loadedFor = new Set<string>();
export const linkLoadedFor = (coachId: string | null | undefined): boolean => !!coachId && loadedFor.has(coachId);

type Load = { kind: 'loading' } | { kind: 'ready'; link: InviteLink } | { kind: 'error'; error: FriendlyError };

export default function K6PersonalLink({ setAnswers, onNext, onBack, onFinishLater, progress, eyebrow }: CoachStepProps) {
  const { semanticColors: sc } = useTheme();
  const user = useCurrentUser();
  const coachId = user?.id ?? null;
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [copied, setCopied] = useState(false);
  const [actionError, setActionError] = useState<FriendlyError | null>(null);
  const alive = useRef(true);

  useEffect(() => () => {
    alive.current = false;
  }, []);

  const fetchLink = useCallback(async () => {
    setLoad({ kind: 'loading' });
    try {
      const link = await coachSetupApi.inviteLink();
      if (coachId) loadedFor.add(coachId);
      if (alive.current) setLoad({ kind: 'ready', link });
    } catch (err) {
      if (alive.current) setLoad({ kind: 'error', error: describeError(err, 'load your link') });
    }
  }, [coachId]);

  useEffect(() => {
    void fetchLink();
  }, [fetchLink]);

  const markShared = useCallback(() => {
    setAnswers({ link_shared: true });
    if (coachId) void prefsStorage.set(inviteSharedKey(coachId), 'true').catch(() => undefined);
  }, [coachId, setAnswers]);

  const share = useCallback(async () => {
    if (load.kind !== 'ready') return;
    setActionError(null);
    try {
      const result = await Share.share({ message: shareMessage(load.link.url) });
      if (result.action === Share.sharedAction) {
        markShared();
        if (alive.current) onNext();
      }
    } catch (err) {
      if (alive.current) setActionError(describeError(err, 'open the share sheet'));
    }
  }, [load, markShared, onNext]);

  const copy = useCallback(async () => {
    if (load.kind !== 'ready') return;
    setActionError(null);
    try {
      await Clipboard.setStringAsync(load.link.url);
      markShared();
      if (!alive.current) return;
      setCopied(true);
      AccessibilityInfo.announceForAccessibility?.('Link copied');
    } catch (err) {
      if (alive.current) setActionError(describeError(err, 'copy the link'));
    }
  }, [load, markShared]);

  const footer =
    load.kind === 'error' ? (
      <>
        <PrimaryButton label={K6_COPY.retry} onPress={() => void fetchLink()} testID="k6-retry" />
        <TextLink label={K6_COPY.later} onPress={onNext} testID="k6-later" />
      </>
    ) : (
      <>
        <PrimaryButton
          label={K6_COPY.share}
          onPress={() => void share()}
          disabled={load.kind !== 'ready'}
          testID="k6-share"
        />
        <View style={styles.links}>
          <TextLink
            label={copied ? K6_COPY.copied : K6_COPY.copy}
            tone="accent"
            onPress={() => void copy()}
            disabled={load.kind !== 'ready'}
            testID="k6-copy"
          />
          <TextLink label={K6_COPY.later} onPress={onNext} testID="k6-later" />
        </View>
      </>
    );

  return (
    <CoachStepFrame
      progress={progress}
      eyebrow={eyebrow}
      headline={K6_COPY.question}
      onBack={onBack}
      onFinishLater={onFinishLater}
      footer={footer}
      testID="coach-step-K6"
    >
      {load.kind === 'loading' ? (
        <View style={styles.loading} testID="k6-loading">
          <ActivityIndicator color={sc.accent} accessibilityLabel={K6_COPY.loading} />
        </View>
      ) : null}
      {load.kind === 'error' ? <Problem error={load.error} testID="k6-error" /> : null}
      {load.kind === 'ready' ? (
        <View style={styles.body}>
          <View style={styles.qr} testID="k6-qr">
            <CodeQr value={load.link.url} size={240} code={load.link.code} />
          </View>
          <Text style={[styles.url, { color: sc.textMuted }]} selectable testID="k6-url">
            {displayUrl(load.link.url)}
          </Text>
          <Text
            style={[styles.code, { color: sc.textPrimary }]}
            accessibilityLabel={`Invite code ${load.link.code.split('').join(' ')}`}
            testID="k6-code"
          >
            {load.link.code}
          </Text>
          <RomanLine text={K6_COPY.roman} />
        </View>
      ) : null}
      {actionError ? <Problem error={actionError} testID="k6-action-error" /> : null}
    </CoachStepFrame>
  );
}

function Problem({ error, testID }: { error: FriendlyError; testID: string }) {
  const { semanticColors: sc } = useTheme();
  return (
    <View style={styles.problem} accessibilityRole="alert" accessibilityLiveRegion="polite" testID={testID}>
      <Text style={[styles.problemTitle, { color: sc.textPrimary }]}>{error.title}</Text>
      <Text style={[styles.problemBody, { color: sc.textMuted }]}>{error.body}</Text>
      {error.requestId ? (
        <Text style={[styles.problemBody, { color: sc.textMuted }]}>Reference {error.requestId}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { marginTop: spacing.xl },
  // Always the light surface: a QR must stay dark on light in dark mode too.
  qr: {
    alignSelf: 'center',
    padding: spacing.sm,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: lightTokens.border,
    backgroundColor: lightTokens.bgSurface,
  },
  loading: { minHeight: 280, alignItems: 'center', justifyContent: 'center' },
  url: { ...typography.bodySmall, textAlign: 'center', marginTop: spacing.md },
  code: { ...typography.h3, textAlign: 'center', marginTop: spacing.xs, letterSpacing: 2, fontVariant: ['tabular-nums'] },
  links: { flexDirection: 'row', justifyContent: 'center', gap: layout.gutter },
  problem: { marginTop: spacing.xl, gap: spacing.xs },
  problemTitle: { ...typography.bodyMd },
  problemBody: { ...typography.bodySmall },
});
