/**
 * VoiceNoteWaveform — render test. Pins the stable bar count and that the strip
 * is hidden from assistive tech (decorative; the parent control carries
 * meaning).
 */
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return {
    useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }),
  };
});

import VoiceNoteWaveform from '../VoiceNoteWaveform';

describe('VoiceNoteWaveform', () => {
  it.each([280, 320, 360, 390, 430])(
    'keeps the 48-bar card strip within its measured slot on a %i pt phone',
    async (phoneWidth) => {
      // A voice card nested in a feed/chat row: outer gutters, row inset,
      // card padding/border, then the 52 pt disc and 12 pt gap.
      const slotWidth = phoneWidth - 32 - 24 - 24 - 64;
      const { getByTestId } = await render(
        <VoiceNoteWaveform peaks={[0.2, 0.8]} barCount={48} height={34} gap={2} />,
      );
      const strip = () => getByTestId('voice-waveform', { includeHiddenElements: true });
      await fireEvent(strip(), 'layout', { nativeEvent: { layout: { width: slotWidth, height: 34 } } });
      const row = StyleSheet.flatten(strip().props.style);
      const bars = strip().props.children[0];
      const styles = bars.map((bar: React.ReactElement<{ style: StyleProp<ViewStyle> }>) => StyleSheet.flatten(bar.props.style));
      expect(bars).toHaveLength(48);
      // At 1x a positive subpixel border can rasterize to 1 px, not its style
      // value. The web capture exposed the resulting 14 pt overflow at 320 pt.
      const minimumWidth = styles.reduce((sum: number, bar: { width?: number; borderWidth: number }) => {
        const rasterBorder = bar.borderWidth > 0 ? Math.max(1, Math.floor(bar.borderWidth)) : 0;
        return sum + Math.max(bar.width ?? 0, rasterBorder * 2);
      }, 0) + row.gap * (bars.length - 1);
      expect(minimumWidth).toBeLessThanOrEqual(slotWidth + 0.000001);
      expect(row.height).toBe(34);
      expect(row.gap).toBe(Math.min(2, (slotWidth - 48) / 47));
      if (phoneWidth >= 360) {
        expect(styles.every((bar: { borderWidth: number }) => bar.borderWidth === 1)).toBe(true);
      }
    },
  );

  it('renders the requested bar count regardless of peak length', async () => {
    const { getByTestId } = await render(
      <VoiceNoteWaveform peaks={[0.2, 0.8]} barCount={16} />,
    );
    const strip = getByTestId('voice-waveform', { includeHiddenElements: true });
    // children: [the bars, the optional playhead slot]
    expect(strip.props.children[0]).toHaveLength(16);
    expect(strip.props.children[1]).toBeNull();
  });

  it('reduces samples only below 1 pt each, and restores the GOAL on resize', async () => {
    const { getByTestId } = await render(
      <VoiceNoteWaveform peaks={[0.2, 0.8]} barCount={48} height={34} gap={2} />,
    );
    const strip = () => getByTestId('voice-waveform', { includeHiddenElements: true });
    await fireEvent(strip(), 'layout', { nativeEvent: { layout: { width: 40, height: 34 } } });
    expect(strip().props.children[0]).toHaveLength(40);
    expect(StyleSheet.flatten(strip().props.style).gap).toBe(0);
    await fireEvent(strip(), 'layout', { nativeEvent: { layout: { width: 246, height: 34 } } });
    expect(strip().props.children[0]).toHaveLength(48);
    expect(StyleSheet.flatten(strip().props.style)).toMatchObject({ height: 34, gap: 2 });
    expect(StyleSheet.flatten(strip().props.children[0][0].props.style).borderWidth).toBe(1);
  });

  it.each([{ barCount: 34, barWidth: 4, gap: 3, height: 44 }, { barCount: 48, barWidth: 3, gap: 2, height: 34 }])(
    'leaves fixed-width strips unchanged ($barCount bars at $barWidth pt)',
    async (props) => {
      const { getByTestId } = await render(<VoiceNoteWaveform peaks={[0.2, 0.8]} {...props} />);
      const strip = getByTestId('voice-waveform', { includeHiddenElements: true });
      expect(strip.props.onLayout).toBeUndefined();
      expect(strip.props.children[0]).toHaveLength(props.barCount);
      expect(StyleSheet.flatten(strip.props.style)).toMatchObject({ height: props.height, gap: props.gap });
      expect(StyleSheet.flatten(strip.props.children[0][0].props.style)).toMatchObject({
        width: props.barWidth, borderWidth: 1,
      });
    },
  );

  it('draws the review playhead at the played fraction only when asked (GOAL 02)', async () => {
    const { getByTestId } = await render(
      <VoiceNoteWaveform peaks={[0.2, 0.8]} barCount={16} progress={0.25} playhead gap={3} />,
    );
    const head = getByTestId('voice-waveform-playhead', { includeHiddenElements: true });
    expect(head.props.style).toEqual(expect.arrayContaining([expect.objectContaining({ left: '25%' })]));
  });

  it('is hidden from assistive tech (decorative)', async () => {
    const { getByTestId } = await render(<VoiceNoteWaveform peaks={[]} />);
    const strip = getByTestId('voice-waveform', { includeHiddenElements: true });
    expect(strip.props.accessibilityElementsHidden).toBe(true);
    expect(strip.props.importantForAccessibility).toBe('no-hide-descendants');
  });
});
