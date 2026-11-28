/**
 * CoachNewSpaceScreen (D10-BUILD-COMMUNITY; C6CHAT-S-V2 v1, v2 and v3): New space in three steps on one route, inside
 * the shared Screen wrapper (its top bar the header, its one primary button the pinned footer; R8).
 *
 * v1: the name (2 to 120 characters once trimmed, as CreateCohortDto) and the kind, Chat space or Announcement space.
 * v2: who can join. "All my clients" is the radio, selected; "Create space" makes { name, kind, visibility: 'clients' }.
 * "Included with a package" opens v3 (R6). v3: the coach's live packages (coachPackagesApi.list, isLivePackage); "Create
 * space" makes { name, kind, visibility: 'package', package_ids } with at least one pick. The create goes through
 * useCreateCohort (one send per tap); a failure says why (alertCoachFailure) and keeps every entry. Close on v1 leaves;
 * Back on v2 or v3 steps back with the entries kept, and so do Android's Back and the iPhone edge swipe: usePreventRemove
 * holds them (native-stack passes preventNativeDismiss to the native screen only for it; a raw beforeRemove listener
 * cannot hold the swipe, ClientNavigator.tsx's m#521 note). A Create leaves once, with nothing held. Nothing is saved
 * to the phone. Every word draws whole at 320 pt and 130% text: the top bar's title wraps at a space between two equal
 * side slots sized to their content, and a card's title column fits "Announcement" (LS-D10C-1 B2 and its class).
 * The page is the app's page colour, Sunlit sand (the Screen wrapper's own bgPrimary, owner #203-E86), so the strip
 * and the page are one colour. Left out (R4; each its own v1 row, 203-D62, #203-E124): Section, Inside, the depth line,
 * Public on TGP, "You can change this later." and v3's total line.
 */
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View, type LayoutChangeEvent } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, usePreventRemove } from '@react-navigation/native';
import HapticPressable from '../../components/HapticPressable';
import { Screen } from '../../ui/layout/Screen';
import { PrimaryButton } from '../../ui/buttons/PrimaryButton';
import { HapticService } from '../../ui/haptics/haptics.service';
import { useCreateCohort } from '../../hooks/useCoachCommunity';
import type { CreateCohortInput } from '../../api/coachCommunityApi';
import { coachPackagesApi, isLivePackage, type CoachPackage } from '../../api/packagesApi';
import { forestPop as fp, layout, neutral, schemeCard, typography } from '../../theme/tokens';
import type { CoachCommunityNav } from './coachCommunityNavTypes';
import { alertCoachFailure } from './CoachCommunityInboxScreen';

type Step = 'name' | 'who' | 'packages';
type Kind = NonNullable<CreateCohortInput['kind']>;
type IconName = React.ComponentProps<typeof Ionicons>['name'];
type Packages = { state: 'idle' | 'loading' | 'failed' } | { state: 'ready'; rows: CoachPackage[] };

const NAME_MIN = 2;
const NAME_MAX = 120;
const KINDS: { kind: Kind; icon: IconName | '#'; title: string; line: string }[] = [
  { kind: 'chat', icon: '#', title: 'Chat space', line: 'Everyone in the space can post.' },
  { kind: 'announcement', icon: 'megaphone-outline', title: 'Announcement space', line: 'Only you post. Members react and reply in threads.' },
];

function Option({ icon, title, line, on, role, chevron, onPress, testID }: {
  icon: IconName | '#'; title: string; line: string; on: boolean; role: 'radio' | 'button'; chevron?: boolean; onPress: () => void; testID: string;
}): React.ReactElement {
  return (
    <HapticPressable intent="light" onPress={onPress} accessibilityRole={role} accessibilityLabel={`${title}, ${line}`}
      accessibilityState={role === 'radio' ? { checked: on } : undefined} style={[s.card, on && s.cardOn, on && schemeCard]} testID={testID}>
      <View style={[s.tile, on && s.tileOn]}>
        {icon === '#' ? <Text style={[s.hash, { color: on ? fp.onDeep : fp.forest }]}>#</Text>
          : <Ionicons name={icon} size={22} color={on ? fp.onDeep : fp.forest} />}
      </View>
      <View style={s.cardText}>
        <Text style={s.cardTitle}>{title}</Text>
        <Text style={s.cardLine}>{line}</Text>
      </View>
      {chevron ? <Ionicons name="chevron-forward" size={22} color={fp.n700} />
        : <View style={[s.radio, on && s.radioOn]}>{on ? <View style={s.radioDot} /> : null}</View>}
    </HapticPressable>
  );
}

export default function CoachNewSpaceScreen(): React.ReactElement {
  const navigation = useNavigation<CoachCommunityNav>();
  const create = useCreateCohort();
  const [step, setStep] = useState<Step>('name');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<Kind>('chat');
  const [picks, setPicks] = useState<string[]>([]);
  const [packages, setPackages] = useState<Packages>({ state: 'idle' });
  const sending = useRef(false);
  const [leaving, setLeaving] = useState(false);
  const trimmed = name.trim();
  const named = Array.from(trimmed).length >= NAME_MIN;
  const stepBack = () => setStep(step === 'packages' ? 'who' : 'name');
  // The top bar's two side slots take their content's width (Close or Back, the counter) and the wider of the two on
  // both sides, so the title stays centred and the counter keeps one line at any text size; the title wraps at a space.
  const [side, setSide] = useState(0);
  const fitSide = (e: LayoutChangeEvent) => { const w = e.nativeEvent.layout.width; setSide((v) => (w > v ? w : v)); };

  // Android's Back and the iPhone edge swipe step back like the top bar while v2 or v3 is open. After a Create the
  // hold is off first (leaving), then the page goes back once, so nothing holds the Create's goBack.
  usePreventRemove(step !== 'name' && !leaving, stepBack);
  useEffect(() => { if (leaving) navigation.goBack(); }, [leaving, navigation]);

  const loadPackages = async () => {
    setPackages({ state: 'loading' });
    try {
      const res = await coachPackagesApi.list();
      setPackages({ state: 'ready', rows: res.data.filter(isLivePackage) });
    } catch {
      setPackages({ state: 'failed' });
      void HapticService.error();
    }
  };
  const openPackages = () => {
    setStep('packages');
    if (packages.state === 'idle' || packages.state === 'failed') void loadPackages();
  };
  const live = packages.state === 'ready' ? packages.rows : [];
  const picked = live.filter((p) => picks.includes(p.id)).map((p) => p.id);

  const send = (input: CreateCohortInput) => {
    if (sending.current || create.isPending || leaving) return;
    sending.current = true;
    create.mutate(input, {
      onSuccess: () => {
        void HapticService.success();
        setLeaving(true);
      },
      onError: alertCoachFailure,
      onSettled: () => { sending.current = false; },
    });
  };

  const counter = step === 'packages' ? null : `${step === 'name' ? 1 : 2} of 2`;
  const title = step === 'name' ? 'New space' : step === 'who' ? 'Visibility' : 'Included with a package';
  const header = (
    <View style={s.bar}>
      <View style={[s.side, { minWidth: side }]} onLayout={fitSide}>
        <HapticPressable intent="light" onPress={() => (step === 'name' ? navigation.goBack() : stepBack())}
          accessibilityRole="button" accessibilityLabel={step === 'name' ? 'Close' : 'Back'} style={s.barButton} testID="new-space-back">
          <Ionicons name={step === 'name' ? 'close' : 'chevron-back'} size={26} color={fp.ink} />
        </HapticPressable>
      </View>
      <Text style={s.barTitle} accessibilityRole="header"
        accessibilityLabel={counter ? `${title}, step ${step === 'name' ? 1 : 2} of 2` : title} testID="new-space-title">{title}</Text>
      <View style={[s.side, s.sideEnd, { minWidth: side }]} onLayout={fitSide}>
        {counter ? <Text style={s.counter} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">{counter}</Text> : null}
      </View>
    </View>
  );

  const busy = create.isPending;
  const footer = step === 'name' ? (
    <PrimaryButton label="Next: visibility" disabled={!named} testID="new-space-next"
      onPress={() => { void HapticService.selection(); setStep('who'); }} />
  ) : step === 'who' ? (
    <PrimaryButton label="Create space" disabled={busy} loading={busy} testID="new-space-create"
      onPress={() => send({ name: trimmed, kind, visibility: 'clients' })} />
  ) : (
    <PrimaryButton label="Create space" disabled={busy || picked.length === 0} loading={busy} testID="new-space-create"
      onPress={() => send({ name: trimmed, kind, visibility: 'package', package_ids: picked })} />
  );

  let body: React.ReactNode;
  if (step === 'name') {
    body = (
      <>
        <Text style={s.label} nativeID="new-space-name-label">Space name</Text>
        <TextInput value={name} onChangeText={(v) => setName(v.slice(0, NAME_MAX))} maxLength={NAME_MAX} autoFocus
          accessibilityLabel="Space name" accessibilityLabelledBy="new-space-name-label" style={s.field} returnKeyType="next"
          onSubmitEditing={() => { if (named) setStep('who'); }} testID="new-space-name" />
        <Text style={s.eyebrow}>Kind</Text>
        <View accessibilityRole="radiogroup" style={s.options}>
          {KINDS.map((k) => (
            <Option key={k.kind} icon={k.icon} title={k.title} line={k.line} on={kind === k.kind} role="radio"
              onPress={() => { if (kind !== k.kind) void HapticService.selection(); setKind(k.kind); }} testID={`new-space-kind-${k.kind}`} />
          ))}
        </View>
      </>
    );
  } else if (step === 'who') {
    body = (
      <>
        <Text style={s.question} accessibilityRole="header">{`Who can join ${trimmed}?`}</Text>
        <View style={s.options}>
          <Option icon="cube-outline" title="Included with a package" line="Clients with the packages you pick. Access ends when their package ends."
            on={false} role="button" chevron onPress={openPackages} testID="new-space-package" />
          <View accessibilityRole="radiogroup">
            <Option icon="people-outline" title="All my clients" line="Every client you coach now. Access ends when they stop being your client."
              on role="radio" onPress={() => undefined} testID="new-space-clients" />
          </View>
        </View>
      </>
    );
  } else {
    body = (
      <>
        <Text style={s.question} accessibilityRole="header">Pick packages</Text>
        <Text style={s.lead}>{`Clients with any of these packages can open ${trimmed}.`}</Text>
        {packages.state === 'ready' && live.length === 0 ? (
          <Text style={s.lead} testID="new-space-packages-none">No packages to pick yet.</Text>
        ) : null}
        {packages.state === 'failed' ? (
          <View style={s.failed} testID="new-space-packages-failed">
            <Text style={s.lead}>Your packages did not load. Check your connection, then try again.</Text>
            <PrimaryButton label="Try again" onPress={() => void loadPackages()} testID="new-space-packages-retry" />
          </View>
        ) : null}
        {packages.state === 'loading' || packages.state === 'idle' ? (
          <View accessible accessibilityLabel="Loading your packages" accessibilityState={{ busy: true }} style={s.options} testID="new-space-packages-loading">
            {[0, 1, 2].map((n) => <View key={n} style={s.skRow} />)}
          </View>
        ) : null}
        <View style={s.options}>
          {live.map((p) => {
            const on = picks.includes(p.id);
            const count = p.statsAvailable ? `${p.subscriberCount} active ${p.subscriberCount === 1 ? 'client' : 'clients'}` : null;
            return (
              <HapticPressable key={p.id} intent="light" accessibilityRole="checkbox" accessibilityState={{ checked: on }}
                accessibilityLabel={[p.title, count].filter(Boolean).join(', ')} style={[s.pkg, on && s.cardOn, on && schemeCard]}
                onPress={() => { void HapticService.selection(); setPicks(on ? picks.filter((id) => id !== p.id) : [...picks, p.id]); }}
                testID={`new-space-pkg-${p.id}`}>
                <View style={s.cardText}>
                  <Text style={s.cardTitle} numberOfLines={2}>{p.title}</Text>
                  {count ? <Text style={s.cardLine}>{count}</Text> : null}
                </View>
                <View style={[s.check, on && s.checkOn]}>{on ? <Ionicons name="checkmark" size={18} color={fp.onDeep} /> : null}</View>
              </HapticPressable>
            );
          })}
        </View>
      </>
    );
  }

  return (
    <Screen header={header} footer={footer} contentStyle={s.content} testID="coach-new-space">
      {body}
    </Screen>
  );
}

const s = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingTop: 8 },
  bar: { minHeight: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 },
  side: { minHeight: layout.touchMin, justifyContent: 'center', alignItems: 'flex-start' },
  sideEnd: { alignItems: 'flex-end' },
  barButton: { width: layout.touchMin, minHeight: layout.touchMin, justifyContent: 'center', alignItems: 'flex-start', paddingLeft: 6 },
  barTitle: { flex: 1, textAlign: 'center', fontFamily: 'Inter_600SemiBold', fontSize: 18, color: fp.ink },
  counter: { fontFamily: 'Inter_500Medium', fontSize: 15, color: fp.brand400, paddingRight: 8 },
  label: { fontFamily: 'Inter_600SemiBold', fontSize: 15, color: fp.ink, marginBottom: 8 },
  field: { minHeight: 52, borderRadius: 14, borderWidth: 1.5, borderColor: fp.forest, backgroundColor: neutral[0], paddingHorizontal: 14, fontFamily: 'Inter_400Regular', fontSize: 17, color: fp.ink },
  eyebrow: { ...typography.eyebrow, fontFamily: 'Inter_600SemiBold', fontSize: 12, lineHeight: 16, letterSpacing: 1.4, color: fp.forest, marginTop: 24, marginBottom: 10 },
  options: { gap: 12 },
  card: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16, borderWidth: 1, borderColor: fp.sageLine, backgroundColor: neutral[0] },
  cardOn: { borderColor: fp.forest, borderWidth: 1.5 },
  tile: { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: fp.sage },
  tileOn: { backgroundColor: fp.forest },
  hash: { fontFamily: 'Inter_400Regular', fontSize: 24, lineHeight: 28 },
  cardText: { flex: 1, gap: 2 },
  cardTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 17, color: fp.ink },
  cardLine: { fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 20, color: fp.n700 },
  radio: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: fp.brand400, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: fp.forest },
  radioDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: fp.forest },
  question: { fontFamily: 'Inter_600SemiBold', fontSize: 22, lineHeight: 28, color: fp.ink, marginBottom: 16 },
  lead: { ...typography.body, color: fp.n700, marginBottom: 16 },
  failed: { gap: 4, marginBottom: 16 },
  skRow: { height: 64, borderRadius: 16, backgroundColor: fp.sage },
  pkg: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1, borderColor: fp.sageLine, backgroundColor: neutral[0] },
  check: { width: 26, height: 26, borderRadius: 7, borderWidth: 2, borderColor: fp.brand400, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: fp.forest, borderColor: fp.forest },
});
