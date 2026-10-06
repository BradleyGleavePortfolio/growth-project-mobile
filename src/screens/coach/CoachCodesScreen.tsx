/**
 * Coach Codes screen (b#658 code tools, server flag FEATURE_COACH_CODE_TOOLS).
 *
 * List, create, rotate (with a grace period), turn off, and share each code
 * as text or as a QR. Shows today's signups per code and warns when a code
 * gets far more signups than usual (`unusual_today`), the sign it leaked.
 * Mounted by CoachCodesEntry only when GET /coach/codes answers; while the
 * server flag is off the entry shows the legacy InviteCodesScreen.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Sharing from 'expo-sharing';
import { captureRef } from 'react-native-view-shot';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import CodeQr from '../../components/coach/CodeQr';
import {
  coachCodesApi,
  coachCodesErrorMessage,
  newCreateKey,
  ROTATE_GRACE_CHOICES,
  type CoachCode,
  type CoachCodeList,
  type CoachCodeSignupsByCode,
} from '../../api/coachCodesApi';

const STATUS_LABEL: Record<CoachCode['status'], string> = {
  active: 'Active',
  retiring: 'Retiring',
  revoked: 'Off',
  expired: 'Expired',
  used_up: 'Used up',
};

function shortDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function shareMessage(c: Pick<CoachCode, 'code' | 'join_url'>): string {
  return `Use code ${c.code} to join The Growth Project: ${c.join_url}`;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export default function CoachCodesScreen({ initial }: { initial: CoachCodeList }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [codes, setCodes] = useState<CoachCode[]>(initial.codes);
  const [note, setNote] = useState(initial.tracking_note);
  const [today, setToday] = useState<Map<string, CoachCodeSignupsByCode>>(new Map());
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [rotating, setRotating] = useState<CoachCode | null>(null);
  const [qrFor, setQrFor] = useState<CoachCode | null>(null);

  const loadSignups = useCallback(async () => {
    try {
      // 8 days: today plus the full trailing week that unusual_today compares against.
      const s = await coachCodesApi.signups(8);
      setToday(new Map(s.by_code.map((r) => [r.code, r])));
    } catch {
      // Counts are extra: the list still shows each code's 7-day total.
      setToday(new Map());
    }
  }, []);

  useEffect(() => {
    void loadSignups();
  }, [loadSignups]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const list = await coachCodesApi.list();
      setCodes(list.codes);
      setNote(list.tracking_note);
      setBanner(null);
      await loadSignups();
    } catch (err) {
      setBanner(coachCodesErrorMessage(err, 'load'));
    } finally {
      setRefreshing(false);
    }
  }, [loadSignups]);

  /**
   * Replace rows the server returned by id; add new ones (a created code, a
   * rotation's successor, an archived coach link) at the top of the codes,
   * under the coach link.
   */
  const applyChange = (next: CoachCode, previous?: CoachCode | null) => {
    setCodes((prev) => {
      const incoming = [...(previous ? [previous] : []), next];
      const out = prev.map((c) => incoming.find((n) => n.id === c.id) ?? c);
      for (const n of incoming) {
        if (out.some((c) => c.id === n.id)) continue;
        const at = n.kind === 'coach_link' ? 0 : out.findIndex((c) => c.kind !== 'coach_link');
        out.splice(at < 0 ? out.length : at, 0, n);
      }
      return out;
    });
  };

  const rotate = async (code: CoachCode, graceHours: number) => {
    setRotating(null);
    setBusyId(code.id);
    setBanner(null);
    try {
      const res = await coachCodesApi.rotate(code, graceHours);
      applyChange(res.code, res.previous);
      void loadSignups();
    } catch (err) {
      setBanner(coachCodesErrorMessage(err, 'rotate'));
    } finally {
      setBusyId(null);
    }
  };

  const revoke = (code: CoachCode) => {
    Alert.alert(
      `Turn off ${code.code}?`,
      'New signups with this code stop now. Clients who already joined stay connected to you.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Turn off',
          style: 'destructive',
          onPress: async () => {
            setBusyId(code.id);
            setBanner(null);
            try {
              const res = await coachCodesApi.revoke(code.id);
              applyChange(res.code);
            } catch (err) {
              setBanner(coachCodesErrorMessage(err, 'revoke'));
            } finally {
              setBusyId(null);
            }
          },
        },
      ],
    );
  };

  const shareText = async (code: CoachCode) => {
    try {
      await Share.share({ message: shareMessage(code), url: code.join_url });
    } catch {
      setBanner('The share sheet did not open. Copy the code instead: ' + code.code);
    }
  };

  return (
    <View style={styles.flex}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        testID="coach-codes-screen"
      >
        <Text style={styles.title} accessibilityRole="header">Codes</Text>
        <Text style={styles.subtitle}>
          Share a code, its link or its QR. Clients who join with it are connected to you.
        </Text>
        <CreateCode styles={styles} onCreated={(c) => applyChange(c)} />
        {banner ? (
          <Text style={styles.banner} accessibilityRole="alert" testID="coach-codes-banner">{banner}</Text>
        ) : null}
        {codes.map((c) => {
          const live = c.status === 'active' || c.status === 'retiring';
          // A retiring code is already replaced: it can only be turned off early.
          const shareable = c.status === 'active';
          const t = today.get(c.code);
          const until = c.status === 'retiring' ? shortDate(c.expires_at) : null;
          return (
            <View key={`${c.id}:${c.code}`} style={styles.card} testID={`coach-code-${c.code}`}>
              <View style={styles.row}>
                <Text style={styles.code} selectable>{c.code}</Text>
                <Text style={[styles.chip, !live && styles.chipOff]}>{STATUS_LABEL[c.status]}</Text>
              </View>
              <Text style={styles.meta}>
                {c.kind === 'coach_link' ? 'Coach link' : c.label || 'Code'}
                {c.package ? ` · ${c.package.name}` : ''}
              </Text>
              {until ? <Text style={styles.meta}>Keeps working until {until}</Text> : null}
              {c.status === 'active' && c.expires_at ? (
                <Text style={styles.meta}>Expires {shortDate(c.expires_at)}</Text>
              ) : null}
              {c.rotated_to ? <Text style={styles.meta}>Replaced by {c.rotated_to.code}</Text> : null}
              <Text style={styles.meta}>
                {t ? `Today ${plural(t.today, 'signup', 'signups')} · ` : ''}
                {`7 days ${c.signups_7d} · Total ${c.signups_total}`}
                {c.max_uses ? ` · ${c.used_count ?? 0} of ${c.max_uses} used` : ''}
              </Text>
              {t?.unusual_today ? (
                <Text style={styles.warn} testID={`coach-code-unusual-${c.code}`}>
                  Many more signups today than usual. If this code was posted somewhere public, rotate it.
                </Text>
              ) : null}
              {live ? (
                <View style={styles.actions}>
                  {busyId === c.id ? <ActivityIndicator /> : null}
                  {shareable ? (
                    <>
                      <Action styles={styles} label="Share" onPress={() => shareText(c)} id={`share-${c.code}`} />
                      <Action styles={styles} label="QR" onPress={() => setQrFor(c)} id={`qr-${c.code}`} />
                      <Action
                        styles={styles}
                        label="Rotate"
                        onPress={() => setRotating(c)}
                        id={`rotate-${c.code}`}
                        disabled={busyId !== null}
                      />
                    </>
                  ) : null}
                  {c.kind === 'invite_code' ? (
                    <Action
                      styles={styles}
                      label="Turn off"
                      onPress={() => revoke(c)}
                      id={`revoke-${c.code}`}
                      disabled={busyId !== null}
                      destructive
                    />
                  ) : null}
                </View>
              ) : null}
            </View>
          );
        })}
        <Text style={styles.note}>{note}</Text>
      </ScrollView>

      <Modal visible={rotating !== null} transparent animationType="fade" onRequestClose={() => setRotating(null)}>
        <View style={styles.scrim}>
          <View style={styles.sheet} testID="coach-code-rotate-sheet">
            <Text style={styles.sheetTitle}>Replace {rotating?.code}</Text>
            <Text style={styles.meta}>
              A new code with the same settings is made now. Clients who already joined stay connected to you.
            </Text>
            {ROTATE_GRACE_CHOICES.map((g) => (
              <TouchableOpacity
                key={g.hours}
                style={styles.option}
                accessibilityRole="button"
                testID={`coach-code-grace-${g.hours}`}
                onPress={() => rotating && rotate(rotating, g.hours)}
              >
                <Text style={styles.optionText}>{g.label}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.option} accessibilityRole="button" onPress={() => setRotating(null)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <QrSheet styles={styles} code={qrFor} onClose={() => setQrFor(null)} onShareText={shareText} />
    </View>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function Action({
  styles,
  label,
  onPress,
  id,
  disabled,
  destructive,
}: {
  styles: Styles;
  label: string;
  onPress: () => void;
  id: string;
  disabled?: boolean;
  destructive?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.action, disabled && styles.disabled]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      testID={`coach-code-${id}`}
    >
      <Text style={[styles.actionText, destructive && styles.destructive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function CreateCode({ styles, onCreated }: { styles: Styles; onCreated: (c: CoachCode) => void }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [maxUses, setMaxUses] = useState('');
  const [days, setDays] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per create attempt, reused on every retry of the same inputs.
  const keyRef = useRef<string | null>(null);
  const edit = (set: (v: string) => void) => (v: string) => {
    keyRef.current = null;
    set(v);
  };

  const submit = async () => {
    setError(null);
    const body: { label?: string; max_uses?: number; expires_at?: string } = {};
    if (label.trim()) body.label = label.trim();
    if (maxUses.trim()) {
      const n = Number(maxUses.trim());
      if (!Number.isInteger(n) || n < 1) return setError('Signup limit must be a whole number of 1 or more.');
      body.max_uses = n;
    }
    if (days.trim()) {
      const n = Number(days.trim());
      if (!Number.isInteger(n) || n < 1 || n > 365) return setError('Days must be a whole number from 1 to 365.');
      body.expires_at = new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString();
    }
    keyRef.current = keyRef.current ?? newCreateKey();
    setBusy(true);
    try {
      const res = await coachCodesApi.create(body, keyRef.current);
      keyRef.current = null;
      onCreated(res.code);
      setOpen(false);
      setLabel('');
      setMaxUses('');
      setDays('');
    } catch (err) {
      setError(coachCodesErrorMessage(err, 'create'));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <TouchableOpacity style={styles.primary} onPress={() => setOpen(true)} accessibilityRole="button" testID="coach-code-create-open">
        <Text style={styles.primaryText}>Create code</Text>
      </TouchableOpacity>
    );
  }
  return (
    <View style={styles.card} testID="coach-code-create-form">
      <TextInput style={styles.input} placeholder="Name (optional), e.g. Front desk" value={label} onChangeText={edit(setLabel)} maxLength={60} testID="coach-code-create-label" />
      <TextInput style={styles.input} placeholder="Signup limit (optional)" value={maxUses} onChangeText={edit(setMaxUses)} keyboardType="number-pad" testID="coach-code-create-max" />
      <TextInput style={styles.input} placeholder="Stops working after this many days (optional)" value={days} onChangeText={edit(setDays)} keyboardType="number-pad" testID="coach-code-create-days" />
      {error ? <Text style={styles.banner} accessibilityRole="alert" testID="coach-code-create-error">{error}</Text> : null}
      <View style={styles.actions}>
        <TouchableOpacity style={styles.action} onPress={() => setOpen(false)} accessibilityRole="button">
          <Text style={styles.actionText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.primary} onPress={submit} disabled={busy} accessibilityRole="button" testID="coach-code-create-submit">
          {busy ? <ActivityIndicator /> : <Text style={styles.primaryText}>Create</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

function QrSheet({
  styles,
  code,
  onClose,
  onShareText,
}: {
  styles: Styles;
  code: CoachCode | null;
  onClose: () => void;
  onShareText: (c: CoachCode) => void;
}) {
  const shotRef = useRef<View>(null);
  const [error, setError] = useState<string | null>(null);
  const shareImage = async () => {
    if (!code) return;
    setError(null);
    try {
      const uri = await captureRef(shotRef, { format: 'png', quality: 1, result: 'tmpfile' });
      if (!(await Sharing.isAvailableAsync())) {
        setError('Sharing images is not available on this device. Share the link instead.');
        return;
      }
      await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: `Invite code ${code.code}` });
    } catch {
      setError('The QR image could not be shared. Share the link instead.');
    }
  };
  return (
    <Modal visible={code !== null} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.scrim}>
        {code ? (
          <View style={styles.sheet} testID="coach-code-qr-sheet">
            <View ref={shotRef} collapsable={false} style={styles.qrBox}>
              <CodeQr value={code.qr_payload} size={232} code={code.code} />
              <Text style={styles.qrCode}>{code.code}</Text>
            </View>
            <Text style={styles.meta}>Scanning opens The Growth Project with this code filled in.</Text>
            {error ? <Text style={styles.banner} accessibilityRole="alert">{error}</Text> : null}
            <TouchableOpacity style={styles.option} onPress={shareImage} accessibilityRole="button" testID="coach-code-qr-share-image">
              <Text style={styles.optionText}>Share QR image</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.option} onPress={() => onShareText(code)} accessibilityRole="button">
              <Text style={styles.optionText}>Share link</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.option} onPress={onClose} accessibilityRole="button">
              <Text style={styles.cancelText}>Close</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    flex: { flex: 1, backgroundColor: c.background },
    content: { padding: 16, paddingBottom: 48, gap: 12 },
    title: { fontSize: 28, fontWeight: '700', color: c.textPrimary },
    subtitle: { fontSize: 15, color: c.textSecondary },
    banner: { color: c.error, fontSize: 14 },
    card: { backgroundColor: c.surface, borderRadius: 14, borderWidth: 1, borderColor: c.border, padding: 14, gap: 6 },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    code: { fontSize: 22, fontWeight: '700', letterSpacing: 1, color: c.textPrimary },
    chip: { fontSize: 12, fontWeight: '600', color: c.primary, backgroundColor: c.primaryLight, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, overflow: 'hidden' },
    chipOff: { color: c.textMuted, backgroundColor: c.border },
    meta: { fontSize: 13, color: c.textSecondary },
    warn: { fontSize: 13, color: c.noticeWarningText, backgroundColor: c.noticeWarningBg, padding: 8, borderRadius: 8 },
    actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 4 },
    action: { minHeight: 44, paddingHorizontal: 12, justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: c.border },
    actionText: { fontSize: 15, fontWeight: '600', color: c.primary },
    destructive: { color: c.error },
    disabled: { opacity: 0.5 },
    primary: { minHeight: 44, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: c.primary },
    primaryText: { fontSize: 16, fontWeight: '600', color: c.textOnPrimary },
    input: { minHeight: 44, borderWidth: 1, borderColor: c.border, borderRadius: 10, paddingHorizontal: 12, color: c.textPrimary },
    note: { fontSize: 12, color: c.textMuted, textAlign: 'center' },
    scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 24 },
    sheet: { backgroundColor: c.surface, borderRadius: 16, padding: 20, gap: 10 },
    sheetTitle: { fontSize: 18, fontWeight: '700', color: c.textPrimary },
    option: { minHeight: 44, justifyContent: 'center', alignItems: 'center' },
    optionText: { fontSize: 16, fontWeight: '600', color: c.primary },
    cancelText: { fontSize: 16, color: c.textSecondary },
    qrBox: { alignItems: 'center', backgroundColor: '#FFFFFF', padding: 16, borderRadius: 12, gap: 8 },
    qrCode: { fontSize: 20, fontWeight: '700', letterSpacing: 1, color: '#000000' },
  });
