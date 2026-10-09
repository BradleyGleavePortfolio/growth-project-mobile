/**
 * TutorialTarget — wraps a real on-screen element so the tutorial overlay can
 * spotlight it. Measures in window coordinates on layout and reports the rect
 * to the tutorial store; unregisters on unmount so a spotlight never points
 * at a screen the client has left. Renders its children unchanged when the
 * tutorial flag is off.
 */
import React, { useCallback, useEffect, useRef } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { featureFlags } from '../../config/featureFlags';
import { registerTutorialTarget } from '../../tutorial/tutorialStore';
import type { TutorialTargetId } from '../../tutorial/tutorialSteps';

interface Props {
  /** No id: children render unchanged (lets a list mark only its first row). */
  id?: TutorialTargetId;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export default function TutorialTarget({ id, children, style }: Props): React.ReactElement {
  const ref = useRef<View>(null);

  const measure = useCallback(() => {
    if (!id) return;
    const node = ref.current as unknown as {
      measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void;
    } | null;
    node?.measureInWindow?.((x, y, width, height) => {
      if (width > 0 && height > 0) registerTutorialTarget(id, { x, y, width, height });
    });
  }, [id]);

  useEffect(() => () => {
    if (id) registerTutorialTarget(id, null);
  }, [id]);

  if (!featureFlags.clientTutorial || !id) return <>{children}</>;
  return (
    <View ref={ref} collapsable={false} onLayout={measure} style={style}>
      {children}
    </View>
  );
}
