// src/__tests__/ContentAttachForm.test.tsx
//
// PR-17 M2 R2 — ContentAttachForm audit remediation guards.
//
// Covers the two P1 fixes from PR17_M2_AUDIT.md:
//   P1 #1 — edit-form state re-syncs when the parent flips `content`/`visible`
//           on the SAME mounted instance (no stale/default patch bodies; add→
//           edit→different-row re-seeds correctly).
//   P1 #2 — every cadence kind exposed in the picker builds a VALID
//           cadence_payload for the backend zod contract (required field
//           present) and Save is blocked with inline validation when missing.
//
// RTL-only: mounts the form directly and drives it through props/interactions.

import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

const THEME_COLORS = {
  background: '#F5EFE4',
  surface: '#F1E8D5',
  primary: '#2C4A36',
  textPrimary: '#1A1A18',
  textSecondary: '#3D3D3A',
  textMuted: '#B1A89F',
  textOnPrimary: '#F5EFE4',
  border: 'rgba(176,141,87,0.2)',
  divider: 'rgba(176,141,87,0.15)',
  success: '#2C4A36',
  warning: '#C5A253',
  error: '#4A0404',
  info: '#1A73E8',
};

jest.mock('../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: THEME_COLORS }),
}));

jest.mock('expo-font', () => ({ isLoaded: () => true }));

jest.mock('../utils/haptics', () => ({
  lightTap: jest.fn(),
  mediumTap: jest.fn(),
  warningTap: jest.fn(),
  successTap: jest.fn(),
}));

import ContentAttachForm, {
  ContentAttachFormProps,
} from '../screens/coach/payments/contents/ContentAttachForm';
import { PackageContent } from '../api/packageContentsApi';

function makeContent(over: Partial<PackageContent> = {}): PackageContent {
  return {
    id: 'c1',
    package_id: 'pkg1',
    asset_type: 'workout_program',
    asset_id: 'asset-1',
    asset_revision_id: null,
    display_order: 0,
    cadence_kind: 'immediate',
    cadence_payload: {},
    display_title: 'Week 1 Program',
    display_caption: 'Your kickoff block',
    created_at: '2026-05-30T00:00:00.000Z',
    updated_at: '2026-05-30T00:00:00.000Z',
    removed_at: null,
    ...over,
  };
}

function baseProps(over: Partial<ContentAttachFormProps> = {}): ContentAttachFormProps {
  return {
    visible: true,
    content: null,
    saving: false,
    onCancel: jest.fn(),
    onSubmitAttach: jest.fn(),
    onSubmitPatch: jest.fn(),
    ...over,
  };
}

describe('ContentAttachForm — P1 #1 edit-form re-sync', () => {
  it('seeds the fields from an existing row opened for edit', async () => {
    const content = makeContent({
      display_title: 'Strength Block',
      display_caption: 'Phase two',
      cadence_kind: 'relative_to_purchase',
      cadence_payload: { offset_days: 14 },
    });
    const { getByTestId } = await render(
      <ContentAttachForm {...baseProps({ content })} />,
    );
    expect(getByTestId('content-attach-title').props.value).toBe('Strength Block');
    expect(getByTestId('content-attach-caption').props.value).toBe('Phase two');
    // Advanced cadence is disclosed because the row is non-immediate, and the
    // seeded relative-days value matches the row payload.
    expect(getByTestId('content-attach-relative-days').props.value).toBe('14');
  });

  it('patch body reflects EDITED values, not stale/defaults', async () => {
    const onSubmitPatch = jest.fn();
    const content = makeContent({
      display_title: 'Strength Block',
      display_caption: 'Phase two',
      cadence_kind: 'immediate',
      cadence_payload: {},
    });
    const { getByTestId } = await render(
      <ContentAttachForm {...baseProps({ content, onSubmitPatch })} />,
    );
    // Edit the seeded fields.
    await fireEvent.changeText(getByTestId('content-attach-title'), 'Strength Block v2');
    await fireEvent.changeText(getByTestId('content-attach-caption'), 'Revised note');
    await fireEvent.press(getByTestId('content-attach-submit'));

    await waitFor(() => expect(onSubmitPatch).toHaveBeenCalledTimes(1));
    expect(onSubmitPatch).toHaveBeenCalledWith({
      display_title: 'Strength Block v2',
      display_caption: 'Revised note',
      cadence_kind: 'immediate',
      cadence_payload: {},
    });
  });

  it('does NOT wipe title/caption when editing without touching them', async () => {
    const onSubmitPatch = jest.fn();
    const content = makeContent({
      display_title: 'Keep Me',
      display_caption: 'Keep this caption',
    });
    const { getByTestId } = await render(
      <ContentAttachForm {...baseProps({ content, onSubmitPatch })} />,
    );
    await fireEvent.press(getByTestId('content-attach-submit'));
    await waitFor(() => expect(onSubmitPatch).toHaveBeenCalledTimes(1));
    expect(onSubmitPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        display_title: 'Keep Me',
        display_caption: 'Keep this caption',
      }),
    );
  });

  it('add → edit → different-row re-seeds on the same mounted instance', async () => {
    // Add mode first (content null) — fields are at defaults.
    const props = baseProps();
    const { getByTestId, queryByTestId, rerender } = await render(
      <ContentAttachForm {...props} />,
    );
    expect(getByTestId('content-attach-title').props.value).toBe('');
    // The asset-reference input only shows in add mode.
    expect(queryByTestId('content-attach-asset-id')).toBeTruthy();

    // Flip to editing row A on the SAME instance.
    const rowA = makeContent({
      id: 'A',
      display_title: 'Row A title',
      display_caption: 'Row A caption',
      cadence_kind: 'immediate',
      cadence_payload: {},
    });
    await rerender(<ContentAttachForm {...props} content={rowA} />);
    await waitFor(() =>
      expect(getByTestId('content-attach-title').props.value).toBe('Row A title'),
    );
    expect(getByTestId('content-attach-caption').props.value).toBe('Row A caption');
    // asset-id input hidden in edit mode.
    expect(queryByTestId('content-attach-asset-id')).toBeNull();

    // Flip to a DIFFERENT row B — fields must re-seed, not keep Row A's.
    const rowB = makeContent({
      id: 'B',
      display_title: 'Row B title',
      display_caption: 'Row B caption',
      cadence_kind: 'on_milestone',
      cadence_payload: { milestone_key: 'first_workout_complete' },
    });
    await rerender(<ContentAttachForm {...props} content={rowB} />);
    await waitFor(() =>
      expect(getByTestId('content-attach-title').props.value).toBe('Row B title'),
    );
    expect(getByTestId('content-attach-caption').props.value).toBe('Row B caption');
    expect(getByTestId('content-attach-milestone-key').props.value).toBe(
      'first_workout_complete',
    );

    // Back to add mode — defaults restored.
    await rerender(<ContentAttachForm {...props} content={null} />);
    await waitFor(() =>
      expect(getByTestId('content-attach-title').props.value).toBe(''),
    );
    expect(getByTestId('content-attach-caption').props.value).toBe('');
  });
});

describe('ContentAttachForm — P1 #2 valid cadence_payload per exposed kind', () => {
  // Helper: open advanced disclosure and pick a cadence option by label.
  function openCadence(getByTestId: ReturnType<typeof render>['getByTestId']) {
    fireEvent.press(getByTestId('content-attach-cadence-disclosure'));
  }

  it('immediate → {} (no required payload field)', async () => {
    const onSubmitAttach = jest.fn();
    const { getByTestId } = await render(
      <ContentAttachForm {...baseProps({ onSubmitAttach })} />,
    );
    await fireEvent.changeText(getByTestId('content-attach-asset-id'), 'asset-1');
    await fireEvent.press(getByTestId('content-attach-submit'));
    await waitFor(() => expect(onSubmitAttach).toHaveBeenCalledTimes(1));
    expect(onSubmitAttach.mock.calls[0][0]).toMatchObject({
      cadence_kind: 'immediate',
      cadence_payload: {},
    });
  });

  it('relative_to_purchase → { offset_days }', async () => {
    const onSubmitAttach = jest.fn();
    const { getByTestId, getByLabelText } = await render(
      <ContentAttachForm {...baseProps({ onSubmitAttach })} />,
    );
    await fireEvent.changeText(getByTestId('content-attach-asset-id'), 'asset-1');
    openCadence(getByTestId);
    await fireEvent.press(getByLabelText('After purchase'));
    await fireEvent.changeText(getByTestId('content-attach-relative-days'), '7');
    await fireEvent.press(getByTestId('content-attach-submit'));
    await waitFor(() => expect(onSubmitAttach).toHaveBeenCalledTimes(1));
    expect(onSubmitAttach.mock.calls[0][0]).toMatchObject({
      cadence_kind: 'relative_to_purchase',
      cadence_payload: { offset_days: 7 },
    });
  });

  it('fixed_calendar → { release_at } (valid ISO) and blocks Save when empty', async () => {
    const onSubmitAttach = jest.fn();
    const { getByTestId, getByLabelText, getByText } = await render(
      <ContentAttachForm {...baseProps({ onSubmitAttach })} />,
    );
    await fireEvent.changeText(getByTestId('content-attach-asset-id'), 'asset-1');
    openCadence(getByTestId);
    await fireEvent.press(getByLabelText('On a date'));

    // Save blocked while release_at is empty (error-prevention).
    await fireEvent.press(getByTestId('content-attach-submit'));
    await waitFor(() => expect(getByText(/release date as an ISO date/i)).toBeTruthy());
    expect(onSubmitAttach).not.toHaveBeenCalled();

    // Provide a valid ISO datetime → valid payload submitted.
    await fireEvent.changeText(
      getByTestId('content-attach-release-at'),
      '2026-09-01T09:00:00Z',
    );
    await fireEvent.press(getByTestId('content-attach-submit'));
    await waitFor(() => expect(onSubmitAttach).toHaveBeenCalledTimes(1));
    expect(onSubmitAttach.mock.calls[0][0]).toMatchObject({
      cadence_kind: 'fixed_calendar',
      cadence_payload: { release_at: '2026-09-01T09:00:00Z' },
    });
  });

  it('on_completion → {} (optional payload, no required field)', async () => {
    const onSubmitAttach = jest.fn();
    const { getByTestId, getByLabelText } = await render(
      <ContentAttachForm {...baseProps({ onSubmitAttach })} />,
    );
    await fireEvent.changeText(getByTestId('content-attach-asset-id'), 'asset-1');
    openCadence(getByTestId);
    await fireEvent.press(getByLabelText('On completion'));
    await fireEvent.press(getByTestId('content-attach-submit'));
    await waitFor(() => expect(onSubmitAttach).toHaveBeenCalledTimes(1));
    expect(onSubmitAttach.mock.calls[0][0]).toMatchObject({
      cadence_kind: 'on_completion',
      cadence_payload: {},
    });
  });

  it('on_milestone → { milestone_key } and blocks Save when empty', async () => {
    const onSubmitAttach = jest.fn();
    const { getByTestId, getByLabelText, getByText } = await render(
      <ContentAttachForm {...baseProps({ onSubmitAttach })} />,
    );
    await fireEvent.changeText(getByTestId('content-attach-asset-id'), 'asset-1');
    openCadence(getByTestId);
    await fireEvent.press(getByLabelText('On milestone'));

    // Save blocked while milestone_key is empty.
    await fireEvent.press(getByTestId('content-attach-submit'));
    await waitFor(() =>
      expect(getByText(/Add the milestone key/i)).toBeTruthy(),
    );
    expect(onSubmitAttach).not.toHaveBeenCalled();

    await fireEvent.changeText(
      getByTestId('content-attach-milestone-key'),
      'first_workout_complete',
    );
    await fireEvent.press(getByTestId('content-attach-submit'));
    await waitFor(() => expect(onSubmitAttach).toHaveBeenCalledTimes(1));
    expect(onSubmitAttach.mock.calls[0][0]).toMatchObject({
      cadence_kind: 'on_milestone',
      cadence_payload: { milestone_key: 'first_workout_complete' },
    });
  });
});
