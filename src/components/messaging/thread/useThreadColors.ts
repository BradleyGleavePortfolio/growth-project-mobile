import { useMemo } from 'react';
import { useTheme } from '../../../theme/ThemeProvider';

/** Thread-local aliases, all resolved from the active semantic theme. */
export function useThreadColors() {
  const { semanticColors: sc } = useTheme();
  return useMemo(() => ({
    background: sc.bgPrimary, surface: sc.bgPrimary, border: sc.border,
    primary: sc.accent, primaryText: sc.accentText, textPrimary: sc.textPrimary, textSecondary: sc.textMuted,
    textMuted: sc.textMuted, textOnPrimary: sc.textOnAccent,
    overlay: sc.overlay,
    disabledBg: sc.disabledBg, textOnDisabled: sc.textOnDisabled,
  }), [sc]);
}

export type ThreadColors = ReturnType<typeof useThreadColors>;
