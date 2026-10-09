/**
 * JoinPackageHost (B-PACKAGE-135) — presents JoinPackageScreen whenever an
 * accept point hands over a join (lib/joinPackage). Mounted once beside the
 * client tabs, so it works from Home, Messages, Settings and right after
 * sign-up (a join handed over before the tabs mount opens on first mount).
 */
import React, { useEffect, useState } from 'react';
import { Modal } from 'react-native';
import { subscribeJoin, takePresentedJoin, type JoinOutcome } from '../../lib/joinPackage';
import JoinPackageScreen from '../../screens/join/JoinPackageScreen';

/** Lets a closing sheet (the coach-code sheet) finish before this one opens. */
export const JOIN_SHEET_HANDOFF_MS = 400;

export default function JoinPackageHost() {
  const [open, setOpen] = useState<JoinOutcome | null>(null);

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const sync = () => {
      const shown = takePresentedJoin();
      if (!shown) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (live) setOpen(shown);
      }, JOIN_SHEET_HANDOFF_MS);
    };
    sync();
    const unsubscribe = subscribeJoin(sync);
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, []);

  return (
    <Modal
      visible={open !== null}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => setOpen(null)}
    >
      {open ? <JoinPackageScreen join={open} onClose={() => setOpen(null)} /> : null}
    </Modal>
  );
}
