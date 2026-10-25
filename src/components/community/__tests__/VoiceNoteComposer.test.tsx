/**
 * VoiceNoteComposer — the Style B record sheet body. The recorder port is
 * injected (deterministic capture). Pins the honest states the audit cares about:
 *   • unavailable build → calm notice, one full-width Close, NO record button (GOAL 10b);
 *   • the sheet records as it opens — one tap from Record (GOAL 01b, LO-848 B1);
 *   • mic denied → a REAL recovery action (try again / open settings);
 *   • recording → elapsed · line · 5:00 and a 76 pt stop disc (LO-848 B2);
 *   • recorded → listen back + Send hands the recording to the outbox.
 */
import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { Linking, StyleSheet } from 'react-native';

type GetByTestId = Awaited<ReturnType<typeof render>>['getByTestId'];

jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return {
    useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }),
  };
});

import VoiceNoteComposer from '../VoiceNoteComposer';
import type {
  VoiceRecorderPort,
  VoiceRecordingResult,
  MicPermissionStatus,
} from '../../../hooks/voiceRecorderPort';

const mockSend = jest.fn();
const mockClose = jest.fn();
const props = { onSend: mockSend, onClose: mockClose };
const RESULT: VoiceRecordingResult = {
  uri: 'file:///tmp/rec.m4a',
  durationMs: 4200,
  bytes: 50_000,
  mimeType: 'audio/mp4',
  peaks: [0.2, 0.6, 0.9],
};

function makePort(o: Partial<VoiceRecorderPort> = {}): VoiceRecorderPort {
  return {
    isAvailable: true,
    getPermissionStatus: jest
      .fn<Promise<MicPermissionStatus>, []>()
      .mockResolvedValue('granted'),
    requestPermission: jest
      .fn<Promise<MicPermissionStatus>, []>()
      .mockResolvedValue('granted'),
    start: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
    stop: jest
      .fn<Promise<VoiceRecordingResult>, []>()
      .mockResolvedValue(RESULT),
    cancel: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
    ...o,
  };
}

const target = { kind: 'cohort' as const, cohortName: 'Spring Block' };

beforeEach(() => {
  mockSend.mockReset();
  mockClose.mockReset();
});

describe('VoiceNoteComposer — honest states', () => {
  it('renders a calm notice and NO record button on an unavailable build', async () => {
    const port = makePort({ isAvailable: false });
    const { getByTestId, queryByTestId } = await render(
      <VoiceNoteComposer {...props} target={target} recorder={port} />,
    );
    expect(getByTestId('voice-composer-unavailable')).toBeTruthy();
    expect(queryByTestId('voice-record-button')).toBeNull();
    expect(queryByTestId('voice-composer-cancel')).toBeNull();
    fireEvent.press(getByTestId('voice-composer-close'));
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it('starts recording as the sheet opens, with no second tap (LO-848 B1)', async () => {
    const port = makePort();
    const { getByTestId, findByTestId } = await render(
      <VoiceNoteComposer {...props} target={target} recorder={port} />,
    );
    expect(await findByTestId('voice-composer-line-max', { includeHiddenElements: true })).toBeTruthy();
    expect(port.start).toHaveBeenCalledTimes(1);
    expect(getByTestId('voice-record-button').props.accessibilityLabel).toMatch(/stop/i);
    expect(getByTestId('voice-privacy-copy').props.accessibilityLabel).toBe(
      'Everyone in Spring Block can hear this voice note.',
    );
  });

  it('shows elapsed · line · 5:00 and the 76 pt stop disc while recording (LO-848 B2)', async () => {
    const port = makePort();
    const { getByTestId, findByTestId } = await render(
      <VoiceNoteComposer {...props} target={target} recorder={port} />,
    );
    const max = await findByTestId('voice-composer-line-max', { includeHiddenElements: true });
    expect(max.props.children).toBe('5:00');
    expect(getByTestId('voice-composer-line-elapsed', { includeHiddenElements: true }).props.children).toBe('0:00');
    const disc = StyleSheet.flatten(getByTestId('voice-record-button').props.style);
    expect([disc.width, disc.height]).toEqual([76, 76]);
  });
});

describe('VoiceNoteComposer — mic denial recovery', () => {
  it('routes to Settings when the OS will no longer prompt', async () => {
    const openSettings = jest
      .spyOn(Linking, 'openSettings')
      .mockImplementation(async () => {});
    const port = makePort({
      getPermissionStatus: jest.fn().mockResolvedValue('undetermined'),
      requestPermission: jest.fn().mockResolvedValue('denied'),
    });
    const { getByTestId } = await render(
      <VoiceNoteComposer {...props} target={target} recorder={port} />,
    );

    // The sheet asks as it opens; no tap on a record disc first.
    await waitFor(() => expect(getByTestId('voice-composer-denied')).toBeTruthy());

    fireEvent.press(getByTestId('voice-composer-permission-action'));
    await waitFor(() => expect(openSettings).toHaveBeenCalled());
    openSettings.mockRestore();
  });
});

describe('VoiceNoteComposer — review + send', () => {
  // Recording starts as the sheet opens; one tap on stop ends it.
  async function recordTo(getByTestId: GetByTestId) {
    await waitFor(() => expect(getByTestId('voice-record-button').props.accessibilityLabel).toMatch(/stop/i));
    await act(async () => {
      fireEvent.press(getByTestId('voice-record-button'));
    });
  }

  it('Send hands the recording to the outbox', async () => {
    const port = makePort();
    const { getByTestId } = await render(<VoiceNoteComposer {...props} target={target} recorder={port} />);
    await recordTo(getByTestId);
    await waitFor(() => expect(getByTestId('voice-composer-review')).toBeTruthy());
    expect(getByTestId('voice-composer-preview-duration', { includeHiddenElements: true }).props.children).toBe('0:04');
    expect(getByTestId('voice-composer-listen')).toBeTruthy();
    fireEvent.press(getByTestId('voice-composer-send'));
    expect(mockSend).toHaveBeenCalledWith(RESULT);
  });
});

describe('VoiceNoteComposer — recorder failure (B-314-7)', () => {
  it('a microphone that cannot start shows what happened, a Try again and a support reference', async () => {
    const port = makePort({ start: jest.fn().mockRejectedValue(new Error('session busy')) });
    const { getByTestId, findByTestId, getByText } = await render(
      <VoiceNoteComposer {...props} target={target} recorder={port} />,
    );
    const notice = await findByTestId('voice-composer-error');
    expect(notice).toBeTruthy();
    expect(getByText(/The microphone could not start recording\. Try again\./)).toBeTruthy();
    expect(getByText(/mention reference [A-Za-z0-9-]{8}/)).toBeTruthy();
    expect(getByText(/@/)).toBeTruthy();
    fireEvent.press(getByTestId('voice-composer-error-retry'));
    await waitFor(() => expect(getByTestId('voice-record-button')).toBeTruthy());
    // Try again lands on the record disc; it does not start a second take by itself.
    expect(port.start).toHaveBeenCalledTimes(1);
  });

  it('a permission read that fails says so instead of leaving an idle button', async () => {
    const port = makePort({
      getPermissionStatus: jest.fn().mockRejectedValue(new Error('perm read failed')),
    });
    const { findByText } = await render(
      <VoiceNoteComposer {...props} target={target} recorder={port} />,
    );
    expect(await findByText(/Microphone access could not be checked on this phone\./)).toBeTruthy();
  });
});

// LO-848R4 B4: GOAL draws every voice word in Inter (Cormorant only for the big timer). Every host
// Text in each sheet state must name a loaded face, so the phone never falls back to the system face.
describe('VoiceNoteComposer — loaded faces (LO-848R4 B4)', () => {
  const FACE = /^(Inter_|CormorantGaramond_|ionicons$)/; // ionicons: the icon glyph font
  type Root = Awaited<ReturnType<typeof render>>['container'];
  const unfaced = (root: Root) =>
    root
      .queryAll((n) => n.type === 'Text')
      .map((n) => ({ text: String(n.props.children), face: StyleSheet.flatten(n.props.style)?.fontFamily }))
      .filter((t) => !FACE.test(String(t.face ?? '')));

  it('recording, review, denied and unavailable name a loaded face on every line', async () => {
    const live = await render(<VoiceNoteComposer {...props} target={target} recorder={makePort()} />);
    await waitFor(() => expect(live.getByTestId('voice-record-button').props.accessibilityLabel).toMatch(/stop/i));
    expect(unfaced(live.container)).toEqual([]);
    await act(async () => {
      fireEvent.press(live.getByTestId('voice-record-button'));
    });
    await waitFor(() => expect(live.getByTestId('voice-composer-review')).toBeTruthy());
    expect(unfaced(live.container)).toEqual([]);
    await live.unmount();

    const denied = await render(
      <VoiceNoteComposer
        {...props}
        target={target}
        recorder={makePort({
          getPermissionStatus: jest.fn().mockResolvedValue('undetermined'),
          requestPermission: jest.fn().mockResolvedValue('denied'),
        })}
      />,
    );
    await waitFor(() => expect(denied.getByTestId('voice-composer-denied')).toBeTruthy());
    expect(unfaced(denied.container)).toEqual([]);
    await denied.unmount();

    const off = await render(
      <VoiceNoteComposer {...props} target={target} recorder={makePort({ isAvailable: false })} />,
    );
    expect(unfaced(off.container)).toEqual([]);
  });
});

// LO-848R4 B6: the GOAL B-01/02/07 rhythm — no blanket gap, each row its own GOAL margin; the live
// strip is 30 slots, un-arrived ones are ghost bars, and it is only as tall as its tallest bar; the
// denied buttons are the .btn 54 pt height.
describe('VoiceNoteComposer — GOAL sheet rhythm and live strip (FR-848R5)', () => {
  const flat = (n: { props: { style?: unknown } }): Record<string, unknown> =>
    (StyleSheet.flatten(n.props.style as never) ?? {}) as Record<string, unknown>;
  const hidden = { includeHiddenElements: true };

  it('recording: per-row GOAL margins, 30 slots with ghost bars, a strip that sizes to its bars', async () => {
    const { findByTestId, getByTestId } = await render(
      <VoiceNoteComposer {...props} target={target} recorder={makePort()} />,
    );
    const levels = await findByTestId('voice-composer-levels', hidden);
    expect(flat(getByTestId('voice-composer')).gap).toBeUndefined();
    expect(flat(getByTestId('voice-composer-timer', hidden))).toMatchObject({ marginTop: 4, fontSize: 56 });
    const strip = flat(levels);
    expect(strip).toMatchObject({ marginTop: 12, marginBottom: 10, gap: 4 });
    expect(strip.height).toBeUndefined();
    expect(levels.children).toHaveLength(30);
    const ghosts = levels.children.filter((c) => typeof c !== 'string' && flat(c).backgroundColor === '#E2E6E1');
    expect(ghosts.length).toBeGreaterThan(0);
    for (const g of ghosts) {
      if (typeof g === 'string') continue;
      const st = flat(g);
      expect(st).toMatchObject({ width: 5, borderRadius: 2 });
      expect(st.height).toBeGreaterThanOrEqual(3);
      expect(st.height).toBeLessThanOrEqual(10);
    }
    expect(flat(getByTestId('voice-composer-line-max', hidden).parent!)).toMatchObject({ marginTop: 4, marginBottom: 16 });
    expect(flat(getByTestId('voice-privacy-copy').parent!)).toMatchObject({ marginTop: 16, marginBottom: 12 });
  });

  it('review: the listen row 14 / 12 and the buttons 14 / 10', async () => {
    const { findByTestId, getByTestId } = await render(
      <VoiceNoteComposer {...props} target={target} recorder={makePort()} />,
    );
    await waitFor(() => expect(getByTestId('voice-record-button').props.accessibilityLabel).toMatch(/stop/i));
    await act(async () => {
      fireEvent.press(getByTestId('voice-record-button'));
    });
    await findByTestId('voice-composer-review');
    expect(flat(getByTestId('voice-composer-listen').parent!)).toMatchObject({ marginTop: 14, marginBottom: 12 });
    expect(flat(getByTestId('voice-composer-review-actions'))).toMatchObject({ gap: 10, marginTop: 14, marginBottom: 10 });
  });

  it('denied: Open Settings and Not now are both 54 pt', async () => {
    const { getByTestId } = await render(
      <VoiceNoteComposer
        {...props}
        target={target}
        recorder={makePort({
          getPermissionStatus: jest.fn().mockResolvedValue('undetermined'),
          requestPermission: jest.fn().mockResolvedValue('denied'),
        })}
      />,
    );
    await waitFor(() => expect(getByTestId('voice-composer-denied')).toBeTruthy());
    expect(flat(getByTestId('voice-composer-permission-action')).minHeight).toBe(54);
    expect(flat(getByTestId('voice-composer-not-now')).minHeight).toBe(54);
  });
});
