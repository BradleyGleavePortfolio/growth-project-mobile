/**
 * SafetyMenu — Report (with reason) and Block on community content (Apple 1.2).
 */
import React from 'react';
import { Alert, Platform, type AlertButton } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SafetyMenu from '../SafetyMenu';

jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return { useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }) };
});

jest.mock('../../HapticPressable', () => {
  const React = require('react');
  const { Pressable } = require('react-native');
  return {
    __esModule: true,
    default: ({
      children,
      onPress,
      testID,
    }: {
      children: React.ReactNode;
      onPress?: () => void;
      testID?: string;
    }) => React.createElement(Pressable, { onPress, testID }, children),
  };
});

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const mockCapture = jest.fn();
jest.mock('../../../services/sentry', () => ({
  captureError: (...a: unknown[]) => mockCapture(...a),
}));

const mockReport = jest.fn();
const mockBlock = jest.fn();
jest.mock('../../../api/communitySafetyApi', () => {
  const actual = jest.requireActual('../../../api/communitySafetyApi');
  return {
    ...actual,
    communitySafetyApi: {
      report: (...a: unknown[]) => mockReport(...a),
      block: (...a: unknown[]) => mockBlock(...a),
    },
  };
});

const ME = 'me-1';
const OTHER = 'other-1';

async function renderMenu(props: Partial<React.ComponentProps<typeof SafetyMenu>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = jest.spyOn(qc, 'invalidateQueries');
  const utils = await render(
    <QueryClientProvider client={qc}>
      <SafetyMenu
        targetType="post"
        targetId="post-1"
        authorUserId={OTHER}
        authorName="Sam"
        viewerUserId={ME}
        testID="sm"
        {...props}
      />
    </QueryClientProvider>,
  );
  return { ...utils, invalidate };
}

let alertSpy: jest.SpyInstance;
const realOS = Platform.OS;
const setOS = (os: string) => Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
beforeEach(() => {
  mockReport.mockReset().mockResolvedValue(undefined);
  mockBlock.mockReset().mockResolvedValue(undefined);
  mockCapture.mockReset();
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  // Android raises a follow-up Alert as soon as the sheet closes; the iOS path (wait for the Modal's
  // onDismiss) has its own block below (Opus R5-B4).
  setOS('android');
});
afterEach(() => {
  alertSpy.mockRestore();
  setOS(realOS);
});

/** The Modal's onDismiss, read while the sheet is up (the jest Modal renders nothing once closed). */
function sheetDismiss(getByTestId: (id: string) => { props: Record<string, unknown>; parent: unknown }, id = 'sm') {
  let node = getByTestId(`${id}-sheet`) as { props: Record<string, unknown>; parent: unknown } | null;
  while (node && typeof node.props.onDismiss !== 'function') {
    node = node.parent as typeof node;
  }
  if (!node) throw new Error('no Modal onDismiss');
  return node.props.onDismiss as () => void;
}

function pressAlertButton(text: string) {
  const call = alertSpy.mock.calls[alertSpy.mock.calls.length - 1];
  const buttons = (call[2] ?? []) as AlertButton[];
  const b = buttons.find((x) => x.text === text);
  if (!b?.onPress) throw new Error(`no alert button ${text}`);
  return b.onPress();
}

describe('SafetyMenu', () => {
  it('renders nothing for the viewer’s own content', async () => {
    const { queryByTestId } = await renderMenu({ authorUserId: ME });
    expect(queryByTestId('sm')).toBeNull();
  });

  it('reports with the chosen reason and thanks the reporter', async () => {
    const { getByTestId } = await renderMenu();
    await fireEvent.press(getByTestId('sm'));
    await fireEvent.press(getByTestId('sm-report'));
    await fireEvent.press(getByTestId('sm-reason-harassment'));
    await waitFor(() =>
      expect(mockReport).toHaveBeenCalledWith({
        target_type: 'post',
        target_id: 'post-1',
        reason: 'harassment',
      }),
    );
    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith(
        'Report sent',
        'Thank you. Reports are reviewed within 24 hours, every day, by your coach and the TGP Fitness team. Content that breaks these guidelines is removed, and people who break them repeatedly lose access.',
      ),
    );
  });

  // FWC-SAFE-128 U11: a bystander who reports self-harm gets the crisis lines
  // in the moment, first, before the 24-hour review sentence.
  const SENT =
    'Thank you. Reports are reviewed within 24 hours, every day, by your coach and the TGP Fitness team. Content that breaks these guidelines is removed, and people who break them repeatedly lose access.';

  it('a self-harm report leads with 911 and the 988 Lifeline, then the review line', async () => {
    const { getByTestId } = await renderMenu();
    await fireEvent.press(getByTestId('sm'));
    await fireEvent.press(getByTestId('sm-report'));
    await fireEvent.press(getByTestId('sm-reason-self_harm'));
    await waitFor(() =>
      expect(mockReport).toHaveBeenCalledWith({
        target_type: 'post',
        target_id: 'post-1',
        reason: 'self_harm',
      }),
    );
    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith(
        'Report sent',
        `If someone is in immediate danger, call 911. To reach the 988 Suicide & Crisis Lifeline, call or text 988.\n\n${SENT}`,
      ),
    );
  });

  it('keeps every action reachable: Report, all eight reasons, Block and Cancel', async () => {
    const { getByTestId, queryByTestId } = await renderMenu();
    await fireEvent.press(getByTestId('sm'));
    expect(getByTestId('sm-block')).toBeTruthy();
    await fireEvent.press(getByTestId('sm-report'));
    for (const code of [
      'harassment',
      'hate',
      'sexual',
      'violence',
      'self_harm',
      'spam',
      'misinformation',
      'other',
    ]) {
      expect(getByTestId(`sm-reason-${code}`)).toBeTruthy();
    }
    await fireEvent.press(getByTestId('sm-close'));
    expect(queryByTestId('sm-reason-self_harm')).toBeNull();
    expect(mockReport).not.toHaveBeenCalled();
  });

  it('blocks only after confirmation, then refetches community data and calls onBlocked', async () => {
    const onBlocked = jest.fn();
    const { getByTestId, invalidate } = await renderMenu({ onBlocked });
    await fireEvent.press(getByTestId('sm'));
    await fireEvent.press(getByTestId('sm-block'));
    expect(mockBlock).not.toHaveBeenCalled();
    // Two-way block copy: both people stop seeing each other.
    expect(alertSpy).toHaveBeenCalledWith(
      'Block Sam?',
      // FR-877 B1: no promise of silence; the RC-BLOCK sentence (SoT A6.0-170) says what the other person sees.
      "You and Sam will no longer see each other's posts, comments, messages or voice notes, and neither of you can message the other. In a direct message they see that you blocked them; nobody else is told. You can unblock them from Community safety.",
      expect.any(Array),
    );
    await act(async () => {
      await pressAlertButton('Block');
    });
    expect(mockBlock).toHaveBeenCalledWith(OTHER);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['community'] });
    expect(onBlocked).toHaveBeenCalledWith(OTHER);
  });

  it('shows the server copy when blocking the coach is refused', async () => {
    const err = Object.assign(new Error('403'), {
      response: {
        status: 403,
        data: {
          code: 'community.block.workspace_coach',
          message: 'You cannot block your coach. You can report a message or post.',
        },
      },
    });
    mockBlock.mockRejectedValueOnce(err);
    const { getByTestId } = await renderMenu();
    await fireEvent.press(getByTestId('sm'));
    await fireEvent.press(getByTestId('sm-block'));
    await act(async () => {
      await pressAlertButton('Block');
    });
    expect(alertSpy).toHaveBeenLastCalledWith(
      'Not blocked',
      'You cannot block your coach. You can report a message or post.',
    );
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('does not offer Block on the coach’s own content (no dead button); Report stays', async () => {
    const { getByTestId, queryByTestId } = await renderMenu({
      authorUserId: 'coach-1',
      authorName: 'Coach Dana',
      viewerCoachId: 'coach-1',
    });
    await fireEvent.press(getByTestId('sm'));
    expect(getByTestId('sm-report')).toBeTruthy();
    expect(queryByTestId('sm-block')).toBeNull();
  });

  it('a refused report says what happened and what to do (rate limit, offline)', async () => {
    mockReport.mockRejectedValueOnce(
      Object.assign(new Error('429'), { response: { status: 429, data: {} } }),
    );
    const { getByTestId } = await renderMenu();
    await fireEvent.press(getByTestId('sm'));
    await fireEvent.press(getByTestId('sm-report'));
    await fireEvent.press(getByTestId('sm-reason-harassment'));
    await waitFor(() =>
      expect(alertSpy).toHaveBeenLastCalledWith(
        'Report not sent',
        'You are doing that a little too often. Wait a minute, then try again.',
      ),
    );
    mockReport.mockRejectedValueOnce(
      Object.assign(new Error('Network Error'), { isAxiosError: true, config: { headers: {} } }),
    );
    // the sheet stays on the reasons so the member can send again at once
    await fireEvent.press(getByTestId('sm-reason-spam'));
    await waitFor(() =>
      expect(alertSpy).toHaveBeenLastCalledWith(
        'Report not sent',
        'You appear to be offline. Check your connection, then try again.',
      ),
    );
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('an unexpected failure shows a short reference and the support email, and goes to Sentry', async () => {
    mockReport.mockRejectedValueOnce(
      Object.assign(new Error('500'), {
        response: {
          status: 500,
          data: {},
          headers: { 'x-request-id': '3f2a9c1e-1111-4222-8333-444455556666' },
        },
      }),
    );
    const { getByTestId } = await renderMenu();
    await fireEvent.press(getByTestId('sm'));
    await fireEvent.press(getByTestId('sm-report'));
    await fireEvent.press(getByTestId('sm-reason-harassment'));
    await waitFor(() =>
      expect(alertSpy).toHaveBeenLastCalledWith(
        'Report not sent',
        expect.stringContaining('quote reference 3F2A9C1E'),
      ),
    );
    const last = alertSpy.mock.calls[alertSpy.mock.calls.length - 1];
    expect(last[1]).toMatch(/@/);
    expect(last[1]).not.toMatch(/!/);
    expect(mockCapture).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        action: 'report',
        request_id: '3f2a9c1e-1111-4222-8333-444455556666',
        reference: '3F2A9C1E',
      }),
    );
  });

  it('hides Block when the author is unknown but still allows Report', async () => {
    const { getByTestId, queryByTestId } = await renderMenu({ authorUserId: null });
    await fireEvent.press(getByTestId('sm'));
    expect(getByTestId('sm-report')).toBeTruthy();
    expect(queryByTestId('sm-block')).toBeNull();
  });

  it('reports a voice note with the voice_note target type', async () => {
    const voice = await renderMenu({
      targetType: 'voice_note',
      targetId: 'vn-1',
    });
    await fireEvent.press(voice.getByTestId('sm'));
    await fireEvent.press(voice.getByTestId('sm-report'));
    await fireEvent.press(voice.getByTestId('sm-reason-sexual'));
    await waitFor(() =>
      expect(mockReport).toHaveBeenCalledWith({
        target_type: 'voice_note',
        target_id: 'vn-1',
        reason: 'sexual',
      }),
    );
  });

  it('reports a member win with the win target type', async () => {
    const win = await renderMenu({ targetType: 'win', targetId: 'win-1' });
    await fireEvent.press(win.getByTestId('sm'));
    await fireEvent.press(win.getByTestId('sm-report'));
    await fireEvent.press(win.getByTestId('sm-reason-spam'));
    await waitFor(() =>
      expect(mockReport).toHaveBeenCalledWith({
        target_type: 'win',
        target_id: 'win-1',
        reason: 'spam',
      }),
    );
  });

  it('offers Delete (not Report or Block) on the viewer’s own content when the screen allows it', async () => {
    const onDelete = jest.fn().mockResolvedValue(undefined);
    const { getByTestId, queryByTestId } = await renderMenu({
      authorUserId: ME,
      onDelete,
      contentNoun: 'win',
    });
    await fireEvent.press(getByTestId('sm'));
    expect(queryByTestId('sm-report')).toBeNull();
    expect(queryByTestId('sm-block')).toBeNull();
    await fireEvent.press(getByTestId('sm-delete'));
    expect(onDelete).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith(
      'Delete this win?',
      'It will be removed for everyone in your community. This cannot be undone.',
      expect.any(Array),
    );
    await act(async () => {
      await pressAlertButton('Delete');
    });
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('a failed delete says what happened and what to do next', async () => {
    const onDelete = jest.fn().mockRejectedValue({
      isAxiosError: true,
      response: {
        status: 403,
        data: {
          code: 'community.voice.not_author',
          message:
            'Only the person who recorded this voice note, or your coach, can delete it. You can report it instead.',
        },
      },
    });
    const { getByTestId } = await renderMenu({
      authorUserId: ME,
      onDelete,
      contentNoun: 'voice note',
      targetType: 'voice_note',
    });
    await fireEvent.press(getByTestId('sm'));
    await fireEvent.press(getByTestId('sm-delete'));
    await act(async () => {
      await pressAlertButton('Delete');
    });
    expect(alertSpy).toHaveBeenLastCalledWith(
      'Not deleted',
      'Only the person who recorded this voice note, or your coach, can delete it. You can report it instead.',
    );
    expect(mockCapture).not.toHaveBeenCalled();
  });
});

// LO-848R4 B1-B3 (GOAL B-06a..c): the GOAL report sheet, the fold callback and the coach's Delete.
describe('SafetyMenu — GOAL B-06 sheet (FR-848R5)', () => {
  const { StyleSheet } = jest.requireActual('react-native');
  const { COMMUNITY_GUIDELINES } = jest.requireActual('../../../api/communitySafetyApi');
  const flat = (n: { props: { style?: unknown } }) => StyleSheet.flatten(n.props.style);

  it('draws the GOAL sheet: white, 24 corners, the note card, 18 pt heading and the emergency line', async () => {
    const { getByTestId, getByText } = await renderMenu({
      targetType: 'voice_note',
      context: { name: 'Maya Patel', detail: 'voice note · 0:21' },
    });
    await fireEvent.press(getByTestId('sm'));
    expect(flat(getByTestId('sm-sheet'))).toMatchObject({
      backgroundColor: '#FFFFFF',
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      paddingHorizontal: 20,
      paddingTop: 8,
    });
    await fireEvent.press(getByTestId('sm-report'));
    expect(flat(getByTestId('sm-context'))).toMatchObject({ borderWidth: 1, borderColor: '#E2E6E1', borderRadius: 16 });
    expect(getByText('Maya Patel')).toBeTruthy();
    expect(getByText(/voice note · 0:21/)).toBeTruthy();
    expect(flat(getByText('Why are you reporting this?'))).toMatchObject({ fontSize: 18, fontWeight: '600' });
    const emergency = getByTestId('sm-emergency');
    expect(emergency.props.children).toBe(COMMUNITY_GUIDELINES[COMMUNITY_GUIDELINES.length - 1]);
    expect(flat(emergency)).toMatchObject({ backgroundColor: '#EEF4E2', borderColor: '#D3E2B8', borderRadius: 16, fontSize: 14 });
    expect(flat(getByText('Cancel'))).toMatchObject({ fontSize: 16, fontWeight: '600', color: '#2C4A36' });
  });

  it('calls onReported once the report is sent, and not when it fails', async () => {
    const onReported = jest.fn();
    const { getByTestId } = await renderMenu({ onReported });
    await fireEvent.press(getByTestId('sm'));
    await fireEvent.press(getByTestId('sm-report'));
    await fireEvent.press(getByTestId('sm-reason-spam'));
    await waitFor(() => expect(onReported).toHaveBeenCalledTimes(1));

    mockReport.mockRejectedValueOnce(new Error('offline'));
    const failed = jest.fn();
    const second = await renderMenu({ onReported: failed, testID: 'sm2' });
    await fireEvent.press(second.getByTestId('sm2'));
    await fireEvent.press(second.getByTestId('sm2-report'));
    await fireEvent.press(second.getByTestId('sm2-reason-spam'));
    await waitFor(() => expect(mockReport).toHaveBeenCalledTimes(2));
    expect(failed).not.toHaveBeenCalled();
  });

  it('a coach on another member’s note gets Report, Block and Delete, confirmed first (GOAL B-06c)', async () => {
    const onDelete = jest.fn().mockResolvedValue(undefined);
    const { getByTestId } = await renderMenu({ targetType: 'voice_note', contentNoun: 'voice note', onDelete });
    await fireEvent.press(getByTestId('sm'));
    expect(getByTestId('sm-report')).toBeTruthy();
    expect(getByTestId('sm-block')).toBeTruthy();
    await fireEvent.press(getByTestId('sm-delete'));
    expect(onDelete).not.toHaveBeenCalled();
    const [title, message, buttons] = alertSpy.mock.calls[alertSpy.mock.calls.length - 1];
    expect(title).toBe('Delete this voice note?');
    expect(message).toBe('It will be removed for everyone in your community. This cannot be undone.');
    expect((buttons as AlertButton[]).map((b) => b.text)).toEqual(['Cancel', 'Delete']);
    await act(async () => {
      await pressAlertButton('Delete');
    });
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('every line of the sheet names a loaded Inter face', async () => {
    const { getByTestId, container } = await renderMenu({ context: { name: 'Maya', detail: 'voice note · 0:21' } });
    await fireEvent.press(getByTestId('sm'));
    await fireEvent.press(getByTestId('sm-report'));
    const texts = container.queryAll((n) => n.type === 'Text');
    expect(texts.length).toBeGreaterThan(10);
    for (const t of texts) expect(String(flat(t)?.fontFamily)).toMatch(/^Inter_/);
  });
});

// REMOVED-BY-M (owner #174-4): a reported item keeps its menu; the coach's Remove is asked in the same sheet.
describe('SafetyMenu — Reported and Remove for everyone (REMOVED-BY-M)', () => {
  const { StyleSheet } = jest.requireActual('react-native');
  const flat = (n: { props: { style?: unknown } }) => StyleSheet.flatten(n.props.style);

  it('a reported item shows Report as done (not a button) and keeps Block', async () => {
    const { getByTestId, queryByTestId, getByText } = await renderMenu({ targetType: 'voice_note', reported: true });
    await fireEvent.press(getByTestId('sm'));
    const done = getByTestId('sm-reported');
    expect(done.props.accessibilityState).toEqual({ disabled: true });
    expect(done.props.accessibilityLabel).toBe('Reported');
    expect(getByText('Reported')).toBeTruthy();
    expect(flat(getByText('Reported'))).toMatchObject({ color: '#5A5A56' });
    expect(queryByTestId('sm-report')).toBeNull();
    expect(getByTestId('sm-block')).toBeTruthy();
  });

  it('Remove for everyone swaps the menu for the question in the same sheet; no alert', async () => {
    const onRemove = jest.fn().mockResolvedValue(undefined);
    const { getByTestId, queryByTestId, getByText } = await renderMenu({
      targetType: 'voice_note',
      contentNoun: 'voice note',
      onRemove,
    });
    await fireEvent.press(getByTestId('sm'));
    expect(getByTestId('sm-report')).toBeTruthy();
    expect(getByTestId('sm-block')).toBeTruthy();
    await fireEvent.press(getByTestId('sm-remove'));
    expect(onRemove).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
    expect(getByTestId('sm-confirm-remove')).toBeTruthy();
    expect(queryByTestId('sm-report')).toBeNull();
    expect(queryByTestId('sm-block')).toBeNull();
    expect(queryByTestId('sm-remove')).toBeNull();
    expect(flat(getByText('Remove this voice note for everyone?'))).toMatchObject({ fontSize: 18, fontWeight: '600' });
    expect(getByText('Everyone here will see that you removed it.')).toBeTruthy();
    expect(flat(getByText('Remove for everyone'))).toMatchObject({ fontSize: 16, fontWeight: '600' });
    await act(async () => {
      fireEvent.press(getByTestId('sm-remove-confirm'));
    });
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(alertSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(queryByTestId('sm-confirm-remove')).toBeNull());
  });

  it('Cancel on the question removes nothing and the next open starts at the menu', async () => {
    const onRemove = jest.fn().mockResolvedValue(undefined);
    const { getByTestId, queryByTestId } = await renderMenu({ onRemove });
    await fireEvent.press(getByTestId('sm'));
    await fireEvent.press(getByTestId('sm-remove'));
    await fireEvent.press(getByTestId('sm-close'));
    expect(onRemove).not.toHaveBeenCalled();
    await fireEvent.press(getByTestId('sm'));
    expect(getByTestId('sm-remove')).toBeTruthy();
    expect(queryByTestId('sm-confirm-remove')).toBeNull();
  });

  it('a failed remove says what happened and keeps the sheet open', async () => {
    const onRemove = jest.fn().mockRejectedValue(new Error('offline'));
    const { getByTestId } = await renderMenu({ onRemove });
    await fireEvent.press(getByTestId('sm'));
    await fireEvent.press(getByTestId('sm-remove'));
    await act(async () => {
      fireEvent.press(getByTestId('sm-remove-confirm'));
    });
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(getByTestId('sm-confirm-remove')).toBeTruthy();
  });

  it('own content never gets Remove; it keeps Delete', async () => {
    const onRemove = jest.fn().mockResolvedValue(undefined);
    const onDelete = jest.fn().mockResolvedValue(undefined);
    const { getByTestId, queryByTestId } = await renderMenu({ authorUserId: ME, onRemove, onDelete });
    await fireEvent.press(getByTestId('sm'));
    expect(queryByTestId('sm-remove')).toBeNull();
    expect(queryByTestId('sm-reported')).toBeNull();
    expect(getByTestId('sm-delete')).toBeTruthy();
  });

  it('every line of the question names a loaded Inter face', async () => {
    const { getByTestId, container } = await renderMenu({ onRemove: jest.fn().mockResolvedValue(undefined) });
    await fireEvent.press(getByTestId('sm'));
    await fireEvent.press(getByTestId('sm-remove'));
    const texts = container.queryAll((n) => n.type === 'Text');
    expect(texts.length).toBeGreaterThan(3);
    for (const t of texts) expect(String(flat(t)?.fontFamily)).toMatch(/^Inter_/);
  });
});

// Opus R5-B4: on iOS an Alert raised over the open sheet, or while it closes, can be dropped. Every
// Alert that follows the sheet (the Delete and Block confirms, "Report sent") waits for the Modal's
// onDismiss: the sheet is gone first, then the Alert, then the action.
describe('SafetyMenu — iOS: the sheet closes before its Alert (Opus R5-B4)', () => {
  beforeEach(() => setOS('ios'));

  it('Delete: the sheet closes, the confirm comes after onDismiss, and Delete runs from it', async () => {
    const onDelete = jest.fn().mockResolvedValue(undefined);
    const { getByTestId, queryByTestId } = await renderMenu({ authorUserId: ME, onDelete, contentNoun: 'voice note' });
    await fireEvent.press(getByTestId('sm'));
    const dismiss = sheetDismiss(getByTestId);
    await fireEvent.press(getByTestId('sm-delete'));
    expect(queryByTestId('sm-sheet')).toBeNull();
    expect(alertSpy).not.toHaveBeenCalled();
    await act(async () => dismiss());
    expect(alertSpy).toHaveBeenCalledWith('Delete this voice note?', expect.any(String), expect.any(Array));
    await act(async () => {
      await pressAlertButton('Delete');
    });
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('Block: the confirm comes only once the sheet is gone', async () => {
    const onBlocked = jest.fn();
    const { getByTestId, queryByTestId } = await renderMenu({ onBlocked });
    await fireEvent.press(getByTestId('sm'));
    const dismiss = sheetDismiss(getByTestId);
    await fireEvent.press(getByTestId('sm-block'));
    expect(queryByTestId('sm-sheet')).toBeNull();
    expect(alertSpy).not.toHaveBeenCalled();
    await act(async () => dismiss());
    expect(alertSpy).toHaveBeenCalledWith('Block Sam?', expect.any(String), expect.any(Array));
    await act(async () => {
      await pressAlertButton('Block');
    });
    expect(mockBlock).toHaveBeenCalledWith(OTHER);
    expect(onBlocked).toHaveBeenCalledWith(OTHER);
  });

  it('Report sent (with the 911 / 988 line) shows after onDismiss, then the note folds', async () => {
    const onReported = jest.fn();
    const { getByTestId, queryByTestId } = await renderMenu({ targetType: 'voice_note', onReported });
    await fireEvent.press(getByTestId('sm'));
    const dismiss = sheetDismiss(getByTestId);
    await fireEvent.press(getByTestId('sm-report'));
    await act(async () => {
      await fireEvent.press(getByTestId('sm-reason-self_harm'));
    });
    expect(mockReport).toHaveBeenCalled();
    expect(queryByTestId('sm-sheet')).toBeNull();
    expect(alertSpy).not.toHaveBeenCalled();
    expect(onReported).not.toHaveBeenCalled();
    await act(async () => dismiss());
    const [title, message] = alertSpy.mock.calls[alertSpy.mock.calls.length - 1];
    expect(title).toBe('Report sent');
    expect(message).toMatch(/911/);
    expect(message).toMatch(/988/);
    expect(onReported).toHaveBeenCalledTimes(1);
  });

  // VUX-B3 (LS-VUX m#886): Cancel while the report is still sending. The sheet has gone (its onDismiss has
  // fired) by the time the server says yes, so Report sent and the fold come at once, not never.
  it('Cancel while the report sends: Report sent and the fold still come once it is in', async () => {
    let accept: () => void = () => undefined;
    mockReport.mockImplementation(() => new Promise<void>((ok) => (accept = ok)));
    const onReported = jest.fn();
    const { getByTestId, queryByTestId } = await renderMenu({ targetType: 'voice_note', onReported });
    await fireEvent.press(getByTestId('sm'));
    const dismiss = sheetDismiss(getByTestId);
    await fireEvent.press(getByTestId('sm-report'));
    // The press resolves with the report itself, so it is not awaited until the server answers.
    const sending = fireEvent.press(getByTestId('sm-reason-spam'));
    await waitFor(() => expect(mockReport).toHaveBeenCalledTimes(1));
    await fireEvent.press(getByTestId('sm-close'));
    expect(queryByTestId('sm-sheet')).toBeNull();
    await act(async () => dismiss()); // iOS: the sheet is gone
    expect(alertSpy).not.toHaveBeenCalled();
    await act(async () => accept());
    await sending;
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy).toHaveBeenCalledWith('Report sent', expect.any(String));
    expect(onReported).toHaveBeenCalledTimes(1);
  });

  it('Cancel, and the report is in before the sheet has gone: Report sent waits for onDismiss', async () => {
    let accept: () => void = () => undefined;
    mockReport.mockImplementation(() => new Promise<void>((ok) => (accept = ok)));
    const onReported = jest.fn();
    const { getByTestId } = await renderMenu({ targetType: 'voice_note', onReported });
    await fireEvent.press(getByTestId('sm'));
    const dismiss = sheetDismiss(getByTestId);
    await fireEvent.press(getByTestId('sm-report'));
    const sending = fireEvent.press(getByTestId('sm-reason-spam'));
    await waitFor(() => expect(mockReport).toHaveBeenCalledTimes(1));
    await fireEvent.press(getByTestId('sm-close'));
    await act(async () => accept()); // still closing
    await sending;
    expect(alertSpy).not.toHaveBeenCalled();
    expect(onReported).not.toHaveBeenCalled();
    await act(async () => dismiss());
    expect(alertSpy).toHaveBeenCalledWith('Report sent', expect.any(String));
    expect(onReported).toHaveBeenCalledTimes(1);
  });

  it('a menu unmounted mid-close still shows what was waiting', async () => {
    const onReported = jest.fn();
    const { getByTestId, unmount } = await renderMenu({ onReported });
    await fireEvent.press(getByTestId('sm'));
    await fireEvent.press(getByTestId('sm-report'));
    await act(async () => {
      await fireEvent.press(getByTestId('sm-reason-spam'));
    });
    expect(alertSpy).not.toHaveBeenCalled();
    await act(async () => unmount());
    expect(alertSpy).toHaveBeenCalledWith('Report sent', expect.any(String));
    expect(onReported).toHaveBeenCalledTimes(1);
  });
});

// Sol R5-B2: the report sheet is capped at 90% of the screen and its steps scroll above Cancel.
describe('SafetyMenu — the sheet scrolls when it is taller than the screen (Sol R5-B2)', () => {
  const { StyleSheet } = jest.requireActual('react-native');
  it('caps the sheet and scrolls the note card, reasons and emergency line; Cancel stays outside', async () => {
    const { getByTestId } = await renderMenu({
      targetType: 'voice_note',
      context: { name: 'Maya', detail: 'voice note · 0:21' },
    });
    await fireEvent.press(getByTestId('sm'));
    await fireEvent.press(getByTestId('sm-report'));
    expect(StyleSheet.flatten(getByTestId('sm-sheet').props.style).maxHeight).toBe('90%');
    const scroll = getByTestId('sm-scroll');
    const inside = (id: string) => {
      let n = getByTestId(id) as { parent: unknown } | null;
      while (n && n !== scroll) n = n.parent as typeof n;
      return n === scroll;
    };
    expect(inside('sm-context')).toBe(true);
    expect(inside('sm-reason-harassment')).toBe(true);
    expect(inside('sm-emergency')).toBe(true);
    expect(inside('sm-close')).toBe(false);
  });
});
