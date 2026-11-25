/**
 * VoiceNoteWaveform — render test. Pins the stable bar count and that the strip
 * is hidden from assistive tech (decorative; the parent control carries
 * meaning).
 */
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { PixelRatio, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return {
    useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }),
  };
});

import VoiceNoteWaveform from '../VoiceNoteWaveform';

describe('VoiceNoteWaveform', () => {
  it.each([280, 320, 360, 390, 430].flatMap(phoneWidth =>
    [1, 2, 3].flatMap(scale => (['light', 'deep'] as const).flatMap(tone =>
      [0, 0.5].map(progress => ({ phoneWidth, scale, tone, progress }))))))(
    'keeps the 48-bar $tone strip inside $phoneWidth pt at $scale x and progress $progress',
    async ({ phoneWidth, scale, tone, progress }) => {
      const deviceScale = jest.spyOn(PixelRatio, 'get').mockReturnValue(scale);
      try {
        // A voice card nested in a feed/chat row: outer gutters, row inset,
        // card padding/border, then the 52 pt disc and 12 pt gap.
        const slotWidth = phoneWidth - 32 - 24 - 24 - 64;
        const { getByTestId } = await render(
          <VoiceNoteWaveform peaks={[0.2, 0.8]} barCount={48} height={34} gap={2} tone={tone} progress={progress} />,
        );
        const strip = () => getByTestId('voice-waveform', { includeHiddenElements: true });
        await fireEvent(strip(), 'layout', { nativeEvent: { layout: { width: slotWidth, height: 34 } } });
        const row = StyleSheet.flatten(strip().props.style);
        const bars = strip().props.children[0];
        const styles = bars.map((bar: React.ReactElement<{ style: StyleProp<ViewStyle> }>) => StyleSheet.flatten(bar.props.style));
        expect(bars).toHaveLength(48);
        // Round shared layout boundaries on the device grid, not every width in
        // isolation. Sum each rasterized bar and following gap inside the slot.
        const fittedWidth = Math.min(6, (slotWidth - row.gap * (bars.length - 1)) / bars.length);
        const raster = (position: number) => Math.round(position * scale + 1e-9);
        let totalPixels = 0;
        styles.forEach((bar: ViewStyle, index: number) => {
          const start = index * (fittedWidth + row.gap);
          const end = start + fittedWidth;
          const borderPixels = bar.borderWidth ? Math.max(1, Math.floor(bar.borderWidth * scale + 1e-9)) : 0;
          totalPixels += Math.max(raster(end) - raster(start), 2 * borderPixels);
          if (index < bars.length - 1) totalPixels += raster(end + row.gap) - raster(end);
          const edgeFits = 2 / scale < fittedWidth;
          expect(bar.borderWidth).toBe(fittedWidth >= 2 ? 1 : edgeFits ? 1 / scale : 0);
          expect(bar.borderColor === 'transparent').toBe(tone === 'deep' || index < 24 && progress === 0.5);
        });
        expect(totalPixels).toBeLessThanOrEqual(raster(slotWidth));
        expect(row.height).toBe(34);
        expect(row.gap).toBe(Math.min(2, (slotWidth - 48) / 47));
        if (phoneWidth >= 360) {
          expect(styles.every((bar: { borderWidth: number }) => bar.borderWidth === 1)).toBe(true);
        }
      } finally {
        deviceScale.mockRestore();
      }
    },
  );

  // LO-949 B1: every v1 iPhone is 2x or 3x. At 320 pt the fitted light-tone bar is ~1.71 pt, which holds a
  // one-device-pixel moss edge on each side (2x: 0.5 + 0.71 + 0.5 pt), so the GOAL's leaf-bar-with-moss-edge
  // look must survive; only a 1x screen (1 px = 1 pt) cannot fit it.
  it.each([2, 3])(
    'keeps the light strip moss edge at 320 pt on a %ix phone (one device pixel fits)',
    async (scale) => {
      const { PixelRatio } = jest.requireActual('react-native');
      const spies = [
        jest.spyOn(PixelRatio, 'get').mockReturnValue(scale),
        jest.spyOn(PixelRatio, 'roundToNearestPixel').mockImplementation((v: unknown) => Math.round((v as number) * scale) / scale),
        jest.spyOn(PixelRatio, 'getPixelSizeForLayoutSize').mockImplementation((v: unknown) => Math.round((v as number) * scale)),
      ];
      const hairline = StyleSheet.hairlineWidth;
      Object.defineProperty(StyleSheet, 'hairlineWidth', { value: 1 / scale, configurable: true, writable: true });
      try {
        const slotWidth = 320 - 32 - 24 - 24 - 64;
        const { getByTestId } = await render(
          <VoiceNoteWaveform peaks={[0.2, 0.8]} barCount={48} height={34} gap={2} tone="light" />,
        );
        const strip = () => getByTestId('voice-waveform', { includeHiddenElements: true });
        await fireEvent(strip(), 'layout', { nativeEvent: { layout: { width: slotWidth, height: 34 } } });
        const row = StyleSheet.flatten(strip().props.style);
        const bars = strip().props.children[0];
        const styles = bars.map((bar: React.ReactElement<{ style: StyleProp<ViewStyle> }>) => StyleSheet.flatten(bar.props.style));
        expect(bars).toHaveLength(48);
        const barWidth = (slotWidth - row.gap * (bars.length - 1)) / bars.length;
        for (const bar of styles as { borderWidth: number; borderColor: string }[]) {
          // A positive border rasterizes to whole device pixels, at least one.
          const raster = bar.borderWidth > 0 ? Math.max(1, Math.floor(bar.borderWidth * scale + 1e-9)) / scale : 0;
          expect(bar.borderColor).not.toBe('transparent');
          expect(raster).toBeGreaterThan(0);
          expect(2 * raster).toBeLessThan(barWidth);
        }
      } finally {
        Object.defineProperty(StyleSheet, 'hairlineWidth', { value: hairline, configurable: true, writable: true });
        spies.forEach((spy) => spy.mockRestore());
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
