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
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Report sent', expect.any(String)));
  });

  it('blocks only after confirmation, then refetches community data and calls onBlocked', async () => {
    const onBlocked = jest.fn();
    const { getByTestId, invalidate } = await renderMenu({ onBlocked });
    await fireEvent.press(getByTestId('sm'));
    await fireEvent.press(getByTestId('sm-block'));
    expect(mockBlock).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith('Block Sam?', expect.any(String), expect.any(Array));
    await act(async () => {
      await pressAlertButton('Block');
    });
    expect(mockBlock).toHaveBeenCalledWith(OTHER);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['community'] });
    expect(onBlocked).toHaveBeenCalledWith(OTHER);
  });

  it('shows the server copy when blocking the coach is refused', async () => {
    const err = Object.assign(new Error('403'), {
      response: { status: 403, data: { code: 'community.block.workspace_coach' } },
    });
    mockBlock.mockRejectedValueOnce(err);
    const { getByTestId } = await renderMenu();
    await fireEvent.press(getByTestId('sm'));
    await fireEvent.press(getByTestId('sm-block'));
    await act(async () => {
      await pressAlertButton('Block');
    });
    expect(alertSpy).toHaveBeenLastCalledWith(
      'Could not block',
      expect.stringMatching(/cannot block your own coach/),
    );
  });

  it('hides Block when the author is unknown but still allows Report', async () => {
    const { getByTestId, queryByTestId } = await renderMenu({ authorUserId: null });
    await fireEvent.press(getByTestId('sm'));
    expect(getByTestId('sm-report')).toBeTruthy();
    expect(queryByTestId('sm-block')).toBeNull();
  });
});
