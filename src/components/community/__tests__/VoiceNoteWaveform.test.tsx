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
    expect(strip.props.children).toHaveLength(16);
  });

  it('is hidden from assistive tech (decorative)', async () => {
    const { getByTestId } = await render(<VoiceNoteWaveform peaks={[]} />);
    const strip = getByTestId('voice-waveform', { includeHiddenElements: true });
    expect(strip.props.accessibilityElementsHidden).toBe(true);
    expect(strip.props.importantForAccessibility).toBe('no-hide-descendants');
  });
});
