/**
 * ShareSheet (SHARE-A, featureFlags.shareSheetV2): one sheet over the screen it came from, for any ShareCardContent
 * (Progress and the Session summary use shareCards.tsx; the health pages can pass their own). The card drawn here is
 * the picture. No sharing switches: each card says what is in it and what is not. Coached with featureFlags.shareSendV1:
 * Send to {coach} (filled) and Share outside the app (outline); otherwise one filled Share outside the app. A busy
 * button keeps its size and says what is happening; failures are calm gold words in place, never an alert. Haptics:
 * soft on a tap, success once only when the server confirms a send, error when a picture or a send fails. SHARE-B: Send
 * goes through the client's thread outbox (either thread style), so offline the card waits in the thread and sends on
 * reconnect.
 */
import React, { useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import api from '../../services/api';
import type { ShareSnapshot } from '../../api/shareCardApi';
import { AnalyticsEvents } from '../../analytics/events';
import { featureFlags } from '../../config/featureFlags';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { isEffectivelyOnline, useNetworkStatus } from '../../hooks/useNetworkStatus';
import { sendCardViaOutbox, takeBackRefused } from '../../services/messageOutbox';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { track } from '../../lib/analytics';
import { useTheme } from '../../theme/ThemeProvider';
import { layout, radius, typography } from '../../theme/tokens';
import { footerBottomPadding, useScreenInsets } from '../../ui/layout/Screen';
import { HapticService } from '../../ui/haptics/haptics.service';
import { sharePicture } from './sharePicture';

export interface ShareCardContent {
  view: React.ReactNode; // the card as drawn: this drawing is the picture that leaves the phone
  label: string; // what a screen reader says for the picture
  inIt: string;
  notInIt: string;
  snapshot: ShareSnapshot; // what Send to {coach} posts
  type: 'streak' | 'pr'; // analytics card type
}

type Act = 'picture' | 'send';
type Icon = React.ComponentProps<typeof Ionicons>['name'];
/** A 400 on send is a server without share cards (SoT A5 rule 5): Send stays away until the app restarts. */
let sendUnavailable = false;

/** SHARE-B: through the thread outbox, so offline the card waits; one the server refuses leaves it ("not available"). */
async function viaOutbox(uid: string, snapshot: ShareSnapshot, key: string) {
  const result = await sendCardViaOutbox(uid, snapshot, key);
  if (result !== 'refused') return result;
  takeBackRefused(uid, key);
  return 'unavailable' as const;
}

export default function ShareSheet({ card, onClose }: { card: ShareCardContent | null; onClose: () => void }) {
  const { semanticColors: sc } = useTheme();
  const insets = useScreenInsets();
  const reduceMotion = useReducedMotion();
  const cardRef = useRef<View>(null);
  const kept = useRef(card);
  if (card) kept.current = card; // still drawn while the sheet leaves
  const shown = card ?? kept.current;
  const live = useRef(card);
  live.current = card;
  const sendKey = useRef<{ card: ShareCardContent | null; id: string }>({ card: null, id: '' });
  const [forCard, setForCard] = useState(card);
  const [busy, setBusy] = useState<Act[]>([]);
  const [failed, setFailed] = useState<Act | null>(null);
  const [unavailable, setUnavailable] = useState(sendUnavailable);
  if (card && card !== forCard) {
    setForCard(card);
    setBusy([]);
    setFailed(null);
  }

  const user = useCurrentUser();
  const coachId = user?.coach_id ?? null;
  const uid = user?.id; // Send goes through this client's thread outbox, in either thread style
  const offline = !isEffectivelyOnline(useNetworkStatus());
  const sendOn = featureFlags.shareSendV1 && coachId != null && !unavailable;
  const coach = useQuery({
    queryKey: ['wearables', 'coach-name', coachId],
    enabled: sendOn && card != null,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => (await api.get<{ name?: string }>('/v1/clients/me/coach')).data?.name ?? null,
  });
  const coachFirst = typeof coach.data === 'string' ? (coach.data.trim().split(/\s+/)[0] ?? '') : '';
  const canSend = sendOn && coachFirst !== '';

  const run = async (act: Act, c: ShareCardContent, work: () => Promise<boolean | null>) => {
    setBusy((b) => [...b, act]);
    setFailed(null);
    const ok = await work();
    if (live.current !== c) return;
    setBusy((b) => b.filter((x) => x !== act));
    if (ok === false) setFailed(act);
  };
  const outside = (c: ShareCardContent) => run('picture', c, () => sharePicture(cardRef, { card_type: c.type }, 'Share your card'));
  const send = (c: ShareCardContent) => run('send', c, async () => {
    if (sendKey.current.card !== c) sendKey.current = { card: c, id: randomUUID() };
    if (!uid) return null; // Send shows only to a signed-in coached client
    const result = await viaOutbox(uid, c.snapshot, sendKey.current.id);
    if (result === 'waiting') { // board 8: it waits in the thread and sends on reconnect
      if (live.current === c) onClose();
      return null;
    }
    if (result === 'unavailable') {
      sendUnavailable = true;
      setUnavailable(true);
      return null;
    }
    void (result === 'sent' ? HapticService.success() : HapticService.error());
    if (result !== 'sent') return false;
    track(AnalyticsEvents.REFERRAL_SHARE_CARD_SHARED, { card_type: c.type, destination: 'coach_thread' });
    if (live.current === c) onClose();
    return true;
  });
  const warm = (text: string, retry?: () => void) => (
    <Pressable onPress={retry} disabled={!retry} accessibilityRole={retry ? 'button' : 'text'} accessibilityLiveRegion="polite" style={s.foot}>
      <Ionicons name="alert-circle-outline" size={16} color={sc.data.peakInk} />
      <Text style={[s.footText, { color: sc.data.peakInk }]}>{text}</Text>
    </Pressable>
  );

  return (
    <Modal visible={card != null} transparent animationType={reduceMotion ? 'none' : 'fade'} onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: sc.overlay }]} onPress={onClose} accessible={false} />
      {shown ? (
        <View style={[s.sheet, { backgroundColor: sc.bgPrimary }]} accessibilityViewIsModal>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Dismiss" style={s.grabberHit}>
            <View style={[s.grabber, { backgroundColor: sc.border }]} />
          </Pressable>
          <ScrollView bounces={false} contentContainerStyle={{ paddingBottom: footerBottomPadding(insets.bottom) }}>
            <Text accessibilityRole="header" style={[s.title, { color: sc.textPrimary }]}>Share this card</Text>
            <View ref={cardRef} collapsable={false} accessible accessibilityRole="image" accessibilityLabel={shown.label}>{shown.view}</View>
            <View style={s.lines}>
              {([['checkmark', shown.inIt, sc.textPrimary], ['lock-closed-outline', shown.notInIt, sc.textMuted]] as const).map(([icon, text, color]) => (
                <View key={icon} style={s.line}>
                  <Ionicons name={icon} size={16} color={color} style={s.lineIcon} />
                  <Text style={[s.lineText, { color }]}>{text}</Text>
                </View>
              ))}
            </View>
            {canSend ? (
              <SheetButton filled icon="chatbubble-outline" label={`Send to ${coachFirst}`} busyLabel="Sending…" busy={busy.includes('send')} onPress={() => void send(shown)} />
            ) : null}
            <SheetButton filled={!canSend} icon="share-outline" label="Share outside the app" busyLabel="Making the picture…" busy={busy.includes('picture')} onPress={() => void outside(shown)} />
            {failed === 'picture' ? warm('The picture could not be made. Try again.')
              : failed === 'send' ? warm('Not sent. Tap to send again', () => void send(shown))
                : (
                  <View style={s.foot}>
                    <Text style={[s.footText, { color: sc.textMuted }]}>
                      {canSend && offline ? "You're offline. It sends when you reconnect."
                        : canSend ? `${coachFirst} sees this card in your messages.` : "Opens your phone's share options with a picture of this card."}
                    </Text>
                  </View>
                )}
          </ScrollView>
        </View>
      ) : null}
    </Modal>
  );
}

function SheetButton({ filled, icon, label, busyLabel, busy, onPress }: {
  filled: boolean; icon: Icon; label: string; busyLabel: string; busy: boolean; onPress: () => void;
}) {
  const { semanticColors: sc } = useTheme();
  const ink = filled ? sc.textOnAccent : sc.accentText;
  const fill = filled ? { backgroundColor: sc.accent } : { backgroundColor: sc.bgSurface, borderColor: sc.accent, borderWidth: 1 };
  return (
    <Pressable
      onPress={() => { if (busy) return; void HapticService.softImpact(); onPress(); }}
      accessibilityRole="button"
      accessibilityLabel={busy ? busyLabel : label}
      accessibilityState={{ busy }}
      style={({ pressed }) => [s.button, fill, pressed && !busy && s.pressed]}
    >
      {busy ? <ActivityIndicator color={ink} /> : <Ionicons name={icon} size={20} color={ink} />}
      <Text style={[s.label, { color: ink }]} numberOfLines={1} maxFontSizeMultiplier={1.6}>{busy ? busyLabel : label}</Text>
    </Pressable>
  );
}

/** The Session summary's Share action under a record line: share icon and word in forest, 44 pt, soft haptic. */
export function ShareLink({ accessibilityLabel, onPress }: { accessibilityLabel: string; onPress: () => void }) {
  const { semanticColors: sc } = useTheme();
  return (
    <Pressable
      onPress={() => { void HapticService.softImpact(); onPress(); }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [s.link, pressed && s.pressed]}
    >
      <Ionicons name="share-outline" size={18} color={sc.accentText} />
      <Text style={[s.label, { color: sc.accentText }]}>Share</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '92%', paddingHorizontal: layout.gutter, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet },
  grabberHit: { alignSelf: 'center', minHeight: layout.touchMin, minWidth: 88, alignItems: 'center', justifyContent: 'center' },
  grabber: { width: 40, height: 4, borderRadius: radius.chip },
  title: { ...typography.h2, marginBottom: 16 },
  lines: { gap: 8, marginTop: 16, marginBottom: 8 },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  lineIcon: { marginTop: 5 },
  lineText: { ...typography.body, flex: 1 },
  button: { minHeight: layout.buttonHeight, borderRadius: radius.button, marginTop: 12, paddingHorizontal: layout.gutter, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  pressed: { opacity: 0.86 },
  label: { ...typography.bodyMd, lineHeight: 22 },
  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: layout.touchMin, marginTop: 4 },
  footText: { ...typography.bodySmall, textAlign: 'center', flexShrink: 1 },
  link: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 8, minHeight: layout.touchMin },
});
