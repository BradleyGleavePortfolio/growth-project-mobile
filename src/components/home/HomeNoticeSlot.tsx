/**
 * HomeNoticeSlot — the rings Home's one notice place (UI-1 spec item 9): of today's Home notices
 * that are due, only the most urgent shows, one at a time; when it is dismissed or resolved, the next
 * one shows. Each notice keeps its own rule, words and destination and asks `useNoticeSlot` before
 * it renders. Outside the slot (today's Home) every notice shows exactly as before.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

/** Most urgent first; Finish your profile last, never ahead of another (#RINGS-NOTICE-ORDER). Failed payment: under the dials (#RINGS-PAY-SLOT). */
export const NOTICE_RANK = ['invite', 'push', 'finishJoining', 'coachIntro', 'fullMacros', 'tourReoffer', 'profile'] as const;
export type NoticeId = (typeof NOTICE_RANK)[number];

const Slot = createContext<{ shown: NoticeId | undefined; report: (id: NoticeId, due: boolean) => void } | null>(null);

export function HomeNoticeSlot({ style, children }: { style?: StyleProp<ViewStyle>; children: React.ReactNode }) {
  const [due, setDue] = useState<readonly NoticeId[]>([]);
  const report = useCallback((id: NoticeId, on: boolean) => {
    setDue((prev) => (prev.includes(id) === on ? prev : on ? [...prev, id] : prev.filter((d) => d !== id)));
  }, []);
  const shown = NOTICE_RANK.find((id) => due.includes(id));
  const value = useMemo(() => ({ shown, report }), [shown, report]);
  return (
    <Slot.Provider value={value}>
      {/* The slot's spacing only while a notice shows, so an empty slot leaves no gap. */}
      <View testID="home-notice-slot" style={shown ? style : undefined}>{children}</View>
    </Slot.Provider>
  );
}

/** Whether this notice sits in the slot (the rings Home) rather than on today's Home. */
export const useInNoticeSlot = (): boolean => useContext(Slot) !== null;

/** Whether this notice renders: it is due and, inside the slot, the most urgent one due. */
export function useNoticeSlot(id: NoticeId, due: boolean): boolean {
  const slot = useContext(Slot);
  const report = slot?.report;
  useEffect(() => {
    if (!report) return undefined;
    report(id, due);
    return () => report(id, false);
  }, [report, id, due]);
  return slot ? due && slot.shown === id : due;
}
