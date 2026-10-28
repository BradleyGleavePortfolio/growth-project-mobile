/**
 * VoiceNoteWaveform — render test. Pins the stable bar count and that the strip
 * is hidden from assistive tech (decorative; the parent control carries
 * meaning).
 */
import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return {
    useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }),
  };
});

import VoiceNoteWaveform from '../VoiceNoteWaveform';

describe('VoiceNoteWaveform', () => {
  it('renders the requested bar count regardless of peak length', async () => {
    const { getByTestId } = await render(
      <VoiceNoteWaveform peaks={[0.2, 0.8]} barCount={16} />,
    );
    const strip = getByTestId('voice-waveform', { includeHiddenElements: true });
    // children: [the bars, the optional playhead slot]
    expect(strip.props.children[0]).toHaveLength(16);
    expect(strip.props.children[1]).toBeNull();
  });

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
