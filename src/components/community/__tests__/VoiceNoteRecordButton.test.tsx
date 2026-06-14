/**
 * VoiceNoteRecordButton — presentational render-state tests. Pins that the
 * idle/recording/stopping states expose the right accessible label + action,
 * and that stopping is a real busy/disabled state (not a dead spinner).
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return {
    useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }),
  };
});

import VoiceNoteRecordButton from '../VoiceNoteRecordButton';

const noop = () => {};

describe('VoiceNoteRecordButton', () => {
  it('idle → labelled "Record a voice note" and tap starts', async () => {
    const onStart = jest.fn();
    const { getByTestId } = await render(
      <VoiceNoteRecordButton
        status="idle"
        elapsedMs={0}
        maxDurationMs={300_000}
        onStart={onStart}
        onStop={noop}
      />,
    );
    const btn = getByTestId('voice-record-button');
    expect(btn.props.accessibilityLabel).toBe('Record a voice note');
    fireEvent.press(btn);
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('recording → shows elapsed time and tap stops', async () => {
    const onStop = jest.fn();
    const { getByTestId } = await render(
      <VoiceNoteRecordButton
        status="recording"
        elapsedMs={65_000}
        maxDurationMs={300_000}
        onStart={noop}
        onStop={onStop}
      />,
    );
    const btn = getByTestId('voice-record-button');
    expect(btn.props.accessibilityLabel).toBe('Stop recording at 1:05');
    fireEvent.press(btn);
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('stopping → busy + disabled, and presses are inert', async () => {
    const onStart = jest.fn();
    const onStop = jest.fn();
    const { getByTestId } = await render(
      <VoiceNoteRecordButton
        status="stopping"
        elapsedMs={3000}
        maxDurationMs={300_000}
        onStart={onStart}
        onStop={onStop}
      />,
    );
    const btn = getByTestId('voice-record-button');
    expect(btn.props.accessibilityState).toMatchObject({
      busy: true,
      disabled: true,
    });
    fireEvent.press(btn);
    expect(onStart).not.toHaveBeenCalled();
    expect(onStop).not.toHaveBeenCalled();
  });
});
