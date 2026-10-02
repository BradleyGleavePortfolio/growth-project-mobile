/**
 * SafetyMenu — Report (with reason) and Block on community content (Apple 1.2).
 */
import React from 'react';
import { Alert, type AlertButton } from 'react-native';
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
beforeEach(() => {
  mockReport.mockReset().mockResolvedValue(undefined);
  mockBlock.mockReset().mockResolvedValue(undefined);
  mockCapture.mockReset();
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(() => alertSpy.mockRestore());

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
        'Thank you. Reports are reviewed within 24 hours, every day, by your coach and The Growth Project team. Content that breaks these guidelines is removed, and people who break them repeatedly lose access.',
      ),
    );
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
      "You and Sam will no longer see each other's posts, comments, messages or voice notes, and neither of you can message the other. They are not told. You can unblock them from Community safety.",
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
