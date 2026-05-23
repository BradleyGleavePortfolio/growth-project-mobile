/**
 * Behavior coverage for the Report Message sheet:
 *
 *   1. Selecting a reason + tapping Submit fires onSubmit with that exact
 *      backend reason value (sexual is sent — never legacy sexual_content).
 *   2. Optional details survive the sheet and are passed to onSubmit verbatim.
 *   3. When onSubmit throws (api returns 4xx), the user-facing error renders
 *      and the sheet does NOT auto-close — preventing a false "Reported"
 *      confirmation (R18).
 *   4. The details TextInput caps at DETAILS_MAX (1000), matching backend.
 */
import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import ReportMessageSheet from '../ReportMessageSheet';
import { DETAILS_MAX } from '../../../api/messagesApi';

jest.mock('../../../theme/ThemeProvider', () => {
  const colors = {
    background: '#000',
    surface: '#111',
    border: '#222',
    primary: '#0af',
    primaryDark: '#08c',
    textPrimary: '#fff',
    textSecondary: '#ccc',
    textMuted: '#888',
    textOnPrimary: '#000',
    error: '#f33',
    success: '#3f3',
  };
  return {
    useTheme: () => ({ colors }),
    ThemeColors: {},
  };
});

describe('ReportMessageSheet', () => {
  it('submits the selected reason verbatim to onSubmit', async () => {
    const onSubmit = jest.fn().mockResolvedValue(undefined);
    const onClose = jest.fn();
    const { getByLabelText } = render(
      <ReportMessageSheet
        visible
        messagePreview="hi"
        onSubmit={onSubmit}
        onClose={onClose}
      />,
    );
    fireEvent.press(getByLabelText('Sexual content'));
    fireEvent.press(getByLabelText('Submit report'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({ reason: 'sexual', details: undefined });
  });

  it.each([
    ['Spam', 'spam'],
    ['Harassment or bullying', 'harassment'],
    ['Sexual content', 'sexual'],
    ['Hate speech', 'hate_speech'],
    ['Violence or threats', 'violence'],
    ['Misinformation', 'misinformation'],
    ['Something else', 'other'],
  ])('maps UI label "%s" to backend reason "%s"', async (label, value) => {
    const onSubmit = jest.fn().mockResolvedValue(undefined);
    const { getByLabelText } = render(
      <ReportMessageSheet
        visible
        messagePreview=""
        onSubmit={onSubmit}
        onClose={jest.fn()}
      />,
    );
    fireEvent.press(getByLabelText(label));
    fireEvent.press(getByLabelText('Submit report'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ reason: value });
  });

  it('passes trimmed free-text details to onSubmit when supplied', async () => {
    const onSubmit = jest.fn().mockResolvedValue(undefined);
    const { getByLabelText } = render(
      <ReportMessageSheet
        visible
        messagePreview=""
        onSubmit={onSubmit}
        onClose={jest.fn()}
      />,
    );
    fireEvent.press(getByLabelText('Spam'));
    fireEvent.changeText(getByLabelText('Additional details'), '  bad link  ');
    fireEvent.press(getByLabelText('Submit report'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toEqual({ reason: 'spam', details: 'bad link' });
  });

  it('renders a user-facing error and does NOT close on failed submission', async () => {
    const onSubmit = jest.fn().mockRejectedValueOnce(
      Object.assign(new Error('bad'), {
        response: { status: 400, data: { error: 'MESSAGE_NOT_FOUND' } },
      }),
    );
    const onClose = jest.fn();
    const { getByLabelText, findByText, queryByText } = render(
      <ReportMessageSheet
        visible
        messagePreview=""
        onSubmit={onSubmit}
        onClose={onClose}
      />,
    );
    fireEvent.press(getByLabelText('Spam'));
    await act(async () => {
      fireEvent.press(getByLabelText('Submit report'));
    });
    expect(await findByText(/couldn't submit that report/i)).toBeTruthy();
    // The raw backend error code must never reach the UI (R9 / R17).
    expect(queryByText(/MESSAGE_NOT_FOUND/)).toBeNull();
    // The sheet must stay open — closing would falsely imply success.
    expect(onClose).not.toHaveBeenCalled();
  });

  it('caps the details TextInput at DETAILS_MAX (1000)', () => {
    const { getByLabelText } = render(
      <ReportMessageSheet
        visible
        messagePreview=""
        onSubmit={jest.fn()}
        onClose={jest.fn()}
      />,
    );
    const input = getByLabelText('Additional details');
    expect(input.props.maxLength).toBe(1000);
    expect(DETAILS_MAX).toBe(1000);
  });
});
