/**
 * FeaturedCoachEditorScreen — owner-only editor for the coachless banner, offer, featured code and Roman's
 * scripted pitch (FeaturedCoachConfig; GET/PUT /admin/featured-coach). The featured coach must be a coach
 * account (the server refuses owner and client accounts): the configured coach, else the coach account with
 * the owner's own name, is preselected. The live preview renders the same banner and Roman card clients see.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { typography, radius, spacing } from '../../../theme/tokens';
import { useTheme } from '../../../theme/ThemeProvider';
import { useCurrentUser } from '../../../hooks/useCurrentUser';
import { priceLabel, purchasableFromCoachPackage } from '../../../lib/planTerms';
import { Banner, RomanCard } from '../../../components/coachless/CoachlessHomeSlot';
import type { CoachlessHome } from '../../../api/coachlessApi';
import {
  CAP_RANGES,
  FEATURED_LIMITS,
  featuredCoachFailureOf,
  getFeaturedCoach,
  listFeaturedCoachCandidates,
  saveFeaturedCoach,
  type CapKey,
  type FeaturedCoachCandidate,
  type FeaturedCoachOwnerView,
  type FeaturedFailure,
} from '../../../api/featuredCoachApi';
import {
  SUGGESTED_CODE,
  isFeaturedCodeShape,
  loadRefusalLine,
  pitchPrice,
  refusalField,
  saveRefusalLine,
  suggestedPitch,
} from './featuredCoachCopy';

export const featuredCoachKey = ['admin', 'featured-coach'] as const;
export const featuredCoachCandidatesKey = ['admin', 'featured-coach', 'coaches'] as const;

const CAP_LABELS: Record<CapKey, string> = {
  roman_min_hours_between: 'Hours between Roman cards',
  roman_max_per_week: 'Roman cards per week, at most',
  roman_snooze_days: 'Days hidden after "Not now"',
  roman_max_not_now: '"Not now" taps before it stops for good',
};
const CAP_KEYS: CapKey[] = ['roman_min_hours_between', 'roman_max_per_week', 'roman_snooze_days', 'roman_max_not_now'];

interface Form {
  coachId: string | null;
  code: string;
  createCode: boolean;
  packageId: string | null;
  bannerTitle: string;
  offerText: string;
  pitch: string;
  pitchEdited: boolean;
  accepting: boolean;
  romanEnabled: boolean;
  caps: Record<CapKey, string>;
}

/** The coach list, or (before the server offers it) only the configured coach. */
function coachChoices(view: FeaturedCoachOwnerView, listed: FeaturedCoachCandidate[] | null): FeaturedCoachCandidate[] {
  if (listed) return listed;
  const c = view.resolved.coach;
  if (!c) return [];
  return [{ id: c.id, name: c.name, email: null, business_name: c.business_name, packages: view.resolved.package ? [view.resolved.package] : [] }];
}

function initialForm(view: FeaturedCoachOwnerView, coaches: FeaturedCoachCandidate[], owner: { id?: string; name?: string } | null): Form {
  const cfg = view.config;
  const ownName = owner?.name?.trim().toLowerCase();
  const coachId =
    cfg?.coach_user_id ??
    coaches.find((c) => c.id === owner?.id)?.id ??
    (ownName ? coaches.find((c) => c.name?.trim().toLowerCase() === ownName)?.id : undefined) ??
    null;
  const coach = coaches.find((c) => c.id === coachId) ?? null;
  const packageId = cfg?.package_id ?? coach?.packages[0]?.id ?? null;
  const pkg = coach?.packages.find((p) => p.id === packageId) ?? null;
  const code = cfg?.code ?? SUGGESTED_CODE;
  const caps = {} as Record<CapKey, string>;
  for (const k of CAP_KEYS) caps[k] = String(cfg ? cfg[k] : CAP_RANGES[k].fallback);
  return {
    coachId,
    code,
    createCode: true,
    packageId,
    bannerTitle: cfg?.banner_title ?? view.resolved.banner_title,
    offerText: cfg?.offer_text ?? '',
    pitch: cfg?.roman_pitch_text ?? suggestedPitch(code, pkg ? pitchPrice(pkg) : null),
    pitchEdited: !!cfg?.roman_pitch_text,
    accepting: cfg?.accepting_clients ?? false,
    romanEnabled: cfg?.roman_enabled ?? false,
    caps,
  };
}

/** A cap as an integer inside its range, or null. */
function capValue(key: CapKey, raw: string): number | null {
  if (!/^\d+$/.test(raw.trim())) return null;
  const n = Number(raw.trim());
  const r = CAP_RANGES[key];
  return n >= r.min && n <= r.max ? n : null;
}

export default function FeaturedCoachEditorScreen(): React.ReactElement {
  const { colors, semanticColors: sc } = useTheme();
  const user = useCurrentUser();
  const qc = useQueryClient();
  const view = useQuery({ queryKey: featuredCoachKey, queryFn: getFeaturedCoach, retry: false });
  const list = useQuery({ queryKey: featuredCoachCandidatesKey, queryFn: listFeaturedCoachCandidates, retry: false });
  const listMissing = list.isError && featuredCoachFailureOf(list.error).status === 404;
  const listed = list.data ?? null;
  const ready = !!view.data && (list.isSuccess || listMissing);
  const coaches = useMemo(
    () => (view.data && ready ? coachChoices(view.data, listed) : []),
    [view.data, listed, ready],
  );

  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<FeaturedFailure | null>(null);
  const [localError, setLocalError] = useState<{ field: 'code' | 'caps' | 'coach'; line: string } | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    if (!form && ready && view.data) setForm(initialForm(view.data, coaches, user));
  }, [form, ready, view.data, coaches, user]);

  const coach = coaches.find((c) => c.id === form?.coachId) ?? null;
  const pkg = coach?.packages.find((p) => p.id === form?.packageId) ?? null;
  const price = pkg ? pitchPrice(pkg) : null;

  // Until the owner edits the pitch, it follows the code and the package price.
  useEffect(() => {
    if (!form || form.pitchEdited) return;
    const next = suggestedPitch(form.code.trim() || SUGGESTED_CODE, price);
    if (next !== form.pitch) setForm({ ...form, pitch: next });
  }, [form, price]);

  if (view.isError || (list.isError && !listMissing)) {
    const failed = featuredCoachFailureOf(view.isError ? view.error : list.error);
    return (
      <View style={[styles.center, { backgroundColor: sc.bgPrimary }]}>
        <Text style={[styles.body, { color: sc.textPrimary }]} testID="featured-load-error">{loadRefusalLine(failed)}</Text>
        <Pressable onPress={() => void Promise.all([view.refetch(), list.refetch()])} accessibilityRole="button" testID="featured-retry" style={styles.link}>
          <Text style={[styles.label, { color: sc.accentText }]}>Try again</Text>
        </Pressable>
      </View>
    );
  }
  if (!form) {
    return (
      <View style={[styles.center, { backgroundColor: sc.bgPrimary }]}>
        <Text style={[styles.body, { color: sc.textMuted }]}>Loading the featured coach settings.</Text>
      </View>
    );
  }

  const set = (patch: Partial<Form>) => {
    setForm({ ...form, ...patch });
    setSaved(null);
    setFailure(null);
    setLocalError(null);
  };

  const code = form.code.trim();
  const resolvedCoach = view.data?.resolved.coach ?? null;
  const accepting = form.accepting && !!coach && !!code;
  const preview: CoachlessHome = {
    eligible: true,
    coach_attached: false,
    banner: { title: form.bannerTitle.trim() || view.data?.resolved.banner_title || '', offer_text: accepting && form.offerText.trim() ? form.offerText.trim() : null, code: code || null },
    roman_card: null,
    roman_card_hidden_reason: null,
    featured_coach: coach
      ? { name: coach.name ?? 'Coach', photo_url: resolvedCoach?.id === coach.id ? resolvedCoach.photo_url : null, business_name: coach.business_name, package: pkg }
      : null,
  };
  const romanHiddenReason = !form.romanEnabled
    ? 'Roman card is off.'
    : !form.pitch.trim()
      ? 'Roman card needs pitch text.'
      : !accepting
        ? 'Roman card shows only while the coach is accepting clients.'
        : null;

  const save = async () => {
    if (saving) return;
    if (code && !isFeaturedCodeShape(code)) {
      setLocalError({ field: 'code', line: 'Codes use 3 to 32 letters, numbers and dashes, for example GP-BRADLEY.' });
      return;
    }
    if (code && !coach) {
      setLocalError({ field: 'coach', line: 'Choose the coach this code belongs to.' });
      return;
    }
    const caps = {} as Record<CapKey, number>;
    for (const k of CAP_KEYS) {
      const v = capValue(k, form.caps[k]);
      if (v === null) {
        const r = CAP_RANGES[k];
        setLocalError({ field: 'caps', line: `${CAP_LABELS[k]}: enter a whole number from ${r.min} to ${r.max}.` });
        return;
      }
      caps[k] = v;
    }
    setSaving(true);
    setFailure(null);
    setLocalError(null);
    try {
      const res = await saveFeaturedCoach({
        coach_user_id: coach?.id ?? null,
        code: code || null,
        package_id: pkg?.id ?? null,
        banner_title: form.bannerTitle.trim() || null,
        offer_text: form.offerText.trim() || null,
        roman_pitch_text: form.pitch.trim() || null,
        accepting_clients: form.accepting,
        roman_enabled: form.romanEnabled,
        ...caps,
        create_code_if_missing: form.createCode,
      });
      qc.setQueryData(featuredCoachKey, { config: res.config, resolved: res.resolved });
      const parts = ['Saved.'];
      if (res.code_created && res.config.code) parts.push(`Code ${res.config.code} was created for ${coach?.name ?? 'the coach'}.`);
      if (form.accepting && !res.resolved.accepting_clients)
        parts.push('Clients do not see the offer yet: the coach needs an active subscription and a working code.');
      setSaved(parts.join(' '));
      setForm({ ...form, code: res.config.code ?? '' });
    } catch (err) {
      setFailure(featuredCoachFailureOf(err));
    } finally {
      setSaving(false);
    }
  };

  const fieldLine = (f: 'coach' | 'code' | 'package' | 'caps') => {
    const line =
      localError?.field === f ? localError.line : failure && refusalField(failure.code) === f ? saveRefusalLine(failure) : null;
    return line ? <Text style={[styles.small, { color: colors.error }]} testID={`featured-error-${f}`} accessibilityLiveRegion="polite">{line}</Text> : null;
  };

  const input = (testID: string, value: string, onChange: (v: string) => void, max: number, multiline = false) => (
    <TextInput
      value={value}
      onChangeText={onChange}
      maxLength={max}
      multiline={multiline}
      testID={testID}
      style={[styles.input, multiline && styles.multiline, { color: sc.textPrimary, borderColor: sc.border, backgroundColor: sc.bgSurface }]}
      placeholderTextColor={sc.textMuted}
    />
  );
  const note = (testID: string, text: string) => (
    <Text style={[styles.small, styles.gap, { color: sc.textMuted }]} testID={testID}>{text}</Text>
  );
  const counter = (value: string, max: number) => (
    <Text style={[styles.small, styles.counter, { color: sc.textMuted }]}>{`${value.length}/${max}`}</Text>
  );
  const choice = (testID: string, selected: boolean, title: string, sub: string | null, onPress: () => void) => (
    <Pressable
      key={testID}
      onPress={onPress}
      testID={testID}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={[styles.choice, { borderColor: selected ? sc.accent : sc.border, backgroundColor: sc.bgSurface }]}
    >
      <Text style={[styles.label, { color: sc.textPrimary }]}>{title}</Text>
      {sub ? <Text style={[styles.small, { color: sc.textMuted }]}>{sub}</Text> : null}
    </Pressable>
  );
  const toggle = (testID: string, label: string, value: boolean, onChange: (v: boolean) => void) => (
    <View style={styles.toggle}>
      <Text style={[styles.label, styles.flex, { color: sc.textPrimary }]}>{label}</Text>
      <Switch value={value} onValueChange={onChange} testID={testID} accessibilityLabel={label} />
    </View>
  );

  return (
    <ScrollView style={{ backgroundColor: sc.bgPrimary }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" testID="featured-coach-editor">
      <Text style={[styles.eyebrow, { color: sc.textMuted }]}>PREVIEW FOR A CLIENT WITH NO COACH</Text>
      <Banner home={preview} presentation="section" onUseCode={() => undefined} onEnterCode={() => undefined} />
      {romanHiddenReason ? (
        note('featured-roman-hidden', romanHiddenReason)
      ) : (
        <RomanCard text={form.pitch.trim()} onEnterCode={() => undefined} onNotNow={() => undefined} />
      )}

      <Text style={[styles.eyebrow, { color: sc.textMuted }]}>COACH</Text>
      {listMissing ? note('featured-list-missing', 'The coach list arrives with the next server update. The current featured coach stays editable.') : null}
      {coaches.length === 0 ? (
        note('featured-no-coaches', 'No coach accounts yet. Create the coach account first, then come back here.')
      ) : (
        coaches.map((c) =>
          choice(`featured-coach-${c.id}`, c.id === form.coachId, c.name ?? c.email ?? 'Coach', c.business_name ?? c.email, () =>
            set({ coachId: c.id, packageId: c.packages[0]?.id ?? null }),
          ),
        )
      )}
      {fieldLine('coach')}

      <Text style={[styles.eyebrow, { color: sc.textMuted }]}>FEATURED CODE</Text>
      {input('featured-code', form.code, (v) => set({ code: v.toUpperCase() }), FEATURED_LIMITS.code_max)}
      {toggle('featured-create-code', 'Create the code if it is new', form.createCode, (v) => set({ createCode: v }))}
      {fieldLine('code')}

      <Text style={[styles.eyebrow, { color: sc.textMuted }]}>PACKAGE</Text>
      {coach && coach.packages.length === 0
        ? note('featured-no-packages', 'This coach has no active packages. Create one in Packages, then come back here.')
        : null}
      {(coach?.packages ?? []).map((p) => {
        const purchasable = purchasableFromCoachPackage(p);
        return choice(`featured-package-${p.id}`, p.id === form.packageId, p.name, purchasable ? priceLabel(purchasable) : null, () =>
          set({ packageId: p.id }),
        );
      })}
      {coach && coach.packages.length > 0 ? choice('featured-package-none', form.packageId === null, 'No package', null, () => set({ packageId: null })) : null}
      {fieldLine('package')}

      <Text style={[styles.eyebrow, { color: sc.textMuted }]}>BANNER TITLE</Text>
      {input('featured-banner-title', form.bannerTitle, (v) => set({ bannerTitle: v }), FEATURED_LIMITS.banner_title)}
      {counter(form.bannerTitle, FEATURED_LIMITS.banner_title)}

      <Text style={[styles.eyebrow, { color: sc.textMuted }]}>OFFER TEXT</Text>
      {input('featured-offer-text', form.offerText, (v) => set({ offerText: v }), FEATURED_LIMITS.offer_text, true)}
      {counter(form.offerText, FEATURED_LIMITS.offer_text)}

      <Text style={[styles.eyebrow, { color: sc.textMuted }]}>ROMAN PITCH</Text>
      {input('featured-pitch', form.pitch, (v) => set({ pitch: v, pitchEdited: true }), FEATURED_LIMITS.roman_pitch_text, true)}
      {counter(form.pitch, FEATURED_LIMITS.roman_pitch_text)}
      {form.pitchEdited ? (
        <Pressable
          onPress={() => set({ pitch: suggestedPitch(code || SUGGESTED_CODE, price), pitchEdited: false })}
          accessibilityRole="button"
          testID="featured-pitch-reset"
          style={styles.link}
        >
          <Text style={[styles.label, { color: sc.accentText }]}>Use the suggested pitch</Text>
        </Pressable>
      ) : null}

      <Text style={[styles.eyebrow, { color: sc.textMuted }]}>SWITCHES</Text>
      {toggle('featured-accepting', 'Accepting new clients', form.accepting, (v) => set({ accepting: v }))}
      {toggle('featured-roman', 'Show the Roman card', form.romanEnabled, (v) => set({ romanEnabled: v }))}

      <Text style={[styles.eyebrow, { color: sc.textMuted }]}>ROMAN CARD LIMITS</Text>
      {CAP_KEYS.map((k) => (
        <View key={k} style={styles.toggle}>
          <Text style={[styles.label, styles.flex, { color: sc.textPrimary }]}>{`${CAP_LABELS[k]} (${CAP_RANGES[k].min} to ${CAP_RANGES[k].max})`}</Text>
          <TextInput
            value={form.caps[k]}
            onChangeText={(v) => set({ caps: { ...form.caps, [k]: v.replace(/[^0-9]/g, '') } })}
            keyboardType="number-pad"
            maxLength={3}
            testID={`featured-cap-${k}`}
            accessibilityLabel={CAP_LABELS[k]}
            style={[styles.input, styles.cap, { color: sc.textPrimary, borderColor: sc.border, backgroundColor: sc.bgSurface }]}
          />
        </View>
      ))}
      {fieldLine('caps')}

      {failure && refusalField(failure.code) === 'form' ? (
        <Text style={[styles.small, styles.gap, { color: colors.error }]} testID="featured-error-form" accessibilityLiveRegion="polite">{saveRefusalLine(failure)}</Text>
      ) : null}
      {saved ? (
        <Text style={[styles.small, styles.gap, { color: sc.textPrimary }]} testID="featured-saved" accessibilityLiveRegion="polite">{saved}</Text>
      ) : null}
      <Pressable
        onPress={() => void save()}
        disabled={saving}
        accessibilityRole="button"
        accessibilityState={{ disabled: saving, busy: saving }}
        testID="featured-save"
        style={({ pressed }) => [styles.cta, { backgroundColor: saving ? sc.disabledBg : sc.accent, opacity: pressed ? 0.85 : 1 }]}
      >
        <Text style={[styles.label, { color: saving ? sc.textOnDisabled : sc.textOnAccent }]}>{saving ? 'Saving' : 'Save'}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: 64 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  eyebrow: { ...typography.eyebrow, marginTop: spacing.lg, marginBottom: 8 },
  body: { ...typography.body, textAlign: 'center' },
  label: { ...typography.bodyMd },
  small: { ...typography.bodySmall, marginTop: 4 },
  gap: { marginBottom: 12 },
  counter: { alignSelf: 'flex-end' },
  flex: { flex: 1, marginRight: 12 },
  input: { ...typography.body, borderWidth: 0.5, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 10, minHeight: 44 },
  multiline: { minHeight: 88, textAlignVertical: 'top' },
  cap: { width: 72, textAlign: 'center' },
  choice: { borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 8, minHeight: 48 },
  toggle: { flexDirection: 'row', alignItems: 'center', minHeight: 48, marginTop: 4 },
  link: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  cta: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, marginTop: spacing.lg },
});
